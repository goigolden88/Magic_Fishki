import { useEffect, useRef, useState, type FormEvent } from 'react'
import { formatChips, formatNumber, formatRub, parseChips } from '../calc/format'
import {
  betSide,
  betSlider,
  dockOf,
  sliderAmount,
  sliderIndex,
  spotsBySeat,
  stepAmount,
  waitLine,
  type BetSlider,
  type Spot,
} from '../calc/pokerLayout'
import { NO_CONNECTION, roomLink, ROOM_CLOSED, UPDATE_APP, type Seat } from '../calc/pokerLink'
import {
  cardFace,
  defaultWinners,
  finalStacks,
  historyHandView,
  historyList,
  lastHandRecord,
  lastHandWins,
  myTurnMark,
  tableView,
  toggleWinner,
  winnersReady,
  type ActionsView,
  type HistoryHandView,
  type LastHandView,
  type SeatView,
  type TableView,
} from '../calc/pokerView'
import {
  activePreAction,
  preActionMove,
  showPreActions,
  streetKey,
  togglePreAction,
  type PreAction,
  type PreActionMark,
} from '../calc/preAction'
import { roomEvening } from '../calc/evenings'
import { gameFromTable, gameFromTournament } from '../calc/pokerGame'
import { lookClass, lookOf } from '../calc/pokerLook'
import { timerSettings, turnSecondsOf } from '../calc/pokerTimer'
import { levelText, prizesOf } from '../calc/tournamentForm'
import { formatDate, today } from '../dates'
import { DEFAULT_QUICK_AMOUNTS } from '../model'
import type { Card } from '../poker/cards'
import type { HistoryHand } from '../poker/history'
import { FINISHED, type ClientBody } from '../poker/protocol'
import { limitFor, type TableState } from '../poker/table'
import { getSettings, saveGame } from '../store/db'
import { ulid } from '../ulid'
import { NO_COPY, useHandCopy } from './handCopy'
import { openGameYear } from './openYears'
import { HudCard, HudFields, HudLine } from './Hud'
import { LookFields } from './LookFields'
import { loadOpenCards, loadRecordedGame, loadTurnSound, saveOpenCards, saveRecordedGame } from './pokerStorage'
import { TimerFields, timerForm, type TimerForm } from './TimerFields'
import { PrizeFields, TournamentPanel, TournamentResults } from './Tournament'
import { signalTurn, unlockSound } from './turnSignal'
import { useRoom, type Lobby, type Room } from './useRoom'

// Стол покера онлайн (Р-14, Р-19): вход по ссылке, ставки с телефонов, кнопки ведущего.
// Карты живые — на столе; экран ведёт фишки, банки и очередь хода. Карты на телефонах (Р-23) —
// свои карты под пальцем («Подглядеть»), общие — в центре стола, банки раздаются сами
export function PokerRoomScreen({ code }: { code: string }) {
  const room = useRoom(code)
  const [note, setNote] = useState<string | null>(null)
  const [gameId, setGameId] = useState<string | null>(null) // итог этого стола записан игрой на этом телефоне

  useEffect(() => {
    setGameId(room.me ? loadRecordedGame(code, room.me) : null)
  }, [code, room.me])

  async function shareRoom() {
    const url = roomLink(location.href, code)
    setNote(await shareLink(`Покер — стол ${code}: ${url}`))
  }

  // «Закончить игру» (Р-20): итог — игрой в историю на этом телефоне, затем комната закрывается у всех.
  // Без связи игра всё равно записывается — из стола, который уже есть; повтор второй игры не пишет.
  // Турнир (#78) пишется, только когда окончен, — по курсу 1 ₽ за фишку; не окончен — комната закрывается без записи
  async function finish(table: TableState): Promise<string | null> {
    const me = room.me
    if (!me) return null
    let id = loadRecordedGame(code, me)
    const tournament = table.settings.format === 'tournament'
    if (!id && (!tournament || typeof table.tournament?.endedAt === 'number')) {
      try {
        const settings = await getSettings()
        const date = today()
        const now = new Date().toISOString()
        const game = tournament
          ? gameFromTournament(table, { name: `Турнир ${formatDate(date)}`, date, now }, () => ulid())
          : gameFromTable(table, { name: formatDate(date), date, rate: settings.defaultRate, now }, () => ulid())
        await saveGame(game)
        saveRecordedGame(code, me, game.id)
        openGameYear(date)
        id = game.id
      } catch {
        return 'Не удалось записать игру на этом телефоне — комната не закрыта'
      }
    }
    setGameId(id)
    room.send({ type: 'finish' })
    return null
  }

  // За столом (#97) — экран колонкой по высоте окна: шапка в строку, стол, панель хода внизу
  const seated = room.phase === 'seated' && room.table !== null && room.me !== null
  return (
    <main className={seated ? 'screen poker table-screen' : 'screen poker'}>
      <header className="bar">
        <a className="bar-link" href="#/poker">
          ← Покер
        </a>
        {seated && <h1 className="bar-title">Стол {code}</h1>}
        {(room.phase === 'lobby' || room.phase === 'seated') && (
          <button type="button" className={seated ? 'primary bar-button' : 'big primary'} onClick={() => void shareRoom()}>
            Поделиться
          </button>
        )}
      </header>
      {!seated && <h1>Стол {code}</h1>}
      {note && <p className="ok">{note}</p>}

      {!room.online && room.failed && (room.phase === 'loading' || room.phase === 'lobby' || room.phase === 'seated') && (
        <p className="card warn">{NO_CONNECTION} — подключаемся снова… Учёт вечера работает и без сети.</p>
      )}

      {room.phase === 'loading' && !room.failed && <p className="muted">Подключение…</p>}
      {room.phase === 'lobby' && room.lobby && <LobbyCard lobby={room.lobby} room={room} />}
      {room.phase === 'seated' && room.table && room.me && (
        <TableCard room={room} table={room.table} me={room.me} code={code} gameId={gameId} onFinish={finish} />
      )}
      {room.phase === 'closed' && <ClosedCard ended={room.ended} gameId={gameId} />}
      {room.phase === 'update' && (
        <section className="card">
          <h2>{UPDATE_APP}</h2>
          <p className="muted">У сервера другая версия. Закройте приложение и откройте снова — оно обновится само.</p>
          <button type="button" className="big primary wide" onClick={() => location.reload()}>
            Обновить
          </button>
        </section>
      )}
      {room.phase === 'replaced' && (
        <section className="card">
          <h2>Стол открыт на другом устройстве</h2>
          <p className="muted">Ваше место сейчас на другом телефоне или в другом браузере.</p>
          <button type="button" className="big primary wide" onClick={room.resume}>
            Вернуться сюда
          </button>
        </section>
      )}
    </main>
  )
}

// Телефон — системное «Поделиться» (Телеграм и т. п.); где его нет — в буфер обмена
async function shareLink(text: string): Promise<string | null> {
  if ('share' in navigator) {
    try {
      await navigator.share({ text })
      return null
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null // передумали
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'Ссылка скопирована — вставьте её в чат'
  } catch {
    return 'Не удалось скопировать'
  }
}

function LobbyCard({ lobby, room }: { lobby: Lobby; room: Room }) {
  const [guest, setGuest] = useState(lobby.roster.length === 0)
  const [name, setName] = useState('')
  const seated = new Set(lobby.seated)

  function sitGuest(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) room.join({ name: name.trim() })
  }

  return (
    <section className="card">
      <h2>Кто вы?</h2>
      {lobby.roster.map((r) => (
        <button
          key={r.id}
          type="button"
          className="big wide"
          disabled={seated.has(r.id) || !room.online}
          onClick={() => room.join({ regularId: r.id })}
        >
          {r.name}
          {seated.has(r.id) && <span className="muted"> · за столом</span>}
        </button>
      ))}
      {guest ? (
        <form onSubmit={sitGuest}>
          <label className="field">
            Ваше имя
            <input autoFocus={lobby.roster.length > 0} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="big primary wide" disabled={!name.trim() || !room.online}>
            Сесть за стол
          </button>
        </form>
      ) : (
        <button type="button" className="big wide" onClick={() => setGuest(true)}>
          Гость
        </button>
      )}
      {room.error && <p className="warn">{room.error}</p>}
    </section>
  )
}

type Finish = (table: TableState) => Promise<string | null> // отказ — текст ошибки

function TableCard(props: { room: Room; table: TableState; me: string; code: string; gameId: string | null; onFinish: Finish }) {
  const { room, table, me, code, gameId, onFinish } = props
  const [, setTick] = useState(0)
  const [amounts, setAmounts] = useState<number[]>(DEFAULT_QUICK_AMOUNTS)
  const signaled = useRef<string | null>(null)
  const [open, setOpen] = useState(loadOpenCards) // «Карты всегда открыты» на этом устройстве (#86) — сохраняется сразу
  const onOpen = (on: boolean) => {
    setOpen(on)
    saveOpenCards(on)
  }

  // Часы раз в секунду — секунды на ход и «Взять ведение»: ведущий вне сети дольше минуты.
  // Время — сервера (room.serverNow), не телефона
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    void getSettings().then((s) => setAmounts(s.quickAmounts))
  }, [])

  // Звук браузер пускает только после касания страницы
  useEffect(() => {
    document.addEventListener('pointerdown', unlockSound)
    return () => document.removeEventListener('pointerdown', unlockSound)
  }, [])

  // Мой ход начался — знак: звук (если не выключен на этом устройстве) и вибрация; раз на ход
  const mark = myTurnMark(table, me)
  useEffect(() => {
    if (mark !== null && mark !== signaled.current) signalTurn(loadTurnSound())
    signaled.current = mark
  }, [mark])

  // История раздач (#113) — у сервера: взять при входе, и заново, когда окончилась раздача, кто-то «Показал»
  // или вернулась связь. Без связи не просим: в карточке — «нет связи», стол работает дальше.
  // Каждый ответ — в копию на этом телефоне (#114), и когда карточка «История раздач» закрыта.
  // askHistory — новый на каждый вид стола, поэтому в зависимостях только эти два
  const [history, setHistory] = useState(false)
  const lastKey = JSON.stringify([table.lastHand?.number, table.lastHand?.record?.shown])
  const { online, askHistory } = room
  useEffect(() => {
    if (online) askHistory()
  }, [online, lastKey])
  const copyWorks = useHandCopy(roomEvening(code, table), room.history)

  const v = tableView(table, me, room.serverNow())
  const sb = table.hand?.sb ?? table.settings.sb
  const dock = dockOf(v)

  // Ход заранее (#115): флажок держится до конца улицы; пришла очередь и есть связь — ход уходит сам,
  // один раз на очередь (метка хода), и флажок снимается. Без связи ждёт её
  const [preMark, setPreMark] = useState<PreActionMark | null>(null)
  const street = streetKey(v.handNumber, v.stage)
  const pre = activePreAction(preMark, street)
  const autoMove = room.online ? preActionMove(pre, v.actions) : null
  const autoSent = useRef<string | null>(null)
  useEffect(() => {
    if (autoMove === null || mark === null || autoSent.current === mark) return
    autoSent.current = mark
    setPreMark(null)
    room.send({ type: 'act', action: autoMove })
  }, [mark, autoMove?.type])

  // Вид стола (#77) — классом на обёртке: сукно и рубашки своих и чужих карт.
  // Колонка (#97): стол — на весь первый экран, под ним листается остальное, панель хода — внизу
  return (
    <div className={`table-layout ${lookClass(table.settings)}`}>
      <div className="table-scroll">
        <div className="table-stage">
          <p className="muted table-info">
            {blindsLine(table, v)} · {v.handNumber > 0 ? `раздача ${v.handNumber} · ` : ''}
            {v.stageLabel} · ведущий — {v.hostName}
          </p>
          <PokerTable
            view={v}
            open={open}
            onSeat={room.online ? (seat) => room.send({ type: 'moveSeat', seat }) : undefined}
          />
        </div>

        {v.myCards && <OpenCards open={open} onOpen={onOpen} />}
        {v.tournament && <TournamentPanel view={v.tournament} onEnd={() => room.send({ type: 'endTournament' })} />}

        {v.paused && (
          <p className="card warn">
            Перерыв: {v.stage !== null ? 'раздача доигрывается без таймера, ' : ''}новая не начнётся, пока ведущий не нажмёт
            «Продолжить»
          </p>
        )}

        <PotList view={v} />
        <LastHand table={table} view={v} />

        {history ? (
          <HandHistory
            hands={room.history}
            note={room.online ? null : `${NO_CONNECTION} — история придёт, когда связь вернётся`}
            onClose={() => setHistory(false)}
          />
        ) : (
          <button type="button" className="big wide" onClick={() => setHistory(true)}>
            История раздач
          </button>
        )}
        {!copyWorks && <p className="warn">{NO_COPY}</p>}

        {v.canShow && (
          <ShowCard
            show={v.canShow}
            online={room.online}
            open={open}
            onOpen={onOpen}
            onShow={(cards) => room.send({ type: 'show', cards })}
          />
        )}

        {v.canTakeHost && (
          <button type="button" className="big primary wide" onClick={() => room.send({ type: 'takeHost' })}>
            Взять ведение
          </button>
        )}

        {v.isHost && <HostCard room={room} table={table} view={v} code={code} gameId={gameId} onFinish={onFinish} />}

        <MyCard room={room} table={table} view={v} amounts={amounts} />
      </div>

      {room.error && (
        <p className="warn table-error" onClick={room.clearError}>
          {room.error}
        </p>
      )}

      {dock === 'turn' && v.actions && autoMove === null && (
        // Свой ход и новый минимум — сумма снова с минимума
        <ActionsCard
          key={`${v.handNumber}-${v.stage}-${v.actions.raise?.min ?? ''}`}
          actions={v.actions}
          sb={sb}
          who={null}
          left={v.turnLeft}
          online={room.online}
          onAct={(body) => room.send(body)}
        />
      )}
      {(dock === 'wait' || autoMove !== null) &&
        (showPreActions(v.actions) || autoMove !== null ? (
          <PreActionsDock
            line={waitLine(v)}
            pre={pre}
            onToggle={(kind) => {
              const next = togglePreAction(pre, kind)
              setPreMark(next !== null && street !== null ? { kind: next, street } : null)
            }}
          />
        ) : (
          <p className="dock wait-strip">{waitLine(v)}</p>
        ))}
      {dock === 'host' && (
        <HostDock
          view={v}
          pause
          onStart={() => room.send({ type: 'start' })}
          onPause={() => room.send({ type: 'pause', paused: !v.paused })}
        />
      )}
    </div>
  )
}

// Ход не мой, а я в раздаче (#115) — вместо полосы «Ждём хода» она же строкой и два флажка хода заранее:
// «Чек/пас» и «Колл любой». Отмечен — подсвечен; тап снимает, отмечен только один
function PreActionsDock(props: { line: string; pre: PreAction | null; onToggle: (kind: PreAction) => void }) {
  const { line, pre, onToggle } = props
  const flag = (kind: PreAction, label: string) => (
    <button
      type="button"
      className={pre === kind ? 'big primary grow' : 'big grow'}
      aria-pressed={pre === kind}
      onClick={() => onToggle(kind)}
    >
      {pre === kind ? '✓ ' : ''}
      {label}
    </button>
  )
  return (
    <section className="dock pre-actions">
      <p className="dock-title muted">{line}</p>
      <div className="dock-row">
        {flag('checkFold', 'Чек/пас')}
        {flag('callAny', 'Колл любой')}
      </div>
    </section>
  )
}

// Свои карты лежат на моём месте внизу стола (#97); переключатель «Всегда открыты» (#86) — под столом
function OpenCards({ open, onOpen }: { open: boolean; onOpen: (on: boolean) => void }) {
  return (
    <div className="open-cards">
      {!open && <p className="muted">Свои карты — на вашем месте внизу стола: держите на них палец, чтобы посмотреть</p>}
      <label className="check">
        <input type="checkbox" checked={open} onChange={(e) => onOpen(e.target.checked)} />
        Мои карты всегда открыты
      </label>
    </div>
  )
}

// Между раздачами у ведущего — внизу экрана: «Начать раздачу» и «Перерыв» / «Продолжить».
// pause — «Перерыв» есть на этом столе (на одном телефоне — только в идущем турнире)
export function HostDock(props: { view: TableView; pause: boolean; onStart: () => void; onPause: () => void }) {
  const { view: v, pause, onStart, onPause } = props
  const t = v.tournament
  return (
    <section className="dock">
      <div className="dock-row">
        {!v.paused && (
          <button type="button" className="big primary grow" disabled={!v.canStart} onClick={onStart}>
            {t && !t.started ? 'Начать турнир' : 'Начать раздачу'}
          </button>
        )}
        {pause && (
          <button type="button" className={v.paused ? 'big primary grow' : 'big'} onClick={onPause}>
            {v.paused ? 'Продолжить' : 'Перерыв'}
          </button>
        )}
      </div>
      {!v.paused && !v.canStart && <p className="muted dock-note">Нужно хотя бы двое с фишками, которые не пропускают раздачи</p>}
    </section>
  )
}

// Строка над столом: блайнды и анте раздачи (между раздачами — следующей); в турнире — с уровнем;
// омаха (#80) — с лимитом, шорт-дек (#81) — названием, холдем — без подписи
export function blindsLine(table: TableState, v: TableView): string {
  const hand = table.hand
  const t = v.tournament
  const blinds = hand ? { sb: hand.sb, bb: hand.bb, ante: hand.ante ?? 0 } : t ? t.blinds : { ...table.settings, ante: v.ante }
  const game =
    table.settings.game === 'omaha'
      ? `Омаха, ${limitFor(table.settings) === 'pot' ? 'пот-лимит' : 'без лимита'} · `
      : table.settings.game === 'shortdeck'
        ? 'Шорт-дек · '
        : ''
  return `${game}${t ? 'Турнир · ' : ''}Блайнды ${levelText(blinds)}`
}

// Под столом — банки с претендентами
export function PotList({ view: v }: { view: TableView }) {
  if (v.pots.length === 0) return null
  return (
    <ul className="list pots muted">
      {v.pots.map((p) => (
        <li key={p.label}>
          {p.label}: {formatNumber(p.amount)} — {p.eligible.map((x) => x.name).join(', ')}
        </li>
      ))}
    </ul>
  )
}

// Между раздачами — кто сколько забрал в прошлой; с картами на телефонах — вся запись раздачи
export function LastHand({ table, view: v }: { table: TableState; view: TableView }) {
  const wins = lastHandWins(table)
  const record = lastHandRecord(table)
  if (v.stage !== null || wins.length === 0) return null
  if (!record) return <p className="muted">Прошлая раздача: {wins.map((w) => `${w.name} +${formatNumber(w.amount)}`).join(', ')}</p>
  return (
    <section className="card last-hand">
      <h2>Прошлая раздача {record.number}</h2>
      <HandBody view={record} />
    </section>
  )
}

// Раздача целиком: стол, места с картами и комбинациями, кто сколько взял, ходы по улицам.
// Из истории (#113) — ещё стек каждого в начале и банки с именами взявших; ходы сразу раскрыты
function HandBody({ view: v }: { view: LastHandView | HistoryHandView }) {
  const full = 'chips' in v ? v : null
  return (
    <>
      {v.board.length > 0 && <CardRow cards={v.board} />}
      <ul className="list">
        {v.players.map((p, i) => (
          <li key={i} className="row">
            <span className="grow">
              {p.name}
              {full && <span className="muted"> · стек {formatNumber(full.chips[i])}</span>}
              {p.hand && <span className="muted"> · {p.hand}</span>}
              {p.best && (
                <span className="last-best">
                  <CardRow cards={p.best} size="small" />
                </span>
              )}
            </span>
            {p.cards && <CardRow cards={p.cards} size="small" />}
            {p.won > 0 && <span className="num plus">+{formatNumber(p.won)}</span>}
          </li>
        ))}
      </ul>
      {full?.pots.map((pot) => (
        <p key={pot.label} className="muted">
          {pot.label} {formatNumber(pot.amount)} — {pot.winners.join(', ')}
        </p>
      ))}
      {v.rounds.length > 0 && (
        <details open={full !== null}>
          <summary>Ходы</summary>
          {v.rounds.map((r) => (
            <p key={r.label}>
              <strong>{r.label}:</strong> {r.moves.join('; ')}
            </p>
          ))}
        </details>
      )}
    </>
  )
}

// «История раздач» вечера (#113): список — новые сверху, тап — раздача целиком, «← Все раздачи» — назад.
// Карточкой под столом: панель хода внизу экрана не закрывает, игра идёт. hands — null: ещё не пришла;
// note — почему не приходит (нет связи); старый список при этом остаётся.
// Прошлый вечер (#114) — та же карточка: title — вместо «История раздач», back — вместо «Закрыть»
export function HandHistory(props: {
  hands: HistoryHand[] | null
  note?: string | null
  title?: string
  back?: string
  onClose: () => void
}) {
  const { hands, note = null, title = 'История раздач', back = 'Закрыть', onClose } = props
  const [open, setOpen] = useState<number | null>(null)
  const ref = useRef<HTMLElement>(null)
  const hand = hands?.find((h) => h.number === open) ?? null
  const list = hands ? historyList(hands) : []

  // Открыли историю или раздачу — к её началу
  useEffect(() => ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), [open])

  return (
    <section ref={ref} className="card hand-history last-hand">
      <div className="history-head">
        <h2>{hand ? `Раздача ${hand.number}` : title}</h2>
        <button type="button" className="big" onClick={hand ? () => setOpen(null) : onClose}>
          {hand ? '← Все раздачи' : back}
        </button>
      </div>
      {hand ? (
        <HandBody view={historyHandView(hand)} />
      ) : (
        <>
          {note && <p className="warn">{note}</p>}
          {hands === null ? (
            !note && <p className="muted">Загружаем…</p>
          ) : list.length === 0 ? (
            <p className="muted">Раздач ещё не было</p>
          ) : (
            <ul className="list history-list">
              {list.map((item) => (
                <li key={item.number}>
                  <button type="button" className="history-item" onClick={() => setOpen(item.number)}>
                    <span className="history-number">№ {item.number}</span>
                    <span className="history-wins">{item.wins.map((w) => `${w.name} +${formatNumber(w.amount)}`).join(', ')}</span>
                    {item.board.length > 0 && <CardRow cards={item.board} size="small" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

// Карта лицом или рубашкой (null); mark — карта стола после вскрытия: из пятёрки победителя или приглушена.
// size: small — у чужих мест, mid — свои на моём месте (#97), big — «Банк ваш без вскрытия»
type CardSize = 'small' | 'mid' | 'big'

export function PlayingCard({ card, size, mark }: { card: Card | null; size?: CardSize; mark?: 'win' | 'dim' }) {
  const f = card === null ? null : cardFace(card)
  const cls = ['playing-card', size, !f && 'back', f?.red && 'red', mark].filter(Boolean).join(' ')
  if (!f) return <span className={cls} aria-label="карта рубашкой" />
  return (
    <span className={cls}>
      {f.rank}
      {f.suit}
    </span>
  )
}

// best — пятёрка победителя: ряд плотнее, чтобы войти в место у стола;
// win — карты из пятёрок победителей: они подсвечены, остальные в ряду приглушены
function CardRow(props: { cards: (Card | null)[]; size?: CardSize; best?: boolean; win?: Card[] | null }) {
  const { cards, size, best, win } = props
  return (
    <span className={best ? 'card-row best-row' : 'card-row'}>
      {cards.map((c, i) => (
        <PlayingCard key={i} card={c} size={size} mark={win && c ? (win.includes(c) ? 'win' : 'dim') : undefined} />
      ))}
    </span>
  )
}

// «Подглядеть»: свои карты рубашкой; держишь палец — лицом, отпустил — снова рубашкой.
// «Всегда открыты» (#86) — лицом без пальца; только на своём экране, сервер не знает.
// На моём месте у стола (#97) — без подписи (hint) и без переключателя: он под столом.
// label — моя комбинация сейчас (#105): видна, только пока карты лицом, иначе выдаст руку
function PeekCards(props: { cards: Card[]; open: boolean; size: CardSize; hint?: boolean; label?: string | null; className?: string }) {
  const { cards, open, size, hint, label = null, className = 'peek-cards' } = props
  const [peek, setPeek] = useState(false)
  const on = () => setPeek(true)
  const off = () => setPeek(false)

  // Ушли с экрана с пальцем на картах — закрыть
  useEffect(() => {
    document.addEventListener('visibilitychange', off)
    return () => document.removeEventListener('visibilitychange', off)
  }, [])

  // Рубашкой — пустая строка того же места: карты не прыгают под пальцем, когда подпись появляется
  const now = (shown: boolean) => label && <span className="seat-now">{shown ? label : ' '}</span>

  if (open)
    return (
      <>
        <div className={className}>
          {cards.map((c, i) => (
            <PlayingCard key={i} card={c} size={size} />
          ))}
        </div>
        {now(true)}
      </>
    )

  return (
    <>
      <div
        className={className}
        role="button"
        tabIndex={0}
        aria-pressed={peek}
        aria-label="Подглядеть свои карты — держите палец"
        onPointerDown={(e) => {
          e.preventDefault()
          on()
        }}
        onPointerUp={off}
        onPointerLeave={off}
        onPointerCancel={off}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && on()}
        onKeyUp={off}
        onBlur={off}
      >
        {cards.map((c, i) => (
          <PlayingCard key={i} card={peek ? c : null} size={size} />
        ))}
      </div>
      {now(peek)}
      {hint && <p className="muted">{peek ? 'Отпустите — карты закроются' : 'Подглядеть — держите палец на картах'}</p>}
    </>
  )
}

const ORDINALS = ['первую', 'вторую', 'третью', 'четвёртую', 'пятую']

// Взял банк без вскрытия: показать всем обе карты или одну — по желанию
function ShowCard(props: {
  show: { cards: Card[]; shown: boolean[] }
  online: boolean
  open: boolean
  onOpen: (on: boolean) => void
  onShow: (cards: number[]) => void
}) {
  const { show, online, open, onOpen, onShow } = props
  const left = show.cards.map((_, i) => i).filter((i) => !show.shown[i])
  return (
    <section className="card">
      <h2>Банк ваш без вскрытия</h2>
      <p className="muted">Можно показать карты всем — все или одну. До новой раздачи.</p>
      <PeekCards cards={show.cards} open={open} size="big" hint />
      <label className="check">
        <input type="checkbox" checked={open} onChange={(e) => onOpen(e.target.checked)} />
        Всегда открыты
      </label>
      <div className="amounts">
        {left.length > 1 && (
          <button type="button" className="big primary" disabled={!online} onClick={() => onShow(left)}>
            Показать все
          </button>
        )}
        {left.map((i) => (
          <button key={i} type="button" className="big" disabled={!online} onClick={() => onShow([i])}>
            Показать {ORDINALS[i] ?? i + 1}
          </button>
        ))}
      </div>
    </section>
  )
}

// Овальный стол: я внизу по центру, остальные по номерам мест по часовой (готовые точки — seatSpots
// на все «Мест за столом», spotsBySeat); между раздачами — и свободные места (#98). Ставка улицы — у места
// со стороны стола, в центре — улица и банк. Стол заполняет свою рамку (#97): у комнаты и у стола
// на телефоне — всё место над панелью хода. open — свои карты лицом без пальца (#86).
// onSeat — касание свободного места пересаживает меня туда; нет — свободные места только видны.
// HUD вечера (#79) — строкой у места, касание строки — подробно поверх стола
export function PokerTable(props: { view: TableView; open?: boolean; onSeat?: (seat: number) => void }) {
  const { view: v, open = false, onSeat } = props
  const [hudOf, setHudOf] = useState<string | null>(null)
  const bottom = v.me?.seat ?? 0
  const spots = spotsBySeat(v.maxSeats, v.me?.seat ?? null)
  const hudSeat = v.seats.find((s) => s.id === hudOf && s.hud !== null)
  return (
    <div className="felt-wrap">
      <div className="felt" />
      <div className="felt-center">
        <div className="muted">{v.stageLabel}</div>
        {v.stage !== null && (
          <div className="pot-total">
            Банк <strong>{formatNumber(v.pot)}</strong>
          </div>
        )}
        {v.pots.length > 1 &&
          v.pots.map((p) => (
            <div key={p.label}>
              {p.label} {formatNumber(p.amount)}
            </div>
          ))}
        {v.board.length > 0 && (
          <div className="board">
            <CardRow cards={v.board} win={v.boardWin} />
          </div>
        )}
        {v.paused && v.stage !== null && (
          <div>
            <strong>Перерыв</strong>
          </div>
        )}
        {v.nextHandLeft !== null && <div>Новая раздача через {v.nextHandLeft} с</div>}
      </div>
      <div className="spots">
        {v.seats.map((s) => (
          <SeatSpot
            key={s.id}
            seat={s}
            at={spots[s.seat]}
            bottom={s.seat === bottom}
            myCards={s.isMe ? v.myCards : null}
            myHand={s.isMe ? v.myHand : null}
            open={open}
            onHud={() => setHudOf(s.id)}
          />
        ))}
        {v.freeSeats.map((k) => (
          <FreeSeat key={`free-${k}`} seat={k} at={spots[k]} bottom={k === bottom} onSeat={onSeat} />
        ))}
      </div>
      {hudSeat?.hud && <HudCard name={hudSeat.name} hud={hudSeat.hud} onClose={() => setHudOf(null)} />}
    </div>
  )
}

// У бокового края — прижато к нему
function edgeOf(at: Spot): string | null {
  return at.x <= 10 ? 'edge-l' : at.x >= 90 ? 'edge-r' : null
}

// Свободное место между раздачами (#98): «Место N»; с onSeat — кнопка «пересесть», без — только видно
function FreeSeat(props: { seat: number; at: Spot; bottom: boolean; onSeat?: (seat: number) => void }) {
  const { seat, at, bottom, onSeat } = props
  const cls = ['seat', 'free', bottom ? 'bottom' : edgeOf(at)].filter(Boolean).join(' ')
  const style = { left: `${at.x}%`, top: `${at.y}%` }
  const name = <span className="seat-name">Место {seat + 1}</span>
  if (!onSeat) {
    return (
      <div className={cls} style={style}>
        {name}
        <span className="seat-mark">свободно</span>
      </div>
    )
  }
  return (
    <button type="button" className={cls} style={style} aria-label={`Пересесть на место ${seat + 1}`} onClick={() => onSeat(seat)}>
      {name}
      <span className="seat-mark">пересесть</span>
    </button>
  )
}

// Место у стола. bottom — нижнее по центру (я): растёт вверх от низа рамки, остальные — от своей точки
// в обе стороны. myCards — мои карты в раздаче: крупнее чужих, лицом — пока держишь палец или «всегда открыты»;
// myHand — подпись моей комбинации сейчас, у открытых карт.
// onHud — касание строки HUD (#79): подробно
function SeatSpot(props: {
  seat: SeatView
  at: Spot
  bottom: boolean
  myCards: Card[] | null
  myHand: string | null
  open: boolean
  onHud: () => void
}) {
  const { seat: s, at, bottom, myCards, myHand, open, onHud } = props
  const marks = [
    s.place !== null && `${s.place} место`,
    s.allIn && 'олл-ин',
    !s.online && 'вне сети',
    s.sittingOut && 'пропуск',
    s.folded && 'пас',
  ].filter(Boolean)
  // Омаха (#80): четыре карты у места — карты плотнее, моё место шире
  const many = (myCards ?? s.cards ?? []).length > 2
  const cls = [
    'seat',
    bottom ? 'bottom' : edgeOf(at),
    s.toAct && 'to-act',
    s.folded && 'folded',
    s.isMe && 'me',
    s.best && 'winner',
    many && 'many',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls} style={{ left: `${at.x}%`, top: `${at.y}%` }}>
      {s.position && <span className="seat-pos">{s.position}</span>}
      {s.button && (
        <span className="seat-dealer" aria-label="кнопка">
          D
        </span>
      )}
      {s.turnLeft !== null && <span className="seat-timer">{s.turnLeft} с</span>}
      <span className="seat-name">
        {s.name}
        {s.isMe && <span className="visually-hidden"> (вы)</span>}
      </span>
      <span className="seat-chips">{formatNumber(s.chips)}</span>
      {s.hud && <HudLine hud={s.hud} onOpen={onHud} />}
      {myCards ? (
        <PeekCards cards={myCards} open={open} size="mid" label={myHand} className="seat-cards" />
      ) : (
        s.cards && <CardRow cards={s.cards} size={s.isMe ? 'mid' : 'small'} />
      )}
      {s.handName && <span className="seat-mark">{s.handName}</span>}
      {s.best && <CardRow cards={s.best} size="small" best />}
      {marks.length > 0 && <span className="seat-mark">{marks.join(' · ')}</span>}
      {s.bet > 0 && <span className={`bet-chip ${betSide(at)}`}>{formatNumber(s.bet)}</span>}
    </div>
  )
}

// Панель хода внизу экрана (#97) — только в свой ход: сверху быстрые суммы и ползунок, под ними своё
// число и «Ставка» / «Рейз до» в одном ряду (открыта клавиатура — видны оба), внизу «Пас» и «Чек» / «Колл».
// Повысить можно только олл-ином — вместо ползунка кнопка «Олл-ин N». Пот-лимит (#80) — среди быстрых сумм
// «Пот», под ползунком «Не больше банка: N»; олл-ина больше «пота» нет.
// who — за кого ход на одном телефоне («Ход: имя»); null — свои: «Ваш ход».
// left — секунд на мой ход (таймер стола); online — есть связь: без неё кнопки неактивны
export function ActionsCard(props: {
  actions: ActionsView
  sb: number
  who: string | null
  left?: number | null
  online: boolean
  onAct: (body: Extract<ClientBody, { type: 'act' }>) => void
}) {
  const { actions: a, sb, who, left = null, online, onAct: act } = props
  const r = a.raise
  const slider = a.myTurn ? betSlider(r, sb) : null
  const [text, setText] = useState(r ? String(r.min) : '')
  const to = parseChips(text)
  const okTo = r !== null && to !== null && to >= r.min && to <= r.max

  function confirmRaise(e: FormEvent) {
    e.preventDefault()
    if (!r || to === null || !okTo) return
    act({ type: 'act', action: to === r.max && r.allIn ? { type: 'allin' } : { type: 'raise', to } })
  }

  const setAmount = (n: number) => setText(String(n))
  const off = !a.myTurn || !online
  const raiseLabel = r && to === r.max && r.allIn ? 'Олл-ин' : r?.label === 'Ставка' ? 'Ставка' : 'Рейз до'
  return (
    <section className="dock actions">
      <p className="dock-title">{who !== null ? `Ход: ${who}` : `Ваш ход${left !== null ? ` · ${left} с` : ''}`}</p>
      {slider && r && (
        <form className="bet-form" onSubmit={confirmRaise}>
          <div className="quick-row">
            {r.quick.map((q) => (
              <button key={q.label} type="button" onClick={() => setAmount(q.to)}>
                <span>{q.label}</span> <span className="num">{formatNumber(q.to)}</span>
              </button>
            ))}
            {r.allIn && (
              <button type="button" onClick={() => setAmount(r.max)}>
                <span>Олл-ин</span> <span className="num">{formatNumber(r.max)}</span>
              </button>
            )}
          </div>
          <BetRange slider={slider} amount={to ?? r.min} onChange={setAmount} />
          {r.potLimit !== null && <p className="muted dock-note">Не больше банка: {formatNumber(r.potLimit)}</p>}
          <div className="dock-row">
            <input
              className="bet-amount"
              inputMode="numeric"
              pattern="[0-9 ]*"
              aria-label={`Сумма — от ${formatNumber(r.min)} до ${formatNumber(r.max)}`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="big primary grow" disabled={off || !okTo}>
              {raiseLabel} {to !== null ? formatNumber(to) : '…'}
            </button>
          </div>
        </form>
      )}
      <div className="action-grid">
        <button type="button" className="big danger" disabled={off} onClick={() => act({ type: 'act', action: { type: 'fold' } })}>
          Пас
        </button>
        {a.check ? (
          <button type="button" className="big primary" disabled={off} onClick={() => act({ type: 'act', action: { type: 'check' } })}>
            Чек
          </button>
        ) : (
          <button type="button" className="big primary" disabled={off} onClick={() => act({ type: 'act', action: { type: 'call' } })}>
            Колл {formatNumber(a.call)}
          </button>
        )}
        {!slider && a.allIn !== null && (
          <button type="button" className="big cashout" disabled={off} onClick={() => act({ type: 'act', action: { type: 'allin' } })}>
            Олл-ин {formatNumber(a.allIn)}
          </button>
        )}
      </div>
    </section>
  )
}

// Ползунок суммы: палец — шагом малого блайнда; колесо мыши над ним — на шаг, страница не крутится.
// Колесо — своим слушателем: у React он пассивный и не может отменить прокрутку
function BetRange({ slider, amount, onChange }: { slider: BetSlider; amount: number; onChange: (n: number) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const latest = useRef({ slider, amount, onChange })
  latest.current = { slider, amount, onChange }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      const { slider, amount, onChange } = latest.current
      onChange(stepAmount(slider, amount, e.deltaY < 0 ? 1 : -1))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [])

  return (
    <input
      ref={ref}
      type="range"
      className="bet-range"
      aria-label="Сумма ставки"
      min={0}
      max={slider.steps}
      step={1}
      value={sliderIndex(slider, amount)}
      onChange={(e) => onChange(sliderAmount(slider, Number(e.target.value)))}
    />
  )
}

// Свои кнопки: докуп и пропуск раздач
function MyCard({ room, table, view: v, amounts }: { room: Room; table: TableState; view: TableView; amounts: number[] }) {
  const [asking, setAsking] = useState(false)
  const [text, setText] = useState('')
  const { rebuyMaxBB, bb, startingStack } = table.settings
  const limit = rebuyMaxBB === null ? null : rebuyMaxBB * bb
  const options = [...new Set([startingStack, ...amounts])].filter((x) => limit === null || x <= limit)
  const amount = parseChips(text)
  const me = v.me

  function ask(n: number) {
    if (room.send({ type: 'rebuy', amount: n })) setAsking(false)
  }

  if (!me) return null
  const t = v.tournament
  if (t) {
    // Турнир (#78): докупов нет; выбыл, а ребай открыт — «Ребай» сам, без одобрения ведущего
    return (
      <section className="card">
        <h2>Мои фишки</h2>
        <p>Бай-ин {formatRub(t.buyIn * 100)}</p>
        {t.canRebuy && (
          <button type="button" className="big rebuy wide" disabled={!room.online} onClick={() => room.send({ type: 'tournamentRebuy' })}>
            Ребай за {formatRub(t.buyIn * 100)} — стек {formatNumber(startingStack)}
          </button>
        )}
        {me.place !== null && !t.ended && !t.canRebuy && <p className="muted">Вы выбыли: {me.place} место</p>}
        <button type="button" className="big wide" onClick={() => room.send({ type: 'sitOut', sittingOut: !me.sittingOut })}>
          {me.sittingOut ? 'Вернуться в раздачи' : 'Пропускать раздачи'}
        </button>
      </section>
    )
  }
  return (
    <section className="card">
      <h2>Мои фишки</h2>
      <p>
        Закуплено: {formatNumber(table.players.find((p) => p.id === me.id)?.buyIn ?? 0)}
      </p>
      {v.myRebuy !== null ? (
        <p className="muted">Запрос на докуп {formatNumber(v.myRebuy)} ждёт ведущего</p>
      ) : rebuyMaxBB === 0 ? (
        <p className="muted">Докупы за этим столом выключены</p>
      ) : asking ? (
        <>
          <div className="amounts">
            {options.map((n) => (
              <button key={n} type="button" className="big rebuy" onClick={() => ask(n)}>
                {formatNumber(n)}
              </button>
            ))}
          </div>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault()
              if (amount !== null) ask(amount)
            }}
          >
            <input
              className="grow"
              inputMode="numeric"
              pattern="[0-9 ]*"
              placeholder="Другая сумма"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="big primary" disabled={amount === null || (limit !== null && amount > limit)}>
              Попросить
            </button>
          </form>
          {limit !== null && <p className="muted">Не больше {formatNumber(limit)} за раз</p>}
          <button type="button" className="big wide" onClick={() => setAsking(false)}>
            Отмена
          </button>
        </>
      ) : (
        <button type="button" className="big rebuy wide" onClick={() => setAsking(true)}>
          Попросить докуп
        </button>
      )}
      <button
        type="button"
        className="big wide"
        onClick={() => room.send({ type: 'sitOut', sittingOut: !me.sittingOut })}
      >
        {me.sittingOut ? 'Вернуться в раздачи' : 'Пропускать раздачи'}
      </button>
    </section>
  )
}

function HostCard(props: {
  room: Room
  table: TableState
  view: TableView
  code: string
  gameId: string | null
  onFinish: Finish
}) {
  const { room, table, view: v, code, gameId, onFinish } = props
  const [open, setOpen] = useState<string | null>(null) // игрок, чьи кнопки раскрыты
  const [stackText, setStackText] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const hand = table.hand

  const reseatedName = room.reseated ? table.players.find((p) => p.id === room.reseated?.playerId)?.name : undefined
  const stack = parseChips(stackText) ?? (stackText.trim() === '0' ? 0 : null)

  async function shareSeat(seat: Seat, name: string) {
    setNote(await shareLink(`${name}, ваше место за столом ${code}: ${roomLink(location.href, code, seat)}`))
  }

  const t = v.tournament
  async function finish() {
    const question = gameId
      ? 'Игра уже записана в историю. Закрыть комнату у всех?'
      : t && !t.ended
        ? 'Турнир не окончен — в историю он не запишется. Закрыть комнату у всех?'
        : t
          ? 'Записать турнир в историю на этом телефоне? Комната закроется у всех.'
          : 'Закончить игру? Итог запишется в историю на этом телефоне, комната закроется у всех.' +
            (hand ? ' Раздача не доиграна — она отменится, в итог пойдут стеки до неё.' : '')
    if (finishing || !confirm(question)) return
    setFinishing(true)
    setFinishError(await onFinish(table))
    setFinishing(false)
  }

  return (
    <section className="card host">
      <h2>Ведущий</h2>

      {v.rebuyRequests.map((r) => (
        <div key={r.playerId} className="request">
          <p>
            {r.name} просит докуп {formatNumber(r.amount)}
          </p>
          <div className="row">
            <button
              type="button"
              className="big primary grow"
              onClick={() => room.send({ type: 'rebuyAnswer', playerId: r.playerId, approve: true })}
            >
              Да
            </button>
            <button
              type="button"
              className="big grow"
              onClick={() => room.send({ type: 'rebuyAnswer', playerId: r.playerId, approve: false })}
            >
              Нет
            </button>
          </div>
        </div>
      ))}

      {t?.ended && (
        <>
          <h2>Места и призы</h2>
          <TournamentResults table={table} />
        </>
      )}

      {/* «Перерыв»: новая раздача не начинается, таймер стоит, в турнире — и часы уровней; «Продолжить» — снимает.
          Между раздачами он и «Начать раздачу» — внизу экрана (HostDock, #97) */}
      {hand && (
        <button
          type="button"
          className={v.paused ? 'big primary wide' : 'big wide'}
          onClick={() => room.send({ type: 'pause', paused: !v.paused })}
        >
          {v.paused ? 'Продолжить' : 'Перерыв'}
        </button>
      )}

      {!hand && (
        <TableSettingsCard
          key={JSON.stringify([
            timerSettings(table.settings),
            table.settings.ante,
            table.settings.tournament?.prizes,
            table.settings.publicHud,
          ])}
          room={room}
          table={table}
          view={v}
        />
      )}

      {/* Вид стола (#77) — и во время раздачи; у всех меняется сразу */}
      <details className="table-settings">
        <summary>Вид стола</summary>
        <LookFields
          look={lookOf(table.settings)}
          backs
          disabled={!room.online}
          onChange={(look) => room.send({ type: 'look', ...look })}
        />
        {table.settings.cards !== 'phones' && <p className="muted">Карты живые — рубашка на экране не видна.</p>}
      </details>

      {hand && hand.stage !== 'showdown' && v.toActName && (
        <button type="button" className="big wide" onClick={() => room.send({ type: 'skip' })}>
          Пропустить ход: {v.toActName}
        </button>
      )}

      {hand && hand.stage === 'showdown' && !hand.cards && (
        <AwardPanel
          key={hand.number}
          table={table}
          view={v}
          online={room.online}
          onAward={(winners) => room.send({ type: 'award', winners })}
        />
      )}

      {room.reseated && (
        <div className="card reseat">
          <p>Ссылка на место «{reseatedName ?? 'игрока'}» — откройте её на новом устройстве. Старое отключено.</p>
          <button
            type="button"
            className="big primary wide"
            onClick={() => room.reseated && void shareSeat(room.reseated, reseatedName ?? '')}
          >
            Поделиться ссылкой
          </button>
          <p className="link-text">{roomLink(location.href, code, room.reseated)}</p>
          <button type="button" className="big wide" onClick={room.clearReseated}>
            Готово
          </button>
        </div>
      )}
      {note && <p className="ok">{note}</p>}

      <h2>Игроки</h2>
      <ul className="list items">
        {table.players.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="player-toggle"
              aria-expanded={open === p.id}
              onClick={() => {
                setOpen(open === p.id ? null : p.id)
                setStackText(String(p.chips))
              }}
            >
              <span className="grow">{p.name}</span>
              <span className="num">
                {formatNumber(p.chips)}
                {t ? '' : ` · закуп ${formatNumber(p.buyIn)}`}
              </span>
            </button>
            {open === p.id && (
              <div className="player-actions">
                {/* Турнир (#78): стек не правится, итог — по местам */}
                {!t && (
                  <>
                    <form
                      className="row"
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (stack !== null) room.send({ type: 'setStack', playerId: p.id, chips: stack })
                      }}
                    >
                      <input
                        className="grow"
                        inputMode="numeric"
                        pattern="[0-9 ]*"
                        aria-label="Стек"
                        disabled={hand !== null}
                        value={stackText}
                        onChange={(e) => setStackText(e.target.value)}
                      />
                      <button className="big primary" disabled={hand !== null || stack === null || stack === p.chips}>
                        Поправить стек
                      </button>
                    </form>
                    {hand !== null && <p className="muted">Стек правится между раздачами</p>}
                    {p.chips !== p.buyIn && <p className="muted">Итог сейчас: {formatChips(p.chips - p.buyIn, true)}</p>}
                  </>
                )}
                <button
                  type="button"
                  className="big wide"
                  onClick={() => room.send({ type: 'sitOut', sittingOut: !p.sittingOut, playerId: p.id })}
                >
                  {p.sittingOut ? 'Вернуть в раздачи' : 'Пропускает раздачи'}
                </button>
                <MoveSeat
                  view={v}
                  seat={p.seat}
                  online={room.online}
                  onMove={(seat) => room.send({ type: 'moveSeat', seat, playerId: p.id })}
                />
                {p.id !== table.hostId && (
                  <>
                    <button type="button" className="big wide" onClick={() => room.send({ type: 'reseat', playerId: p.id })}>
                      Пересадить на новое устройство
                    </button>
                    <button
                      type="button"
                      className="big wide"
                      onClick={() => {
                        if (confirm(`Передать ведение игроку «${p.name}»?`)) room.send({ type: 'passHost', to: p.id })
                      }}
                    >
                      Передать ведение
                    </button>
                    <button
                      type="button"
                      className="big wide danger-text"
                      onClick={() => {
                        const note = t ? 'Он выбывает сейчас, его фишки уходят из игры.' : 'Его остаток запишется в журнал.'
                        if (confirm(`Убрать «${p.name}» со стола? ${note}`)) room.send({ type: 'remove', playerId: p.id })
                      }}
                    >
                      Убрать со стола
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {gameId && (
        <>
          <p className="ok">
            Игра записана в историю.
            {!room.online &&
              ' Комната закроется, когда вернётся связь и вы снова нажмёте «Закончить игру», — или сама через сутки.'}
          </p>
          <a className="big wide button-link" href={`#/game/${gameId}`}>
            Открыть игру
          </a>
        </>
      )}
      {finishError && <p className="warn">{finishError}</p>}
      <button
        type="button"
        className={t?.ended && !gameId ? 'big wide primary' : 'big wide danger'}
        disabled={finishing}
        onClick={() => void finish()}
      >
        {t?.ended && !gameId ? 'Записать игру' : 'Закончить игру'}
      </button>
    </section>
  )
}

// Ведущий пересаживает игрока (#98) — из меню игрока: свободные места стола кнопками, между раздачами
export function MoveSeat(props: { view: TableView; seat: number; online: boolean; onMove: (seat: number) => void }) {
  const { view: v, seat, online, onMove } = props
  if (v.stage !== null) return <p className="muted">Место {seat + 1} · пересадить можно между раздачами</p>
  if (v.freeSeats.length === 0) return <p className="muted">Место {seat + 1} · свободных мест нет</p>
  return (
    <>
      <p className="muted">Место {seat + 1} · пересадить на место</p>
      <div className="amounts">
        {v.freeSeats.map((k) => (
          <button key={k} type="button" className="big" disabled={!online} onClick={() => onMove(k)}>
            {k + 1}
          </button>
        ))}
      </div>
    </>
  )
}

// «Настройки стола» ведущего между раздачами (#75): время на ход и раздача «сама» — со следующей раздачи.
// Сохранили — форма заново из стола (key)
// Кэш (#78) — ещё и анте; турнир до «Начать турнир» — призы по местам: тогда видно, сколько пришло.
// Кому виден HUD (#79) — здесь же
function TableSettingsCard({ room, table, view: v }: { room: Room; table: TableState; view: TableView }) {
  const saved = timerSettings(table.settings)
  const [form, setForm] = useState<TimerForm>(() => timerForm(saved.turnSeconds, saved.autoStart))
  const savedAnte = table.settings.ante ?? 0
  const [anteText, setAnteText] = useState(String(savedAnte))
  const savedHud = table.settings.publicHud === true
  const [publicHud, setPublicHud] = useState(savedHud)
  const savedPrizes = table.settings.tournament?.prizes ?? null
  const [prizesOwn, setPrizesOwn] = useState(savedPrizes !== null)
  const [prizes, setPrizes] = useState<string[]>(() => (savedPrizes ?? []).map(String))
  const turn = turnSecondsOf(form.choice, form.text)
  const t = v.tournament
  const ante = t ? savedAnte : (parseChips(anteText) ?? (anteText.trim() === '0' ? 0 : null))
  const editPrizes = t !== null && !t.started
  const ownPrizes = prizesOf(prizes)
  const newPrizes = prizesOwn ? (ownPrizes.ok ? ownPrizes.prizes : undefined) : null
  const prizesChanged = editPrizes && newPrizes !== undefined && JSON.stringify(newPrizes) !== JSON.stringify(savedPrizes)
  const ok = turn.ok && ante !== null && newPrizes !== undefined
  const changed =
    turn.ok &&
    (turn.seconds !== saved.turnSeconds ||
      form.autoStart !== saved.autoStart ||
      ante !== savedAnte ||
      prizesChanged ||
      publicHud !== savedHud)

  function save() {
    if (!turn.ok || ante === null) return
    room.send({
      type: 'tableSettings',
      turnSeconds: turn.seconds,
      autoStart: form.autoStart,
      publicHud,
      ...(t ? {} : { ante }),
      ...(prizesChanged && newPrizes !== undefined ? { prizes: newPrizes } : {}),
    })
  }

  return (
    <details className="table-settings">
      <summary>Настройки стола</summary>
      {saved.autoStart !== 'off' && !v.paused && (
        <p className="muted">Раздача начнётся сама — чтобы спокойно поменять, сначала «Перерыв».</p>
      )}
      <TimerFields form={form} onChange={setForm} />
      {!t && (
        <label className="field">
          Анте, фишек — 0, если нет
          <input inputMode="numeric" pattern="[0-9 ]*" value={anteText} onChange={(e) => setAnteText(e.target.value)} />
        </label>
      )}
      {!t && ante === null && <p className="warn">Анте — целое число фишек, не меньше нуля</p>}
      {editPrizes && (
        <PrizeFields
          own={prizesOwn}
          prizes={prizes}
          players={table.players.length}
          onChange={(own, list) => {
            setPrizesOwn(own)
            setPrizes(list)
          }}
        />
      )}
      <HudFields all={publicHud} onChange={setPublicHud} />
      <button type="button" className="big primary wide" disabled={!changed || !ok || !room.online} onClick={save}>
        Сохранить
      </button>
      <p className="muted">Действует со следующей раздачи.</p>
    </details>
  )
}

// Торги закрыты: ведущий отмечает победителя каждого банка. Новая раздача — отметки заново (key)
export function AwardPanel(props: {
  table: TableState
  view: TableView
  online: boolean
  onAward: (winners: string[][]) => void
}) {
  const { table, view: v, online, onAward } = props
  const [winners, setWinners] = useState<string[][]>(() => defaultWinners(table))
  return (
    <div className="award">
      <p>Отметьте победителя каждого банка; несколько — поделят поровну</p>
      {v.pots.map((pot, k) => (
        <div key={pot.label}>
          <p>
            <strong>
              {pot.label} {formatNumber(pot.amount)}
            </strong>
          </p>
          <div className="amounts">
            {pot.eligible.map((p) => (
              <button
                key={p.id}
                type="button"
                className={winners[k]?.includes(p.id) ? 'big primary' : 'big'}
                aria-pressed={winners[k]?.includes(p.id) ?? false}
                onClick={() => setWinners(toggleWinner(winners, k, p.id))}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        className="big primary wide"
        disabled={!winnersReady(table, winners) || !online}
        onClick={() => onAward(winners)}
      >
        Раздать банки
      </button>
    </div>
  )
}

// Конец стола: стек и итог против закупа у каждого, кто остался; турнир — места и призы
export function FinalStacks({ table }: { table: TableState }) {
  if (table.settings.format === 'tournament') return <TournamentResults table={table} />
  const stacks = finalStacks(table)
  if (stacks.length === 0) return null
  return (
    <>
      <table className="totals">
        <tbody>
          {stacks.map((s, i) => (
            <tr key={i}>
              <td>{s.name}</td>
              <td className="num">{formatNumber(s.chips)}</td>
              <td className={s.diff > 0 ? 'num plus' : s.diff < 0 ? 'num minus' : 'num'}>{formatChips(s.diff, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Стек и итог против закупа</p>
    </>
  )
}

// Ведущий, записавший итог, — «Игра записана в историю»; игроки после «Закончить игру» — «итог — у ведущего»
function ClosedCard({ ended, gameId }: { ended: Room['ended']; gameId: string | null }) {
  return (
    <section className="card">
      <h2>{ROOM_CLOSED}</h2>
      {gameId ? (
        <p className="ok">Игра записана в историю</p>
      ) : ended?.reason === FINISHED ? (
        <p>Игра закончена, итог — у ведущего</p>
      ) : (
        ended?.reason && <p className="muted">{ended.reason}</p>
      )}
      {ended?.table && <FinalStacks table={ended.table} />}
      {gameId && (
        <a className="big primary wide button-link" href={`#/game/${gameId}`}>
          Открыть игру
        </a>
      )}
      <a className={gameId ? 'big wide button-link' : 'big primary wide button-link'} href="#/poker">
        К покеру
      </a>
    </section>
  )
}
