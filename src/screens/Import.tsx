import { useEffect, useState, type FormEvent } from 'react'
import { balanceText, formatNumber, formatRate, parseChips, parseRate } from '../calc/format'
import {
  addDraftPlayer,
  cashoutTotal,
  draftFromChat,
  duplicateNames,
  gameFromDraft,
  mergeDraftPlayers,
  parseChat,
  setCashout,
  setRebuyCount,
  type Draft,
  type DraftPlayer,
} from '../calc/telegram'
import { balance, playerTotals } from '../calc/totals'
import { formatDate } from '../dates'
import { getSettings, saveGame } from '../store/db'
import { ulid } from '../ulid'

// Игра из Телеграма (Р-10): вставка текста → сверка → обычная игра
export function ImportScreen() {
  const [text, setText] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [unparsed, setUnparsed] = useState<string[]>([])
  const [name, setName] = useState('')
  const [rateText, setRateText] = useState('')
  const [regulars, setRegulars] = useState<string[]>([]) // подсказка имён — постоянные игроки
  const [newPlayer, setNewPlayer] = useState('')

  useEffect(() => {
    void getSettings().then((s) => {
      setRegulars(s.players)
      setRateText(formatRate(s.defaultRate))
    })
  }, [])

  async function parse() {
    const settings = await getSettings()
    const chat = parseChat(text)
    const next = draftFromChat(chat, settings.defaultBuyin, () => ulid())
    setNotFound(next === null)
    if (!next) return
    setDraft(next)
    setUnparsed(chat.unparsed)
    setName(formatDate(next.date))
    window.scrollTo(0, 0)
  }

  if (draft === null) {
    return (
      <main className="screen">
        <BackBar />
        <h1>Из Телеграма</h1>
        <p className="muted">
          Выделите в чате сообщения #rebuy и #cashout, нажмите «Копировать» и вставьте сюда.
        </p>
        <textarea
          className="paste"
          placeholder="[05.06.2026 22:10] Аня: #rebuy Гоша"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setNotFound(false)
          }}
        />
        {notFound && <p className="warn">Не нашёл записей #rebuy и #cashout</p>}
        <button className="big primary wide" disabled={!text.trim()} onClick={() => void parse()}>
          Разобрать
        </button>
      </main>
    )
  }

  const current = draft
  const preview = gameFromDraft(current, { name: '', rate: 1, now: '' }, counter())
  const b = balance(playerTotals(preview.players, preview.entries, preview.rate))
  const dups = duplicateNames(current)
  const empty = current.players.some((p) => !p.name.trim())
  const rate = parseRate(rateText)
  const canCreate = rate !== null && current.players.length > 0 && dups.length === 0 && !empty

  function updatePlayer(id: string, fn: (p: DraftPlayer) => DraftPlayer) {
    setDraft({ ...current, players: current.players.map((p) => (p.id === id ? fn(p) : p)) })
  }

  function remove(p: DraftPlayer) {
    if (!confirm(`Убрать ${p.name || 'игрока'} из игры?`)) return
    setDraft({ ...current, players: current.players.filter((x) => x.id !== p.id) })
  }

  const newName = newPlayer.trim()
  const taken = current.players.some((p) => p.name.trim().toLowerCase() === newName.toLowerCase())
  function addPlayer(e: FormEvent) {
    e.preventDefault()
    if (!newName || taken) return
    setDraft(addDraftPlayer(current, newName, () => ulid()))
    setNewPlayer('')
  }

  async function create() {
    if (!canCreate || rate === null) return
    const game = gameFromDraft(
      current,
      { name: name.trim() || formatDate(current.date), rate, now: new Date().toISOString() },
      () => ulid(),
    )
    await saveGame(game)
    location.hash = `#/game/${game.id}`
  }

  return (
    <main className="screen">
      <BackBar />
      <h1>Сверка</h1>
      <p className="muted">
        {formatDate(current.date)} · докуп — {formatNumber(current.rebuy)} фишек
      </p>

      <section className="card">
        <label className="field">
          Название
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Курс, ₽ за фишку
          <input inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} />
        </label>
        {rate === null && <p className="warn">Курс — число больше нуля, например 0,5</p>}
      </section>

      <datalist id="regulars">
        {regulars.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <ul className="list">
        {current.players.map((p) => (
          <DraftCard
            key={p.id}
            player={p}
            others={current.players.filter((x) => x.id !== p.id)}
            onChange={(fn) => updatePlayer(p.id, fn)}
            onRebuys={(n) => updatePlayer(p.id, (x) => setRebuyCount(x, n, current.end))}
            onCashout={(chips) => updatePlayer(p.id, (x) => setCashout(x, chips, current.end))}
            onMerge={(intoId) => setDraft(mergeDraftPlayers(current, p.id, intoId))}
            onRemove={() => remove(p)}
          />
        ))}
      </ul>

      <form className="card row" onSubmit={addPlayer}>
        <input
          className="grow"
          list="regulars"
          placeholder="Кого нет в тексте"
          value={newPlayer}
          onChange={(e) => setNewPlayer(e.target.value)}
        />
        <button className="big primary" disabled={!newName || taken}>
          Добавить игрока
        </button>
      </form>
      {taken && <p className="warn">Такой игрок уже есть</p>}

      <section className="card summary">
        <h2>Проверка</h2>
        <p className={b.ok ? 'ok' : 'warn'}>{balanceText(b)}</p>
        {dups.length > 0 && <p className="warn">Одинаковые имена: {dups.join(', ')} — объедините или переименуйте</p>}
        {empty && <p className="warn">У игрока нет имени</p>}
      </section>

      {unparsed.length > 0 && (
        <section className="card">
          <h2>Не разобрано: {unparsed.length} {linesWord(unparsed.length)}</h2>
          <ul className="unparsed">
            {unparsed.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      <button className="big primary wide" disabled={!canCreate} onClick={() => void create()}>
        Создать игру
      </button>
      <button className="big wide" onClick={() => setDraft(null)}>
        Назад к тексту
      </button>
    </main>
  )
}

// Для проверки на лету id записей не нужны настоящие
function counter() {
  let n = 0
  return () => String(n++)
}

// «1 строка», «2 строки», «5 строк»
function linesWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'строка'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'строки'
  return 'строк'
}

function BackBar() {
  return (
    <header className="bar">
      <a className="bar-link" href="#/">
        ← Игры
      </a>
    </header>
  )
}

type DraftCardProps = {
  player: DraftPlayer
  others: DraftPlayer[]
  onChange: (fn: (p: DraftPlayer) => DraftPlayer) => void
  onRebuys: (count: number) => void
  onCashout: (chips: number) => void
  onMerge: (intoId: string) => void
  onRemove: () => void
}

function DraftCard({ player, others, onChange, onRebuys, onCashout, onMerge, onRemove }: DraftCardProps) {
  const rebuys = player.rebuys.length
  return (
    <li className="card player">
      <div className="row draft-name">
        <input
          className="grow"
          list="regulars"
          aria-label="Имя игрока"
          value={player.name}
          onChange={(e) => onChange((p) => ({ ...p, name: e.target.value }))}
        />
        <button className="big" aria-label="Убрать игрока" onClick={onRemove}>
          ✕
        </button>
      </div>

      <div className="draft-grid">
        <label className="field">
          Закуп
          <ChipsInput value={player.buyin} onChange={(n) => onChange((p) => ({ ...p, buyin: n }))} />
        </label>
        <label className="field">
          Выход
          <ChipsInput value={cashoutTotal(player)} onChange={onCashout} />
        </label>
        <div className="field rebuys">
          Докупов
          <div className="stepper">
            <button className="big icon" aria-label="Докупом меньше" disabled={rebuys === 0} onClick={() => onRebuys(rebuys - 1)}>
              −
            </button>
            <strong>{rebuys}</strong>
            <button className="big icon" aria-label="Докупом больше" onClick={() => onRebuys(rebuys + 1)}>
              +
            </button>
          </div>
        </div>
      </div>

      {others.length > 0 && (
        <select className="merge" value="" onChange={(e) => e.target.value && onMerge(e.target.value)}>
          <option value="">Это тот же, что…</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name || 'без имени'} — объединить
            </option>
          ))}
        </select>
      )}
    </li>
  )
}

// Целое число фишек; пусто — 0. Правка на лету, пока набирают — текст свой
function ChipsInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(value ? String(value) : '')
  const parsed = text.trim() === '' ? 0 : parseChips(text)

  // Значение поменялось снаружи (объединили игроков) — поле показывает новое
  useEffect(() => {
    if (parsed !== value) setText(value ? String(value) : '')
  }, [value])

  return (
    <input
      inputMode="numeric"
      pattern="[0-9 ]*"
      placeholder="0"
      className={parsed === null ? 'bad' : ''}
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setText(e.target.value)
        const n = e.target.value.trim() === '' ? 0 : parseChips(e.target.value)
        if (n !== null) onChange(n)
      }}
    />
  )
}
