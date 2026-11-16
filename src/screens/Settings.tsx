import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import {
  backupFileName,
  backupText,
  lastBackupText,
  makeBackup,
  mergeOwnGames,
  mergePokerPrefs,
  parseBackup,
  planRestore,
  type PokerPrefs,
} from '../calc/backup'
import {
  addBet,
  isDefaultBets,
  parsePotPct,
  parsePreTenths,
  POT_PCT_MAX,
  POT_PCT_MIN,
  potBetLabel,
  PRE_TENTHS_MAX,
  PRE_TENTHS_MIN,
  preBetLabel,
  QUICK_BETS_DEFAULT,
  QUICK_BETS_MAX,
  type QuickBets,
} from '../calc/quickBets'
import { QUICK_ROOM_DEFAULT, quickRoomError, quickRoomLine, quickRoomSettings, type QuickRoom } from '../calc/quickRoom'
import { RoomFields, roomChoiceOf, roomFormOf, type RoomForm } from './RoomFields'
import { demoGames, hasDemo } from '../calc/demo'
import { formatNumber, formatRate, parseChips, parseRate, pluralForm } from '../calc/format'
import { formatDate, today } from '../dates'
import { PROTOCOL_VERSION } from '../poker/protocol'
import { loadOpenGroups, saveOpenGroups, type SettingsGroup } from './settingsGroups'
import { MAX_WINDOW, MIN_WINDOW, moveItem, type Game, type Regular, type Settings } from '../model'
import { eveningCounts, isBotsEvening, type EveningCounts, type EveningSummary, type SavedHand } from '../calc/evenings'
import type { OwnChart } from '../calc/ownCharts'
import {
  allHands,
  chartIds,
  deleteDemoGames,
  deleteEvenings,
  getSettings,
  handKeys,
  listCharts,
  listEvenings,
  listGames,
  restoreCharts,
  restoreGames,
  restoreHands,
  saveSettings,
} from '../store/db'
import { ulid } from '../ulid'
import { download } from './download'
import { loadLastBackup, saveLastBackup } from './lastBackup'
import { DEFAULT_SERVER, serverBase } from '../calc/pokerLink'
import { NOTE_COLORS, NOTE_LABEL_MAX, labelOf, mergeNotes, setLabel, type NoteColor } from '../calc/playerNotes'
import { mergeMyLook, type MyLook } from '../calc/pokerLook'
import { useBetStep, useBigBlinds } from './PokerRoom'
import { BET_STEP_DEFAULT, BET_STEP_LABELS } from '../calc/pokerLayout'
import {
  forgetBotHistory,
  loadBetStepChoice,
  loadBigBlindsChoice,
  loadCardAnim,
  loadDockSizeChoice,
  loadMyLook,
  loadNotes,
  loadOwnGames,
  loadQuickBets,
  loadQuickBetsChoice,
  loadQuickRoom,
  loadServer,
  loadTableSizeChoice,
  loadTurnSound,
  saveBetStep,
  saveBigBlinds,
  saveCardAnim,
  saveDockSize,
  saveMyLook,
  saveNotes,
  saveOwnGames,
  saveQuickBets,
  saveQuickRoom,
  saveServer,
  saveTableSize,
  saveTurnSound,
} from './pokerStorage'
import { useWide } from './useWide'
import { LookChoice, MyLookFields } from './MyLookFields'
import { THEME_ACCENT, THEME_COLOR, THEME_LABELS, themeOf } from '../calc/theme'
import { loadThemeChoice, saveTheme } from './theme'

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rateText, setRateText] = useState<string | null>(null)
  const [buyinText, setBuyinText] = useState('')
  const [saved, setSaved] = useState(false)
  const [myLook, setMyLook] = useState(loadMyLook) // личный «Вид стола» (Р-61): меняется и восстановлением из копии
  const [restored, setRestored] = useState(0) // восстановили из копии — карточки покер-рума (Р-62) читаются заново
  const [openGroups, setOpenGroups] = useState(loadOpenGroups) // развёрнутые разделы (#234), на этом устройстве

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

  function toggleGroup(group: SettingsGroup) {
    const next = { ...openGroups, [group]: !openGroups[group] }
    setOpenGroups(next)
    saveOpenGroups(next)
  }

  // Заголовок раздела — кнопка: свернуть и развернуть раздел целиком (#234)
  const title = (group: SettingsGroup, text: string) => (
    <h2 className="group-title">
      <button type="button" className="group-toggle" aria-expanded={openGroups[group]} onClick={() => toggleGroup(group)}>
        <span className="grow">{text}</span>
        <span className="muted" aria-hidden="true">
          {openGroups[group] ? '▾' : '▸'}
        </span>
      </button>
    </h2>
  )

  return (
    <main className="screen">
      <header className="bar">
        <a className="bar-link" href="#/">
          ← Игры
        </a>
      </header>
      <h1>Настройки</h1>

      {/* Р-53: на широком окне карточки — в две колонки, каждая не шире ≈ 640 px.
          Р-59: разделы по смыслу, заголовок раздела — над его карточками; ключи хранения прежние.
          Р-70: первый раздел — «Оформление», гамма всего приложения.
          #234: заголовок раздела сворачивает его карточки; карточки — соседи заголовка в .cards (не обёрнуты),
          иначе на широком окне сломается сетка */}
      {settings !== null && rateText !== null && (
        <div className="cards">
          {title('look', 'Оформление')}
          {openGroups.look && <ThemeCard key={`theme-${restored}`} />}

          {title('accounting', 'Учёт игр')}
          {openGroups.accounting && (
            <>
              <form className="card" onSubmit={(e) => void save(e)}>
                <h3>Новая игра</h3>
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
                <p className="muted">
                  При новой игре — вопрос, записать ли всем такой закуп. Он же сначала — стартовый стек в формах столов покера.
                </p>
                {buyin === null && <p className="warn">Закуп — целое число фишек больше нуля, например 1000</p>}
                {saved && <p className="ok">Сохранено</p>}
                <button className="big primary wide" disabled={rate === null || buyin === null}>
                  Сохранить
                </button>
              </form>

              <AmountsCard
                amounts={settings.quickAmounts}
                onChange={(quickAmounts) => update({ ...settings, quickAmounts })}
              />
            </>
          )}

          {title('players', 'Игроки')}
          {openGroups.players && (
            <>
              <PlayersCard players={settings.players} onChange={(players) => update({ ...settings, players })} />
              <WindowCard
                size={settings.compareWindow}
                onChange={(compareWindow) => update({ ...settings, compareWindow })}
              />
            </>
          )}

          {title('poker', 'Покер онлайн и стол')}
          {openGroups.poker && (
            <>
              <PokerServerCard />
              {/* Р-62: своя «Быстрая комната» и привычки покер-румов; восстановление из копии перечитывает их */}
              <QuickRoomCard
                key={`room-${restored}`}
                defaultBuyin={settings.defaultBuyin}
                players={settings.players.length}
              />
              <AtTableCard key={`bets-${restored}`} />
              <MyLookCard key={`look-${restored}`} look={myLook} onChange={setMyLook} />
            </>
          )}

          {title('notes', 'Заметки об игроках')}
          {openGroups.notes && <NoteColorsCard />}

          {title('backup', 'Копия данных')}
          {openGroups.backup && (
            <>
              <BackupCard
                settings={settings}
                onPlayers={(players) => setSettings((s) => s && { ...s, players })}
                onLook={() => {
                  setMyLook(loadMyLook())
                  setRestored((n) => n + 1)
                }}
              />
              {/* #242: удалить разом вечера против ботов или все прошлые вечера; восстановление из копии перечитывает числа */}
              <EveningsCard key={`evenings-${restored}`} />
            </>
          )}

          {title('demo', 'Демо-данные')}
          {openGroups.demo && <DemoCard />}
        </div>
      )}

      {/* #234: какая сборка и какой протокол покера — сверить за столом, у всех ли новое; из сборки, без сети */}
      <p className="muted version-line">
        Версия: {formatDate(__BUILD_DATE__)} · {__BUILD_COMMIT__} · протокол {PROTOCOL_VERSION}
      </p>
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
      <h3>Постоянные игроки</h3>
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
      <h3>Быстрые суммы, фишек</h3>
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
      <h3>Окно сравнения, игр</h3>
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
  const [charts, setCharts] = useState<OwnChart[]>([])
  const [note, setNote] = useState<Note | null>(null)
  const [last, setLast] = useState(loadLastBackup)
  const fileInput = useRef<HTMLInputElement>(null)
  const shareFiles = canShareFiles()

  // Игры, раздачи и свои чарты читаются заранее: Safari открывает «Поделиться» только сразу после касания, без ожидания базы
  useEffect(() => {
    void listGames().then(setGames)
    allHands().then(setHands, () => setHands([]))
    listCharts().then(setCharts, () => setCharts([]))
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
    return makeBackup(games ?? [], settings, now, hands, notes, labels, loadMyLook(), localPokerPrefs(), charts, loadOwnGames())
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
    // Свои чарты (Р-77) — так же: в копии их нет — их хранилище не читаем
    let ownIds: string[] = []
    if (parsed.backup.charts.length > 0) {
      try {
        ownIds = await chartIds()
      } catch {
        setNote({ ok: false, text: 'Не удалось прочитать чарты на этом телефоне — попробуйте ещё раз' })
        return
      }
    }
    const plan = planRestore(
      (await listGames()).map((g) => g.id),
      current.players,
      parsed.backup,
      keys,
      ownIds,
    )
    try {
      await restoreGames(plan.added)
      await restoreHands(plan.hands)
      await restoreCharts(plan.charts)
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
    // Покер-рум (Р-62): так же — из копии то, что здесь не задано
    const poker = mergePokerPrefs(localPokerPrefs(), parsed.backup.poker)
    saveQuickRoom(poker.quickRoom)
    if (poker.bigBlinds !== null) saveBigBlinds(poker.bigBlinds)
    saveQuickBets(poker.quickBets)
    // Размер стола и панели (Р-63): так же
    saveTableSize(poker.tableSize)
    saveDockSize(poker.dockSize)
    // Шаг колеса и «−»/«+» (Р-69): так же
    saveBetStep(poker.betStep)
    // Гамма (Р-70): здесь не выбрана — из копии, и сразу на экране; выбранная здесь остаётся
    saveTheme(poker.theme)
    // Свои игры (Р-85): из копии — те, которых здесь нет по id; свои не трогаются
    const ownBefore = loadOwnGames()
    const ownGames = mergeOwnGames(ownBefore, parsed.backup.ownGames)
    saveOwnGames(ownGames)
    onLook()
    onPlayers(plan.players)
    setGames(await listGames())
    if (plan.hands.length > 0) allHands().then(setHands, () => undefined)
    if (plan.charts.length > 0) listCharts().then(setCharts, () => undefined)
    const handsNote = plan.hands.length > 0 ? `; раздач покера добавлено ${plan.hands.length}` : ''
    const notesNote = merged.added > 0 ? `; заметок об игроках добавлено ${merged.added}` : ''
    const chartsNote = plan.charts.length > 0 ? `; чартов добавлено ${plan.charts.length}` : ''
    const ownAdded = ownGames.length - ownBefore.length
    const ownNote = ownAdded > 0 ? `; своих игр добавлено ${ownAdded}` : ''
    setNote({ ok: true, text: `Добавлено ${plan.added.length}, уже были ${plan.existing}${handsNote}${notesNote}${chartsNote}${ownNote}` })
  }

  return (
    <section className="card">
      <p className="muted">
        Игры хранятся только в этом браузере: очистка данных сайта или новый телефон их сотрут. Копия — файл со всеми
        играми, настройками, раздачами прошлых вечеров покера, заметками об игроках, видом и размером стола, быстрой
        комнатой, быстрыми ставками, шагом колеса ставки, оформлением и своими чартами тренажёра; восстановление добавляет недостающее и ничего не перезаписывает.
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
// Хранится на устройстве (localStorage), не в базе и не в копии. До Р-59 — карточка «Покер онлайн» со звуком и анимацией
function PokerServerCard() {
  const [text, setText] = useState(loadServer)
  const [saved, setSaved] = useState(false)
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
      <h3>Сервер покера</h3>
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
      <p className="muted">
        Пусто — постоянный сервер. Свой адрес — если сервер переехал или есть свой: новые комнаты и входы по коду идут на
        него. Игрокам вписывать не нужно — ссылка на стол несёт адрес сама.
      </p>
      {base === null && <p className="warn">Адрес — вида https://сервер, без пробелов</p>}
      {saved && <p className="ok">Сохранено</p>}
      <button className="big primary wide" disabled={base === null}>
        Сохранить
      </button>
    </form>
  )
}

// Покер-рум этого телефона (Р-62) — для копии: что задано здесь; не задано — null
function localPokerPrefs(): PokerPrefs {
  return {
    quickRoom: loadQuickRoom(),
    bigBlinds: loadBigBlindsChoice(),
    quickBets: loadQuickBetsChoice(),
    tableSize: loadTableSizeChoice(),
    dockSize: loadDockSizeChoice(),
    betStep: loadBetStepChoice(),
    theme: loadThemeChoice(),
  }
}

// «За столом» (Р-59): всё, что меняет стол на этом телефоне, — сохраняется сразу.
// Звук «ваш ход» (#75) и «Анимация карт» (#133) — только на устройстве, не в копии (до Р-59 — в «Покер онлайн»);
// суммы в больших блайндах и свои быстрые ставки (Р-62), шаг колеса и «−»/«+» (Р-69) — есть в копии (до Р-59 — карточка «Покер-рум»)
function AtTableCard() {
  const [sound, setSound] = useState(loadTurnSound)
  const [anim, setAnim] = useState(loadCardAnim)
  const bb = useBigBlinds() // та же настройка, что касание своего места за столом (Р-64)
  const step = useBetStep() // шаг колеса и «−»/«+» (Р-69): восстановление из копии видно сразу
  const [bets, setBets] = useState(loadQuickBets)
  const [open, setOpen] = useState(false)

  function update(next: QuickBets | null) {
    saveQuickBets(next && !isDefaultBets(next) ? next : null)
    setBets(next ?? QUICK_BETS_DEFAULT)
  }

  return (
    <section className="card">
      <h3>За столом</h3>
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
      <label className="check">
        <input
          type="checkbox"
          checked={bb}
          onChange={(e) => saveBigBlinds(e.target.checked)}
        />
        Стеки и ставки в больших блайндах
      </label>
      <p className="muted">
        За столом стеки, ставки, банк и суммы на кнопках хода — в больших блайндах раздачи: «42,5 ББ». История раздач и
        выгрузка — фишками. Переключить можно и за столом: касание своего имени или стека, а на столе одного телефона —
        касание банка. Только на этом телефоне; есть в копии.
      </p>
      <fieldset className="players-pick">
        <legend className="muted">Шаг колеса и «−»/«+»</legend>
        <div className="amounts">
          {BET_STEP_LABELS.map(([id, label]) => (
            <LookChoice key={id} on={step === id} onPick={() => saveBetStep(id)}>
              {label}
              {id === BET_STEP_DEFAULT ? ' (по умолчанию)' : ''}
            </LookChoice>
          ))}
        </div>
      </fieldset>
      <p className="muted">
        На сколько меняют ставку колесо мыши над ползунком и кнопки «−» и «+» рядом с ним — в больших блайндах раздачи.
        Действует на столе сразу. Только на этом телефоне; есть в копии.
      </p>
      <p className="muted">Свои кнопки сумм над ползунком в свой ход. Только на этом телефоне; есть в копии.</p>
      <button type="button" className="big wide" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Свернуть быстрые ставки' : 'Быстрые ставки'}
      </button>
      {open && (
        <>
          <p className="muted">
            Кнопки над ползунком в свой ход, после «Мин». Сумма вне того, что можно поставить, — кнопки нет; в пот-лимите
            «Банк» — до предела банка. До {QUICK_BETS_MAX} кнопок каждого вида.
          </p>
          <BetsList
            title="После флопа — доля банка, %"
            placeholder="Например, 33"
            list={bets.pot}
            label={potBetLabel}
            parse={parsePotPct}
            hint={`Целое число от ${POT_PCT_MIN} до ${POT_PCT_MAX}; 33 — треть, 100 — банк`}
            onChange={(pot) => update({ ...bets, pot })}
          />
          <BetsList
            title="До флопа — больших блайндов"
            placeholder="Например, 2,5"
            list={bets.pre}
            label={preBetLabel}
            parse={parsePreTenths}
            hint={`От ${PRE_TENTHS_MIN / 10} до ${PRE_TENTHS_MAX / 10}, до десятых: 2,5`}
            onChange={(pre) => update({ ...bets, pre })}
          />
          <button type="button" className="big wide" disabled={isDefaultBets(bets)} onClick={() => update(null)}>
            Сбросить быстрые ставки
          </button>
        </>
      )}
    </section>
  )
}

// Своя «Быстрая комната» (Р-62): те же поля, что в форме «Новая комната», без игроков и пароля. Сохраняется
// кнопкой — блайнды и стек проверяются; стек, равный закупу по умолчанию, следует за ним. «Сбросить» — начальные значения
function QuickRoomCard({ defaultBuyin, players }: { defaultBuyin: number; players: number }) {
  const [open, setOpen] = useState(false)
  const [own, setOwn] = useState(loadQuickRoom)
  const [form, setForm] = useState<RoomForm>(() =>
    roomFormOf(own ?? QUICK_ROOM_DEFAULT, String(own?.startingStack ?? defaultBuyin), players),
  )
  const [saved, setSaved] = useState(false)
  const choice = roomChoiceOf(form)
  const error = choice ? quickRoomError(choice) : null

  function change(next: RoomForm) {
    setForm(next)
    setSaved(false)
  }

  function save(e: FormEvent) {
    e.preventDefault()
    if (!choice || error) return
    const room: QuickRoom = { ...choice, startingStack: choice.startingStack === defaultBuyin ? null : choice.startingStack }
    saveQuickRoom(room)
    setOwn(room)
    setSaved(true)
  }

  function reset() {
    saveQuickRoom(null)
    setOwn(null)
    setForm(roomFormOf(QUICK_ROOM_DEFAULT, String(defaultBuyin), players))
    setSaved(false)
  }

  return (
    <form className="card" onSubmit={save}>
      <h3>Быстрая комната</h3>
      <p className="muted">
        По умолчанию для кнопки «Быстрая комната» на «Играть»: с какой игрой, блайндами, стеком и таймером она создаёт
        стол одним касанием. Для одного стола — «Настроить…» там же. Только на этом телефоне; есть в копии.
      </p>
      <p>{quickRoomLine(quickRoomSettings(defaultBuyin, own, loadOwnGames()))}</p>
      <button type="button" className="big wide" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Свернуть быструю комнату' : 'Настроить быструю комнату'}
      </button>
      {open && (
        <>
          <RoomFields form={form} players={players} onChange={change} />
          {error && <p className="warn">{error}</p>}
          {saved && <p className="ok">Сохранено</p>}
          <div className="row">
            <button className="big primary grow" disabled={!choice || error !== null}>
              Сохранить
            </button>
            <button type="button" className="big" disabled={own === null && !saved} onClick={reset}>
              Сбросить
            </button>
          </div>
        </>
      )}
    </form>
  )
}

// Список своих кнопок одного вида: подписи, «✕», ввод новой
function BetsList(props: {
  title: string
  placeholder: string
  list: number[]
  label: (n: number) => string
  parse: (text: string) => number | null
  hint: string
  onChange: (list: number[]) => void
}) {
  const { title, placeholder, list, label, parse, hint, onChange } = props
  const [text, setText] = useState('')
  const value = parse(text)
  const duplicate = value !== null && list.includes(value)
  const full = list.length >= QUICK_BETS_MAX

  function add(e: FormEvent) {
    e.preventDefault()
    if (value === null || duplicate || full) return
    onChange(addBet(list, value))
    setText('')
  }

  return (
    <fieldset className="players-pick">
      <legend className="muted">{title}</legend>
      {list.length > 0 ? (
        <ul className="list items">
          {list.map((n) => (
            <li key={n} className="item">
              <span className="grow">{label(n)}</span>
              <button
                type="button"
                className="icon"
                aria-label={`Убрать «${label(n)}»`}
                onClick={() => onChange(list.filter((x) => x !== n))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Своих кнопок нет — только «Мин» и олл-ин.</p>
      )}
      <form className="row" onSubmit={add}>
        <input
          className="grow"
          inputMode="decimal"
          aria-label={title}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="big primary" disabled={value === null || duplicate || full}>
          Добавить
        </button>
      </form>
      {text.trim() !== '' && value === null && <p className="warn">{hint}</p>}
      {duplicate && <p className="warn">Такая кнопка уже есть</p>}
      {full && <p className="muted">Кнопок уже {QUICK_BETS_MAX} — уберите одну, чтобы добавить</p>}
    </fieldset>
  )
}

// Личный «Вид стола» (Р-61): сукно и рубашка поверх выбора ведущего («Как у стола» — его выбор) и колода.
// На широком окне (Р-63) — ещё размер стола покера и панели ставок. Только на этом телефоне, сохраняется сразу; есть в копии
function MyLookCard({ look, onChange }: { look: MyLook; onChange: (look: MyLook) => void }) {
  const [open, setOpen] = useState(false)
  const wide = useWide()

  return (
    <section className="card">
      <h3>Вид стола</h3>
      <p className="muted">
        Сукно, рубашка карт и колода — как столы выглядят на этом телефоне: в комнате, на одном телефоне, против ботов и в
        казино. У других игроков — их выбор. «Как у стола» — то, что выбрано для стола: ведущим комнаты или при начале
        стола на этом телефоне.
        {wide && ' На широком окне здесь же — размер стола покера и панели ставок.'}
      </p>
      <button type="button" className="big wide" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Свернуть вид стола' : 'Выбрать вид стола'}
      </button>
      {/* Поля — общие с «⚙» за столом (#243) */}
      {open && <MyLookFields look={look} onChange={onChange} />}
    </section>
  )
}

// «Оформление» (Р-70): гамма всего приложения — касание меняет цвета сразу, без перезагрузки.
// Не выбрано — «Ночь». Только на этом телефоне, есть в копии
function ThemeCard() {
  const [theme, setTheme] = useState(() => themeOf(loadThemeChoice()))

  return (
    <section className="card">
      <div className="amounts">
        {THEME_LABELS.map(([id, label]) => (
          <LookChoice
            key={id}
            on={theme === id}
            onPick={() => {
              setTheme(id)
              saveTheme(id)
            }}
          >
            <span
              className="theme-swatch"
              aria-hidden="true"
              style={{ background: `linear-gradient(90deg, ${THEME_COLOR[id]} 50%, ${THEME_ACCENT[id]} 50%)` }}
            />
            {label}
          </LookChoice>
        ))}
      </div>
      <p className="muted">Меняет цвета всего приложения. Сукно и рубашки — в «Виде стола».</p>
    </section>
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
// «Прошлые вечера» (#242): удалить пачкой — вечера против ботов или все прошлые вечера покера, с вопросом,
// который называет числа. Игры учёта не трогаются (у них удаление своё). Нет таких вечеров — кнопка неактивна
function EveningsCard() {
  const [evenings, setEvenings] = useState<EveningSummary[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<Note | null>(null)

  function reload() {
    listEvenings().then(setEvenings, () => setEvenings([]))
  }

  useEffect(reload, [])

  async function remove(onlyBots: boolean) {
    if (!evenings) return
    const c = eveningCounts(evenings, onlyBots)
    if (c.evenings === 0) return
    if (!confirm(`Удалить ${eveningsText(c)} с этого телефона? Вернуть можно только из файл-копии`)) return
    setBusy(true)
    try {
      const done = await deleteEvenings(onlyBots)
      forgetBotHistory((id) => !onlyBots || isBotsEvening({ id })) // идущий стол с ботами не запишет стёртое заново
      setNote({ ok: true, text: `Удалено: ${eveningsText(done)}. Игры учёта на месте` })
    } catch {
      setNote({ ok: false, text: 'Не удалось удалить — попробуйте ещё раз' })
    } finally {
      setBusy(false)
      reload()
    }
  }

  const bots = evenings && eveningCounts(evenings, true)
  const all = evenings && eveningCounts(evenings, false)
  return (
    <section className="card">
      <h3>Прошлые вечера</h3>
      <p className="muted">Раздачи покера на этом телефоне — из «Играть» → «Прошлые вечера». Игры учёта не удаляются.</p>
      <EveningsButton
        label="Удалить вечера против ботов"
        counts={bots}
        busy={busy}
        onClick={() => void remove(true)}
      />

      <EveningsButton label="Удалить все прошлые вечера" counts={all} busy={busy} onClick={() => void remove(false)} />
      {note && <p className={note.ok ? 'ok' : 'warn'}>{note.text}</p>}
    </section>
  )
}

// Кнопка удаления пачкой: в подписи — сколько вечеров и раздач; нет таких — неактивна, рядом «нет вечеров»
function EveningsButton(props: { label: string; counts: EveningCounts | null; busy: boolean; onClick: () => void }) {
  const { label, counts, busy, onClick } = props
  const none = counts !== null && counts.evenings === 0
  return (
    <div className="row">
      <button type="button" className="big danger-text grow" disabled={counts === null || none || busy} onClick={onClick}>
        {counts && !none ? `${label} (${eveningsWord(counts)}, ${handsWord(counts)})` : label}
      </button>
      {none && <span className="muted">нет вечеров</span>}
    </div>
  )
}

// «12 вечеров», «340 раздач», «12 вечеров (340 раздач)»
function eveningsWord(c: EveningCounts): string {
  return `${formatNumber(c.evenings)} ${pluralForm(c.evenings, 'вечер', 'вечера', 'вечеров')}`
}

function handsWord(c: EveningCounts): string {
  return `${formatNumber(c.hands)} ${pluralForm(c.hands, 'раздача', 'раздачи', 'раздач')}`
}

function eveningsText(c: EveningCounts): string {
  return `${eveningsWord(c)} (${handsWord(c)})`
}

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
