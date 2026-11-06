import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { backupFileName, backupText, lastBackupText, makeBackup, parseBackup, planRestore } from '../calc/backup'
import { demoGames, hasDemo } from '../calc/demo'
import { formatNumber, formatRate, parseChips, parseRate } from '../calc/format'
import { today } from '../dates'
import { MAX_WINDOW, MIN_WINDOW, moveItem, type Game, type Regular, type Settings } from '../model'
import type { SavedHand } from '../calc/evenings'
import { allHands, deleteDemoGames, getSettings, handKeys, listGames, restoreGames, restoreHands, saveSettings } from '../store/db'
import { ulid } from '../ulid'
import { download } from './download'
import { loadLastBackup, saveLastBackup } from './lastBackup'
import { DEFAULT_SERVER, serverBase } from '../calc/pokerLink'
import { NOTE_COLORS, NOTE_LABEL_MAX, labelOf, mergeNotes, setLabel, type NoteColor } from '../calc/playerNotes'
import { DECK_LABELS, MY_BACK_LABELS, MY_FELT_LABELS, mergeMyLook, type MyLook } from '../calc/pokerLook'
import { PlayingCard } from './PokerRoom'
import {
  loadCardAnim,
  loadMyLook,
  loadNotes,
  loadServer,
  loadTurnSound,
  saveCardAnim,
  saveMyLook,
  saveNotes,
  saveServer,
  saveTurnSound,
} from './pokerStorage'

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rateText, setRateText] = useState<string | null>(null)
  const [buyinText, setBuyinText] = useState('')
  const [saved, setSaved] = useState(false)
  const [myLook, setMyLook] = useState(loadMyLook) // личный «Вид стола» (Р-61): меняется и восстановлением из копии

  useEffect(() => {
    void getSettings().then((s) => {
      setSettings(s)
      setRateText(formatRate(s.defaultRate))
      setBuyinText(String(s.defaultBuyin))
    })
  }, [])

  const rate = rateText === null ? null : parseRate(rateText)
  const buyin = parseChips(buyinText)

  // Списки сохраняются сразу, курс и закуп — кнопкой «Сохранить»
  function update(next: Settings) {
    setSettings(next)
    void saveSettings(next)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (rate === null || buyin === null || settings === null) return
    const next = { ...settings, defaultRate: rate, defaultBuyin: buyin }
    setSettings(next)
    await saveSettings(next)
    setSaved(true)
  }

  return (
    <main className="screen">
      <header className="bar">
        <a className="bar-link" href="#/">
          ← Игры
        </a>
      </header>
      <h1>Настройки</h1>

      {/* Р-53: на широком окне карточки — в две колонки, каждая не шире ≈ 640 px */}
      {settings !== null && rateText !== null && (
        <div className="cards">
          <form className="card" onSubmit={(e) => void save(e)}>
            <label className="field">
              Курс новой игры, ₽ за фишку
              <input
                inputMode="decimal"
                value={rateText}
                onChange={(e) => {
                  setRateText(e.target.value)
                  setSaved(false)
                }}
              />
            </label>
            <p className="muted">У начатых игр курс свой — он меняется на экране игры.</p>
            {rate === null && <p className="warn">Курс — число больше нуля, например 0,5</p>}
            <label className="field">
              Закуп по умолчанию, фишек
              <input
                inputMode="numeric"
                pattern="[0-9 ]*"
                value={buyinText}
                onChange={(e) => {
                  setBuyinText(e.target.value)
                  setSaved(false)
                }}
              />
            </label>
            <p className="muted">При новой игре — вопрос, записать ли всем такой закуп.</p>
            {buyin === null && <p className="warn">Закуп — целое число фишек больше нуля, например 1000</p>}
            {saved && <p className="ok">Сохранено</p>}
            <button className="big primary wide" disabled={rate === null || buyin === null}>
              Сохранить
            </button>
          </form>

          <PlayersCard players={settings.players} onChange={(players) => update({ ...settings, players })} />
          <AmountsCard
            amounts={settings.quickAmounts}
            onChange={(quickAmounts) => update({ ...settings, quickAmounts })}
          />
          <WindowCard
            size={settings.compareWindow}
            onChange={(compareWindow) => update({ ...settings, compareWindow })}
          />
          <BackupCard
            settings={settings}
            onPlayers={(players) => setSettings((s) => s && { ...s, players })}
            onLook={() => setMyLook(loadMyLook())}
          />
          <PokerServerCard />
          <MyLookCard look={myLook} onChange={setMyLook} />
          <NoteColorsCard />
          <DemoCard />
        </div>
      )}
    </main>
  )
}

type MoveButtonsProps = { index: number; length: number; onMove: (delta: number) => void }

function MoveButtons({ index, length, onMove }: MoveButtonsProps) {
  return (
    <>
      <button type="button" className="icon" aria-label="Выше" disabled={index === 0} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button
        type="button"
        className="icon"
        aria-label="Ниже"
        disabled={index === length - 1}
        onClick={() => onMove(1)}
      >
        ↓
      </button>
    </>
  )
}

// Переименование оставляет id — связь с прошлыми играми не рвётся; имена в самих играх — как были (Р-12)
function PlayersCard({ players, onChange }: { players: Regular[]; onChange: (players: Regular[]) => void }) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  const name = newName.trim()
  const duplicate = players.some((p) => p.name === name)
  const editName = editText.trim()
  const editDuplicate = editing !== null && players.some((p, i) => i !== editing && p.name === editName)

  function add(e: FormEvent) {
    e.preventDefault()
    if (!name || duplicate) return
    onChange([...players, { id: ulid(), name }])
    setNewName('')
  }

  function rename(e: FormEvent) {
    e.preventDefault()
    if (editing === null || !editName || editDuplicate) return
    onChange(players.map((p, i) => (i === editing ? { ...p, name: editName } : p)))
    setEditing(null)
  }

  function remove(index: number) {
    if (!confirm(`Убрать «${players[index].name}» из постоянных? Прошлые игры не изменятся.`)) return
    onChange(players.filter((_, i) => i !== index))
    setEditing(null)
  }

  return (
    <section className="card">
      <h2>Постоянные игроки</h2>
      <p className="muted">В новой игре они сразу отмечены — лишних можно снять.</p>
      {players.length > 0 && (
        <ul className="list items">
          {players.map((p, i) =>
            editing === i ? (
              <li key={p.id}>
                <form className="row" onSubmit={rename}>
                  <input
                    className="grow"
                    autoFocus
                    aria-label="Новое имя"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <button className="big primary" disabled={!editName || editDuplicate}>
                    ОК
                  </button>
                  <button type="button" className="big" onClick={() => setEditing(null)}>
                    ✕
                  </button>
                </form>
                {editDuplicate && <p className="warn">Такой игрок уже есть</p>}
              </li>
            ) : (
              <li key={p.id} className="item">
                <span className="grow">{p.name}</span>
                <MoveButtons index={i} length={players.length} onMove={(d) => onChange(moveItem(players, i, d))} />
                <button
                  type="button"
                  className="icon"
                  aria-label="Переименовать"
                  onClick={() => {
                    setEditing(i)
                    setEditText(p.name)
                  }}
                >
                  ✎
                </button>
                <button type="button" className="icon" aria-label="Удалить" onClick={() => remove(i)}>
                  ✕
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="row" onSubmit={add}>
        <input className="grow" placeholder="Имя игрока" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="big primary" disabled={!name || duplicate}>
          Добавить
        </button>
      </form>
      {name && duplicate && <p className="warn">Такой игрок уже есть</p>}
    </section>
  )
}

function AmountsCard({ amounts, onChange }: { amounts: number[]; onChange: (amounts: number[]) => void }) {
  const [text, setText] = useState('')
  const chips = parseChips(text)
  const duplicate = chips !== null && amounts.includes(chips)

  function add(e: FormEvent) {
    e.preventDefault()
    if (chips === null || duplicate) return
    onChange([...amounts, chips])
    setText('')
  }

  return (
    <section className="card">
      <h2>Быстрые суммы, фишек</h2>
      <p className="muted">Кнопки у «Закуп», «Докуп» и «Выход» — запись одним касанием.</p>
      {amounts.length > 0 && (
        <ul className="list items">
          {amounts.map((a, i) => (
            <li key={a} className="item">
              <span className="grow">{formatNumber(a)}</span>
              <MoveButtons index={i} length={amounts.length} onMove={(d) => onChange(moveItem(amounts, i, d))} />
              <button
                type="button"
                className="icon"
                aria-label="Удалить"
                onClick={() => onChange(amounts.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="row" onSubmit={add}>
        <input
          className="grow"
          inputMode="numeric"
          pattern="[0-9 ]*"
          placeholder="Сумма, фишек"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="big primary" disabled={chips === null || duplicate}>
          Добавить
        </button>
      </form>
      {duplicate && <p className="warn">Такая сумма уже есть</p>}
    </section>
  )
}

// Окно сравнения (Р-15): кнопки не выпускают за MIN_WINDOW–MAX_WINDOW; сохраняется сразу
function WindowCard({ size, onChange }: { size: number; onChange: (size: number) => void }) {
  return (
    <section className="card">
      <h2>Окно сравнения, игр</h2>
      <p className="muted">
        Карточка игрока: последние игры против предыдущих, лучший и худший промежуток — по столько игр подряд. От{' '}
        {MIN_WINDOW} до {MAX_WINDOW}.
      </p>
      <div className="row">
        <button
          type="button"
          className="big"
          aria-label="Меньше"
          disabled={size <= MIN_WINDOW}
          onClick={() => onChange(size - 1)}
        >
          −
        </button>
        <span className="grow stepper-value">{size}</span>
        <button
          type="button"
          className="big"
          aria-label="Больше"
          disabled={size >= MAX_WINDOW}
          onClick={() => onChange(size + 1)}
        >
          +
        </button>
      </div>
    </section>
  )
}

// Телефон умеет отдать файл в системное «Поделиться»; Chrome на Android не делится .json — уходит .txt
function canShareFiles(): boolean {
  if (!('canShare' in navigator)) return false
  try {
    return navigator.canShare({ files: [new File([''], 'fishki.txt', { type: 'text/plain' })] })
  } catch {
    return false
  }
}

type Note = { ok: boolean; text: string }

// Файл-копия (Р-11): игры живут только в браузере — копия переносит их на другое устройство и спасает при очистке.
// С Р-54 в копии и раздачи прошлых вечеров покера
function BackupCard(props: { settings: Settings; onPlayers: (players: Regular[]) => void; onLook: () => void }) {
  const { settings, onPlayers, onLook } = props
  const [games, setGames] = useState<Game[] | null>(null)
  const [hands, setHands] = useState<SavedHand[]>([])
  const [note, setNote] = useState<Note | null>(null)
  const [last, setLast] = useState(loadLastBackup)
  const fileInput = useRef<HTMLInputElement>(null)
  const shareFiles = canShareFiles()

  // Игры и раздачи читаются заранее: Safari открывает «Поделиться» только сразу после касания, без ожидания базы
  useEffect(() => {
    void listGames().then(setGames)
    allHands().then(setHands, () => setHands([]))
  }, [])

  // Отдана — запоминаем момент копии: игры, изменённые позже, — «после неё»
  function remember(at: string) {
    const next = { at, date: today() }
    saveLastBackup(next)
    setLast(next)
  }

  // Заметки об игроках и подписи цветов (Р-56) — из памяти телефона, читаются сразу, без ожидания
  function backupNow(now: string) {
    const { notes, labels } = loadNotes()
    return makeBackup(games ?? [], settings, now, hands, notes, labels, loadMyLook())
  }

  // Сохранил ли браузер файл, приложению не узнать (на iPhone — не всегда): обещать нельзя
  function save() {
    const now = new Date().toISOString()
    download(backupText(backupNow(now)), backupFileName(today()))
    remember(now)
    setNote({ ok: true, text: 'Файл отдан браузеру — проверьте, что он сохранился' })
  }

  async function share() {
    const now = new Date().toISOString()
    const text = backupText(backupNow(now))
    const file = new File([text], backupFileName(today(), 'txt'), { type: 'text/plain' })
    try {
      await navigator.share({ files: [file], title: 'Копия «Фишек»' })
      remember(now)
      setNote(null)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // закрыли меню
      setNote({ ok: false, text: 'Не удалось поделиться — сохраните копию файлом' })
    }
  }

  async function restore(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // тот же файл можно выбрать снова
    if (!file) return
    let text: string
    try {
      text = await file.text()
    } catch {
      setNote({ ok: false, text: 'Файл не читается' })
      return
    }
    const parsed = parseBackup(text, () => ulid())
    if (!parsed.ok) {
      setNote({ ok: false, text: `${parsed.error}. Данные не изменились.` })
      return
    }
    const current = await getSettings()
    // Раздач в копии нет (копия до Р-54) — их хранилище не читаем: восстановление игр как раньше
    let keys: [string, number][] = []
    if (parsed.backup.hands.length > 0) {
      try {
        keys = await handKeys()
      } catch {
        setNote({ ok: false, text: 'Не удалось прочитать раздачи на этом телефоне — попробуйте ещё раз' })
        return
      }
    }
    const plan = planRestore(
      (await listGames()).map((g) => g.id),
      current.players,
      parsed.backup,
      keys,
    )
    try {
      await restoreGames(plan.added)
      await restoreHands(plan.hands)
      if (plan.players.length !== current.players.length) await saveSettings({ ...current, players: plan.players })
    } catch {
      setNote({ ok: false, text: 'Не удалось записать игры — попробуйте ещё раз' })
      return
    }
    // Заметки и подписи (Р-56): дописываются недостающие, свои не перезаписываются
    const local = loadNotes()
    const merged = mergeNotes(local.notes, local.labels, parsed.backup)
    saveNotes({ notes: merged.notes, labels: merged.labels })
    // Вид стола (Р-61): из копии — то, что здесь не выбрано; свой выбор не перезаписывается
    saveMyLook(mergeMyLook(loadMyLook(), parsed.backup.look))
    onLook()
    onPlayers(plan.players)
    setGames(await listGames())
    if (plan.hands.length > 0) allHands().then(setHands, () => undefined)
    const handsNote = plan.hands.length > 0 ? `; раздач покера добавлено ${plan.hands.length}` : ''
    const notesNote = merged.added > 0 ? `; заметок об игроках добавлено ${merged.added}` : ''
    setNote({ ok: true, text: `Добавлено ${plan.added.length}, уже были ${plan.existing}${handsNote}${notesNote}` })
  }

  return (
    <section className="card">
      <h2>Копия игр</h2>
      <p className="muted">
        Игры хранятся только в этом браузере: очистка данных сайта или новый телефон их сотрут. Копия — файл со всеми
        играми, настройками, раздачами прошлых вечеров покера, заметками об игроках и видом стола; восстановление добавляет
        недостающее и ничего не перезаписывает.
      </p>
      {games !== null && <p>{lastBackupText(last, games, today())}</p>}
      <button type="button" className="big primary wide" disabled={games === null} onClick={save}>
        Сохранить копию
      </button>
      {shareFiles && (
        <button type="button" className="big wide" disabled={games === null} onClick={() => void share()}>
          Поделиться копией
        </button>
      )}
      <button type="button" className="big wide" onClick={() => fileInput.current?.click()}>
        Восстановить из копии
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,.txt,application/json,text/plain"
        hidden
        onChange={(e) => void restore(e)}
      />
      {note && <p className={note.ok ? 'ok' : 'warn'}>{note.text}</p>}
    </section>
  )
}

// Адрес сервера покера (Р-19): пусто — постоянный; свой — на случай резервного сервера или переезда.
// Хранится на устройстве (localStorage), не в базе и не в копии
function PokerServerCard() {
  const [text, setText] = useState(loadServer)
  const [saved, setSaved] = useState(false)
  const [sound, setSound] = useState(loadTurnSound) // звук «ваш ход» на этом устройстве (#75) — сохраняется сразу
  const [anim, setAnim] = useState(loadCardAnim) // «Анимация карт» на этом устройстве (#133) — так же
  const base = serverBase(text)

  function save(e: FormEvent) {
    e.preventDefault()
    if (base === null) return
    saveServer(text.trim() === '' ? '' : base)
    setText(text.trim() === '' ? '' : base)
    setSaved(true)
  }

  return (
    <form className="card" onSubmit={save}>
      <h2>Покер онлайн</h2>
      <label className="field">
        Адрес сервера
        <input
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          placeholder={DEFAULT_SERVER}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setSaved(false)
          }}
        />
      </label>
      <p className="muted">Пусто — постоянный сервер. Новые комнаты и входы идут на этот адрес.</p>
      {base === null && <p className="warn">Адрес — вида https://сервер, без пробелов</p>}
      {saved && <p className="ok">Сохранено</p>}
      <button className="big primary wide" disabled={base === null}>
        Сохранить
      </button>
      <label className="check">
        <input
          type="checkbox"
          checked={sound}
          onChange={(e) => {
            setSound(e.target.checked)
            saveTurnSound(e.target.checked)
          }}
        />
        Звук «Ваш ход»
      </label>
      <p className="muted">Короткий звук, когда за столом наступил ваш ход; вибрация — где телефон умеет. Только на этом устройстве.</p>
      <label className="check">
        <input
          type="checkbox"
          checked={anim}
          onChange={(e) => {
            setAnim(e.target.checked)
            saveCardAnim(e.target.checked)
          }}
        />
        Анимация карт
      </label>
      <p className="muted">
        Карты раздачи прилетают к местам по одной, общие карты выкладываются по одной — за столом покера и казино. Выключено — карты
        появляются сразу. Только на этом устройстве.
      </p>
    </form>
  )
}

// Личный «Вид стола» (Р-61): сукно и рубашка поверх выбора ведущего («Как у стола» — его выбор) и колода.
// Только на этом телефоне, сохраняется сразу; есть в копии
function MyLookCard({ look, onChange }: { look: MyLook; onChange: (look: MyLook) => void }) {
  const [open, setOpen] = useState(false)

  function update(change: Partial<MyLook>) {
    const next = { ...look, ...change }
    saveMyLook(next)
    onChange(next)
  }

  return (
    <section className="card">
      <h2>Вид стола</h2>
      <p className="muted">
        Сукно, рубашка карт и колода — как столы выглядят на этом телефоне: в комнате, на одном телефоне, против ботов и в
        казино. У других игроков — их выбор. «Как у стола» — то, что выбрал ведущий.
      </p>
      <button type="button" className="big wide" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Свернуть вид стола' : 'Выбрать вид стола'}
      </button>
      {open && (
        <>
          <fieldset className="players-pick">
            <legend className="muted">Сукно</legend>
            <div className="amounts">
              <LookChoice on={look.felt === null} onPick={() => update({ felt: null })}>
                Как у стола
              </LookChoice>
              {MY_FELT_LABELS.map(([felt, label]) => (
                <LookChoice key={felt} on={look.felt === felt} onPick={() => update({ felt })}>
                  <span className={`look-swatch felt-${felt}`} aria-hidden="true" />
                  {label}
                </LookChoice>
              ))}
            </div>
          </fieldset>
          <fieldset className="players-pick">
            <legend className="muted">Рубашка</legend>
            <div className="amounts">
              <LookChoice on={look.cardBack === null} onPick={() => update({ cardBack: null })}>
                Как у стола
              </LookChoice>
              {MY_BACK_LABELS.map(([back, label]) => (
                <LookChoice key={back} on={look.cardBack === back} onPick={() => update({ cardBack: back })}>
                  <span className={`look-back back-${back}`} aria-hidden="true">
                    <span className="playing-card small back" />
                  </span>
                  {label}
                </LookChoice>
              ))}
            </div>
          </fieldset>
          <fieldset className="players-pick">
            <legend className="muted">Колода</legend>
            <div className="amounts">
              {DECK_LABELS.map(([deck, label]) => (
                <LookChoice key={deck} on={look.deck === deck} onPick={() => update({ deck })}>
                  {label}
                </LookChoice>
              ))}
            </div>
            <div className="card-row deck-sample" aria-hidden="true">
              {DECK_SAMPLE.map((c) => (
                <PlayingCard key={c} card={c} size="mid" />
              ))}
            </div>
          </fieldset>
        </>
      )}
    </section>
  )
}

// Образец колоды: по карте каждой масти
const DECK_SAMPLE = ['As', 'Kh', 'Qd', 'Jc']

function LookChoice(props: { on: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={props.on ? 'big primary' : 'big'} aria-pressed={props.on} onClick={props.onPick}>
      {props.children}
    </button>
  )
}

// Заметки об игроках (Р-56): подписи цветов — переименовываются здесь, сохраняются сразу; пусто — подпись по умолчанию.
// Хранятся на устройстве (localStorage) и идут в копию
function NoteColorsCard() {
  const [open, setOpen] = useState(false)
  const [texts, setTexts] = useState<Record<NoteColor, string>>(() => {
    const { labels } = loadNotes()
    return Object.fromEntries(NOTE_COLORS.map((c) => [c.id, labelOf(labels, c.id)])) as Record<NoteColor, string>
  })

  function rename(color: NoteColor, text: string) {
    setTexts((t) => ({ ...t, [color]: text }))
    const state = loadNotes()
    saveNotes({ ...state, labels: setLabel(state.labels, color, text) })
  }

  return (
    <section className="card">
      <h2>Заметки об игроках</h2>
      <p className="muted">
        За столом касание имени игрока — заметка: цвет и текст. У места — точка этого цвета. Заметки видны только на этом
        телефоне, в комнату и на сервер не уходят; есть в копии.
      </p>
      <button type="button" className="big wide" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Свернуть цвета' : 'Цвета заметок'}
      </button>
      {open && (
        <ul className="note-labels">
          {NOTE_COLORS.map((c) => (
            <li key={c.id}>
              <span className="note-swatch" style={{ background: c.hex }} />
              <input
                aria-label={`Подпись — ${c.name}`}
                maxLength={NOTE_LABEL_MAX}
                placeholder={c.label}
                value={texts[c.id]}
                onChange={(e) => rename(c.id, e.target.value)}
              />
            </li>
          ))}
        </ul>
      )}
      {open && <p className="muted">Подпись меняется сразу везде, где стоит этот цвет. Пусто — снова по умолчанию.</p>}
    </section>
  )
}

// Демо-данные (Р-04): выдуманные игры, чтобы показать приложение; удаляются только они.
// Уже есть — «Добавить» неактивна: второй раз не удваивает
function DemoCard() {
  const [demo, setDemo] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)

  useEffect(() => {
    void listGames().then((games) => setDemo(hasDemo(games)))
  }, [])

  async function add() {
    setBusy(true)
    try {
      if (hasDemo(await listGames())) {
        setDemo(true)
        return
      }
      const games = demoGames(today(), new Date().toISOString(), () => ulid())
      await restoreGames(games)
      setDemo(true)
      setNote({ ok: true, text: `Добавлено демо-игр: ${games.length} — они на «Играх»` })
    } catch {
      setNote({ ok: false, text: 'Не удалось добавить — попробуйте ещё раз' })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      const n = await deleteDemoGames()
      setDemo(false)
      setNote({ ok: true, text: `Удалено демо-игр: ${n}. Ваши игры на месте` })
    } catch {
      setNote({ ok: false, text: 'Не удалось удалить — попробуйте ещё раз' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>Демо-данные</h2>
      <p className="muted">
        Несколько выдуманных игр с выдуманными игроками — показать приложение, не трогая настоящие игры. В статистику и
        в копию они не идут, постоянные игроки не меняются.
      </p>
      <button
        type="button"
        className="big primary wide"
        disabled={demo !== false || busy}
        onClick={() => void add()}
      >
        Добавить демо-данные
      </button>
      {demo && note === null && <p className="muted">Демо уже добавлено — добавить заново можно после удаления</p>}
      <button type="button" className="big wide" disabled={demo !== true || busy} onClick={() => void remove()}>
        Удалить демо-данные
      </button>
      {note && <p className={note.ok ? 'ok' : 'warn'}>{note.text}</p>}
    </section>
  )
}
