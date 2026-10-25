import { useEffect, useState, type FormEvent } from 'react'
import { formatChips, formatNumber, parseChips } from '../calc/format'
import { NO_CONNECTION, roomLink, ROOM_CLOSED, UPDATE_APP, type Seat } from '../calc/pokerLink'
import {
  defaultWinners,
  finalStacks,
  lastHandWins,
  tableView,
  toggleWinner,
  winnersReady,
  type ActionsView,
  type SeatView,
  type TableView,
} from '../calc/pokerView'
import { DEFAULT_QUICK_AMOUNTS } from '../model'
import type { TableState } from '../poker/table'
import { getSettings } from '../store/db'
import { useRoom, type Lobby, type Room } from './useRoom'

// Стол покера онлайн (Р-14, Р-19): вход по ссылке, ставки с телефонов, кнопки ведущего.
// Карты живые — на столе; экран ведёт фишки, банки и очередь хода
export function PokerRoomScreen({ code }: { code: string }) {
  const room = useRoom(code)
  const [note, setNote] = useState<string | null>(null)

  async function shareRoom() {
    const url = roomLink(location.href, code)
    setNote(await shareLink(`Покер — стол ${code}: ${url}`))
  }

  return (
    <main className="screen poker">
      <header className="bar">
        <a className="bar-link" href="#/poker">
          ← Покер
        </a>
        {(room.phase === 'lobby' || room.phase === 'seated') && (
          <button type="button" className="big primary" onClick={() => void shareRoom()}>
            Поделиться
          </button>
        )}
      </header>
      <h1>Стол {code}</h1>
      {note && <p className="ok">{note}</p>}

      {!room.online && room.failed && (room.phase === 'loading' || room.phase === 'lobby' || room.phase === 'seated') && (
        <p className="card warn">{NO_CONNECTION} — подключаемся снова… Учёт вечера работает и без сети.</p>
      )}

      {room.phase === 'loading' && !room.failed && <p className="muted">Подключение…</p>}
      {room.phase === 'lobby' && room.lobby && <LobbyCard lobby={room.lobby} room={room} />}
      {room.phase === 'seated' && room.table && room.me && <TableCard room={room} table={room.table} me={room.me} code={code} />}
      {room.phase === 'closed' && <ClosedCard ended={room.ended} />}
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

function TableCard({ room, table, me, code }: { room: Room; table: TableState; me: string; code: string }) {
  const [now, setNow] = useState(() => Date.now())
  const [amounts, setAmounts] = useState<number[]>(DEFAULT_QUICK_AMOUNTS)

  // Часы — для «Взять ведение»: ведущий вне сети дольше минуты
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    void getSettings().then((s) => setAmounts(s.quickAmounts))
  }, [])

  const v = tableView(table, me, now)
  const { sb, bb } = table.settings
  const wins = lastHandWins(table)

  return (
    <>
      <p className="muted table-info">
        Блайнды {formatNumber(sb)}/{formatNumber(bb)} · {v.handNumber > 0 ? `раздача ${v.handNumber} · ` : ''}
        {v.stageLabel} · ведущий — {v.hostName}
      </p>

      {v.stage !== null && (
        <section className="card pot">
          <div className="pot-total">
            Банк <strong>{formatNumber(v.pot)}</strong>
          </div>
          {v.pots.map((p) => (
            <div key={p.label} className="muted">
              {p.label}: {formatNumber(p.amount)} — {p.eligible.map((x) => x.name).join(', ')}
            </div>
          ))}
          {v.toActName && <div>Ход: {v.toActName}</div>}
          {v.stage === 'showdown' && !v.isHost && <div className="muted">Торги закрыты — ведущий отмечает победителя</div>}
        </section>
      )}
      {v.stage === null && wins.length > 0 && (
        <p className="muted">
          Прошлая раздача: {wins.map((w) => `${w.name} +${formatNumber(w.amount)}`).join(', ')}
        </p>
      )}

      <ul className="list seats">
        {v.seats.map((s) => (
          <SeatRow key={s.id} seat={s} />
        ))}
      </ul>

      {room.error && (
        <p className="warn" onClick={room.clearError}>
          {room.error}
        </p>
      )}

      {v.actions && <ActionsCard key={`${v.handNumber}-${v.stage}`} actions={v.actions} room={room} />}

      {v.canTakeHost && (
        <button type="button" className="big primary wide" onClick={() => room.send({ type: 'takeHost' })}>
          Взять ведение
        </button>
      )}

      {v.isHost && <HostCard room={room} table={table} view={v} code={code} />}

      <MyCard room={room} table={table} view={v} amounts={amounts} />
    </>
  )
}

function SeatRow({ seat: s }: { seat: SeatView }) {
  const marks = [
    s.button && 'D',
    s.blind,
    s.isHost && 'ведущий',
    !s.online && 'вне сети',
    s.sittingOut && 'пропускает',
    s.folded && 'пас',
    s.allIn && 'олл-ин',
  ].filter(Boolean)
  const cls = ['seat', s.toAct && 'to-act', s.folded && 'folded', s.isMe && 'me'].filter(Boolean).join(' ')
  return (
    <li className={cls}>
      <div className="seat-head">
        <span className="grow">
          <strong>{s.name}</strong>
          {s.isMe && ' (вы)'}
        </span>
        <span className="num">{formatNumber(s.chips)}</span>
      </div>
      <div className="seat-sub">
        <span className="grow muted">{marks.join(' · ')}</span>
        {s.bet > 0 && <span className="num bet">ставка {formatNumber(s.bet)}</span>}
      </div>
    </li>
  )
}

function ActionsCard({ actions: a, room }: { actions: ActionsView; room: Room }) {
  const [raising, setRaising] = useState(false)
  const [text, setText] = useState('')
  const to = parseChips(text)
  const r = a.raise
  const okTo = r !== null && to !== null && to >= r.min && to <= r.max

  function act(action: Parameters<typeof room.send>[0]) {
    room.send(action)
    setRaising(false)
  }

  function confirmRaise(e: FormEvent) {
    e.preventDefault()
    if (!r || to === null || !okTo) return
    act({ type: 'act', action: to === r.max ? { type: 'allin' } : { type: 'raise', to } })
  }

  const off = !a.myTurn || !room.online
  return (
    <section className={a.myTurn ? 'card actions my-turn' : 'card actions'}>
      {a.myTurn ? <h2>Ваш ход</h2> : <p className="muted">Ждём своего хода</p>}
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
        <button
          type="button"
          className="big"
          disabled={off || r === null}
          onClick={() => {
            setRaising(!raising)
            if (r) setText(String(r.min))
          }}
        >
          {r?.label ?? 'Рейз'}
        </button>
        <button
          type="button"
          className="big cashout"
          disabled={off || a.allIn === null}
          onClick={() => act({ type: 'act', action: { type: 'allin' } })}
        >
          Олл-ин{a.allIn !== null ? ` ${formatNumber(a.allIn)}` : ''}
        </button>
      </div>
      {raising && r && !off && (
        <form onSubmit={confirmRaise}>
          <div className="amounts">
            {r.quick.map((q) => (
              <button key={q.label} type="button" className="big" onClick={() => setText(String(q.to))}>
                {q.label} {formatNumber(q.to)}
              </button>
            ))}
          </div>
          <div className="row">
            <input
              className="grow"
              inputMode="numeric"
              pattern="[0-9 ]*"
              aria-label="До скольких"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="big primary" disabled={!okTo}>
              {r.label} до {to !== null ? formatNumber(to) : '…'}
            </button>
          </div>
          <p className="muted">
            От {formatNumber(r.min)} до {formatNumber(r.max)}
            {to === r.max ? ' — это олл-ин' : ''}
          </p>
        </form>
      )}
    </section>
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

function HostCard({ room, table, view: v, code }: { room: Room; table: TableState; view: TableView; code: string }) {
  const [open, setOpen] = useState<string | null>(null) // игрок, чьи кнопки раскрыты
  const [stackText, setStackText] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const hand = table.hand

  const reseatedName = room.reseated ? table.players.find((p) => p.id === room.reseated?.playerId)?.name : undefined
  const stack = parseChips(stackText) ?? (stackText.trim() === '0' ? 0 : null)

  async function shareSeat(seat: Seat, name: string) {
    setNote(await shareLink(`${name}, ваше место за столом ${code}: ${roomLink(location.href, code, seat)}`))
  }

  function finish() {
    if (!confirm('Закончить игру? Комната закроется у всех. В историю игра пока не записывается.')) return
    room.send({ type: 'finish' })
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

      {!hand && (
        <>
          <button type="button" className="big primary wide" disabled={!v.canStart} onClick={() => room.send({ type: 'start' })}>
            Начать раздачу
          </button>
          {!v.canStart && <p className="muted">Нужно хотя бы двое с фишками, которые не пропускают раздачи</p>}
        </>
      )}

      {hand && hand.stage !== 'showdown' && v.toActName && (
        <button type="button" className="big wide" onClick={() => room.send({ type: 'skip' })}>
          Пропустить ход: {v.toActName}
        </button>
      )}

      {hand && hand.stage === 'showdown' && <AwardPanel key={hand.number} room={room} table={table} view={v} />}

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
                {formatNumber(p.chips)} · закуп {formatNumber(p.buyIn)}
              </span>
            </button>
            {open === p.id && (
              <div className="player-actions">
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
                {p.chips !== p.buyIn && (
                  <p className="muted">Итог сейчас: {formatChips(p.chips - p.buyIn, true)}</p>
                )}
                <button
                  type="button"
                  className="big wide"
                  onClick={() => room.send({ type: 'sitOut', sittingOut: !p.sittingOut, playerId: p.id })}
                >
                  {p.sittingOut ? 'Вернуть в раздачи' : 'Пропускает раздачи'}
                </button>
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
                        if (confirm(`Убрать «${p.name}» со стола? Его остаток запишется в журнал.`)) {
                          room.send({ type: 'remove', playerId: p.id })
                        }
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

      <button type="button" className="big wide danger" onClick={finish}>
        Закончить игру
      </button>
    </section>
  )
}

// Торги закрыты: ведущий отмечает победителя каждого банка. Новая раздача — отметки заново (key)
function AwardPanel({ room, table, view: v }: { room: Room; table: TableState; view: TableView }) {
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
        disabled={!winnersReady(table, winners) || !room.online}
        onClick={() => room.send({ type: 'award', winners })}
      >
        Раздать банки
      </button>
    </div>
  )
}

function ClosedCard({ ended }: { ended: Room['ended'] }) {
  const stacks = ended?.table ? finalStacks(ended.table) : []
  return (
    <section className="card">
      <h2>{ROOM_CLOSED}</h2>
      {ended?.reason && <p className="muted">{ended.reason}</p>}
      {stacks.length > 0 && (
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
      )}
      {stacks.length > 0 && <p className="muted">Стек и итог против закупа. В историю игра пока не записывается.</p>}
      <a className="big primary wide button-link" href="#/poker">
        К покеру
      </a>
    </section>
  )
}
