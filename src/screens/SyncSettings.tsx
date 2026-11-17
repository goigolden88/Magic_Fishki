// Копия из FamilyCore@d9e5ec6 (ui/SyncSettings.tsx), правится здесь.
// «Настройки» → «Синхронизация» (#265): репозиторий данных, токен, его срок, «Проверить доступ», состояние,
// «Синхронизировать сейчас», «Забыть токен». Репозиторий и токен — поля на экране, а не константы в коде: иначе
// приложением не поделиться. Ничего не вписал — работа прежняя: данные на устройстве и никакой сети.
// Отличия от ядра: без useCore/Fold/общей базы семьи — свой экземпляр синхронизации (src/sync/instance.ts), токен
// в памяти «Фишек»; без выключателя и поля ветки: настроено — когда вписаны репозиторий и токен
import { useEffect, useState } from 'react'
import { dayOf, formatDate, formatTime, today as todayHere } from '../dates'
import { accessWords } from '../sync/access'
import { daysBetween, isDateStr, timeSpan, today } from '../sync/dates'
import { sync, useSyncStatus } from '../sync/instance'
import { checkAccess, configured, RETRY_MS, type SyncConfig, type SyncStatus } from '../sync/sync'
import { syncDot } from '../sync/syncDot'
import { expiryDay, WARN_DAYS } from '../sync/token'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'Неизвестная ошибка'
}

// «14:05», не сегодня — «16 ноября 2026, 14:05»
function whenText(iso: string): string {
  const ms = Date.parse(iso)
  const day = dayOf(ms)
  return day === todayHere() ? formatTime(iso) : `${formatDate(day)}, ${formatTime(iso)}`
}

// Токен истёк или истекает в пределах предупреждения; null — всё в порядке или срок неизвестен
export function tokenAlarm(config: SyncConfig): string | null {
  if (config.token === '') return null
  const day = expiryDay(config.tokenExpires)
  if (day === null) return null
  const left = daysBetween(today(), day)
  if (left < 0) return 'Токен истёк'
  return left <= WARN_DAYS ? `Токен истекает через ${left} дн.` : null
}

// Точка у заголовка раздела: красная — ошибка, серая — правки не ушли; не настроено — точки нет
export function SyncDotMark({ status }: { status: SyncStatus }) {
  const dot = syncDot(status)
  return dot ? <span className={dot} role="img" aria-label={dot.includes('error') ? 'ошибка синхронизации' : 'не отправлено'} /> : null
}

// Строка состояния словами
function StatusLine({ status }: { status: SyncStatus }) {
  const waiting = status.pending > 0 ? ` Ждут отправки: ${status.pending}.` : ''
  if (status.state === 'off') return <p className="muted">Не настроено: данные — только на этом устройстве.</p>
  if (status.state === 'syncing') return <p className="muted">Синхронизирую…</p>
  if (status.state === 'error') {
    return (
      <p className="warn">
        {status.error}
        {waiting}
      </p>
    )
  }
  if (status.offline) return <p className="muted">Ждёт сети: правки уедут сами, когда связь вернётся.{waiting}</p>
  if (status.deferred) {
    return (
      <p className="muted">
        Другое устройство отправляло в то же время. Повторю через {timeSpan(RETRY_MS)}.{waiting}
      </p>
    )
  }
  if (status.pending > 0) return <p className="muted">Ждут отправки: {status.pending}.</p>
  return <p className="ok">{status.lastAt ? `Отправлено в ${whenText(status.lastAt)}` : 'Обмена ещё не было'}</p>
}

export function SyncCard({ onSynced }: { onSynced?: () => void }) {
  const status = useSyncStatus()
  const [config, setConfig] = useState<SyncConfig>(sync.readConfig)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  // Проход сам дописывает срок токена из ответа GitHub — после каждой смены состояния настройка перечитывается
  useEffect(() => {
    setConfig(sync.readConfig())
  }, [status])

  function patch(change: Partial<SyncConfig>) {
    sync.saveConfig(change)
    setConfig(sync.readConfig())
  }

  async function check() {
    setBusy(true)
    setNote('')
    setError('')
    try {
      const fresh = sync.readConfig()
      const access = await checkAccess(fresh)
      if (access.tokenExpiry) patch({ tokenExpires: access.tokenExpiry })
      const words = accessWords(access, fresh.branch)
      setNote(words.note)
      if (words.error) setError(words.error)
    } catch (failure) {
      setError(describe(failure))
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    setBusy(true)
    setNote('')
    setError('')
    try {
      const result = await sync.syncNow()
      setConfig(sync.readConfig())
      onSynced?.()
      // Пустой ответ: проход упал, отложен или ждёт сети — это уже сказано строкой состояния
      if (result === null) return
      if (result.pulled === 0 && result.pushed === 0) setNote('Всё и так совпадает')
      else {
        const parts = []
        if (result.pulled > 0) parts.push(`получено записей: ${result.pulled}`)
        if (result.pushed > 0) parts.push(`отправлено файлов: ${result.pushed}`)
        setNote(parts.join(', '))
      }
    } finally {
      setBusy(false)
    }
  }

  const ready = configured(config)
  const alarm = tokenAlarm(config)

  return (
    <section className="card">
      <h3>
        Между устройствами <SyncDotMark status={status} />
      </h3>
      <StatusLine status={status} />
      {alarm && <p className="warn">{alarm} — синхронизация остановится. Как заменить — ниже и в справке.</p>}

      <label className="field">
        Репозиторий данных
        <input
          type="text"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="владелец/имя"
          defaultValue={config.repo}
          onChange={(e) => patch({ repo: e.target.value })}
        />
      </label>

      <TokenField config={config} onSave={(token) => patch({ token })} onForget={() => {
        sync.forgetToken()
        setConfig(sync.readConfig())
        setNote('')
        setError('')
      }} />

      {config.token !== '' && <TokenExpiry config={config} onSave={(day) => patch({ tokenExpires: day })} />}

      <div className="row">
        <button type="button" className="big grow" onClick={() => void check()} disabled={busy || !ready}>
          Проверить доступ
        </button>
      </div>
      <button
        type="button"
        className="big primary wide"
        onClick={() => void run()}
        disabled={busy || !ready || status.state === 'syncing'}
      >
        Синхронизировать сейчас
      </button>
      {note && <p className="muted">{note}</p>}
      {error && <p className="warn">{error}</p>}

      <details className="sync-how">
        <summary>Как завести репозиторий и токен</summary>
        <ol>
          <li>На GitHub — новый репозиторий: приватный и пустой (без README).</li>
          <li>
            Токен: Settings → Developer settings → Fine-grained tokens → Generate. Доступ — только к этому репозиторию,
            права Contents: Read and write.
          </li>
          <li>Сюда — «владелец/имя» репозитория и токен, затем «Проверить доступ».</li>
          <li>На другом телефоне или ноутбуке — тот же репозиторий и токен: сначала придёт всё оттуда, потом уйдёт своё.</li>
        </ol>
      </details>
      <p className="muted">
        Токен и имя репозитория — только на этом устройстве: в копию данных и в репозиторий они не попадают. Друзьям без
        GitHub — по-прежнему копия файлом.
      </p>
    </section>
  )
}

// Токен вводится один раз и дальше не показывается: проверить длинную строку глазами нельзя, а на чужом экране она
// лишняя. Заменить — вставить новый
function TokenField({
  config,
  onSave,
  onForget,
}: {
  config: SyncConfig
  onSave: (token: string) => void
  onForget: () => void
}) {
  const [editing, setEditing] = useState(config.token === '')
  const [value, setValue] = useState('')

  useEffect(() => {
    if (config.token === '') setEditing(true)
  }, [config.token])

  function forget() {
    if (window.confirm('Забыть токен? Синхронизация на этом устройстве остановится, пока токен не вставят снова.')) {
      onForget()
      setEditing(true)
    }
  }

  if (!editing) {
    return (
      <div className="field">
        Токен доступа — сохранён
        <div className="row">
          <button type="button" className="big grow" onClick={() => setEditing(true)}>
            Заменить
          </button>
          <button type="button" className="big grow danger" onClick={forget}>
            Забыть токен
          </button>
        </div>
      </div>
    )
  }

  return (
    <label className="field">
      Токен доступа
      <input
        type="password"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="github_pat_…"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          // Сохраняем сразу, а не по потере фокуса: кнопку жмут тем же движением, каким вставляют токен
          if (e.target.value) onSave(e.target.value)
        }}
        onBlur={() => {
          if (!value) return
          setValue('')
          setEditing(false)
        }}
      />
    </label>
  )
}

// Срок жизни токена: выбирается при выпуске — до года или бессрочно. Когда выйдет, синхронизация просто перестанет
// работать — без этой строки причина неочевидна. Дата — из ответа GitHub, а если браузеру не разрешили её читать —
// вписывается руками один раз
function TokenExpiry({ config, onSave }: { config: SyncConfig; onSave: (day: string) => void }) {
  const day = expiryDay(config.tokenExpires)

  if (day === null) {
    return (
      <label className="field">
        Когда истекает токен — GitHub показал дату при выпуске
        <input
          type="date"
          onChange={(e) => {
            if (isDateStr(e.target.value)) onSave(e.target.value)
          }}
        />
      </label>
    )
  }

  const left = daysBetween(today(), day)
  if (left < 0) {
    return (
      <p className="warn">
        Токен истёк {formatDate(day)}. Выпусти новый на GitHub и вставь сюда — до этого синхронизация работать не будет.
      </p>
    )
  }
  return (
    <p className={left <= WARN_DAYS ? 'warn' : 'muted'}>
      Токен действует до {formatDate(day)}
      {left <= WARN_DAYS && ` — осталось дней: ${left}, пора выпустить новый`}.
    </p>
  )
}
