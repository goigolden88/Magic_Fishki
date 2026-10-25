import { useEffect, useState, type FormEvent } from 'react'
import { formatChips, formatNumber, parseChips } from '../calc/format'
import {
  actFor,
  hostDo,
  localTableView,
  pendingRebuy,
  rebuyNow,
  removePlayer,
  seatPlayer,
  toActId,
  type LocalTable,
} from '../calc/localTable'
import { gameFromTable } from '../calc/pokerGame'
import type { TableView } from '../calc/pokerView'
import { formatDate, today } from '../dates'
import { DEFAULT_QUICK_AMOUNTS, type Regular } from '../model'
import type { Result, TableState } from '../poker/table'
import { getSettings, saveGame } from '../store/db'
import { ulid } from '../ulid'
import { openGameYear } from './openYears'
import { clearLocalTable, loadLocalTable, saveLocalTable, storageWorks } from './pokerStorage'
import { ActionsCard, AwardPanel, FinalStacks, LastHand, PokerTable, PotList } from './PokerRoom'

// Адрес стола на телефоне: под код комнаты (6 знаков) не подходит
export const LOCAL_HASH = '#/poker/local'

export const NO_STORAGE =
  'Память браузера недоступна (например, приватный режим) — стол работает, но после закрытия приложения пропадёт'

// Стол на этом телефоне (Р-21): все за одним столом с живыми картами, телефон ведущего ведёт
// ходы, банки и фишки. Без сервера и сети: правила src/poker/ — прямо здесь, стол — в памяти
// устройства после каждого изменения
export function PokerLocalScreen() {
  const [local, setLocal] = useState<LocalTable | null>(() => loadLocalTable())
  const [done, setDone] = useState<{ table: TableState; gameId: string } | null>(null)
  const [volatile, setVolatile] = useState(() => !storageWorks())
  const [error, setError] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [amounts, setAmounts] = useState<number[]>(DEFAULT_QUICK_AMOUNTS)
  const [regulars, setRegulars] = useState<Regular[]>([])

  useEffect(() => {
    void getSettings().then((s) => {
      setAmounts(s.quickAmounts)
      setRegulars(s.players)
    })
  }, [])

  // Итог уже записан, а стол не стёрт (оборвалось посередине) — второй игры не писать, стол стереть
  useEffect(() => {
    if (!local?.gameId) return
    setDone({ table: local.table, gameId: local.gameId })
    clearLocalTable()
    setLocal(null)
  }, [local])

  // Ход или команда ведущего: удалось — стол сразу в память устройства
  function apply(make: (table: TableState, now: number) => Result): boolean {
    if (!local) return false
    const r = make(local.table, Date.now())
    if (!r.ok) {
      setError(r.error)
      return false
    }
    const next = { ...local, table: r.state }
    if (!saveLocalTable(next)) setVolatile(true)
    setLocal(next)
    setError(null)
    return true
  }

  // «Закончить игру» (Р-20, Р-21): игра в историю → отметка «записан» → стол стирается.
  // Оборвалось после записи — отметка не даст записать вторую
  async function finish() {
    if (!local || finishing) return
    const question =
      'Закончить игру? Итог запишется в историю на этом телефоне, стол сотрётся.' +
      (local.table.hand ? ' Раздача не доиграна — она отменится, в итог пойдут стеки до неё.' : '')
    if (!confirm(question)) return
    setFinishing(true)
    let gameId = local.gameId
    if (!gameId) {
      try {
        const settings = await getSettings()
        const date = today()
        const game = gameFromTable(
          local.table,
          { name: formatDate(date), date, rate: settings.defaultRate, now: new Date().toISOString() },
          () => ulid(),
        )
        await saveGame(game)
        gameId = game.id
        saveLocalTable({ ...local, gameId })
        openGameYear(date)
      } catch {
        setFinishing(false)
        setError('Не удалось записать игру на этом телефоне — стол на месте')
        return
      }
    }
    clearLocalTable()
    setDone({ table: local.table, gameId })
    setLocal(null)
    setFinishing(false)
  }

  function remove() {
    if (!confirm('Удалить стол? Игра в историю не запишется.')) return
    clearLocalTable()
    location.hash = '#/poker'
  }

  return (
    <main className="screen poker">
      <header className="bar">
        <a className="bar-link" href="#/poker">
          ← Покер
        </a>
      </header>
      <h1>Стол на этом телефоне</h1>
      {volatile && local && <p className="card warn">{NO_STORAGE}</p>}

      {done ? (
        <section className="card">
          <h2>Игра закончена</h2>
          <p className="ok">Игра записана в историю</p>
          <FinalStacks table={done.table} />
          <a className="big primary wide button-link" href={`#/game/${done.gameId}`}>
            Открыть игру
          </a>
          <a className="big wide button-link" href="#/poker">
            К покеру
          </a>
        </section>
      ) : !local ? (
        <section className="card">
          <p className="muted">Стола на этом телефоне нет — начните его на экране «Покер онлайн».</p>
          <a className="big primary wide button-link" href="#/poker">
            К покеру
          </a>
        </section>
      ) : (
        <LocalTableCard
          table={local.table}
          amounts={amounts}
          regulars={regulars}
          error={error}
          finishing={finishing}
          onError={setError}
          apply={apply}
          onFinish={() => void finish()}
          onRemove={remove}
        />
      )}
    </main>
  )
}

type Apply = (make: (table: TableState, now: number) => Result) => boolean

function LocalTableCard(props: {
  table: TableState
  amounts: number[]
  regulars: Regular[]
  error: string | null
  finishing: boolean
  onError: (error: string | null) => void
  apply: Apply
  onFinish: () => void
  onRemove: () => void
}) {
  const { table, amounts, regulars, error, finishing, onError, apply, onFinish, onRemove } = props
  const v = localTableView(table, Date.now())
  const { sb, bb } = table.settings
  const actId = toActId(table)
  const hand = table.hand

  return (
    <>
      <p className="muted table-info">
        Блайнды {formatNumber(sb)}/{formatNumber(bb)} · {v.handNumber > 0 ? `раздача ${v.handNumber} · ` : ''}
        {v.stageLabel}
      </p>

      <PokerTable view={v} />
      <PotList view={v} />
      <LastHand table={table} view={v} />

      {error && (
        <p className="warn" onClick={() => onError(null)}>
          {error}
        </p>
      )}

      {v.actions && v.toActName && (
        // Ход перешёл или новый минимум — сумма снова с минимума
        <ActionsCard
          key={`${v.handNumber}-${v.stage}-${actId}-${v.actions.raise?.min ?? ''}`}
          actions={v.actions}
          sb={sb}
          who={v.toActName}
          online
          onAct={(body) => apply((t, now) => actFor(t, body.action, now))}
        />
      )}

      <section className="card host">
        <h2>Ведущий</h2>
        {!hand && (
          <>
            <button
              type="button"
              className="big primary wide"
              disabled={!v.canStart}
              onClick={() => apply((t, now) => hostDo(t, { type: 'start' }, now))}
            >
              Начать раздачу
            </button>
            {!v.canStart && <p className="muted">Нужно хотя бы двое с фишками, которые не пропускают раздачи</p>}
          </>
        )}
        {hand && hand.stage === 'showdown' && (
          <AwardPanel
            key={hand.number}
            table={table}
            view={v}
            online
            onAward={(winners) => apply((t, now) => hostDo(t, { type: 'award', winners }, now))}
          />
        )}

        <h2>Игроки</h2>
        <PlayerList table={table} view={v} amounts={amounts} apply={apply} />
        <SeatNew table={table} regulars={regulars} apply={apply} />

        <button type="button" className="big wide danger" disabled={finishing} onClick={onFinish}>
          Закончить игру
        </button>
        <button type="button" className="big wide danger-text" disabled={finishing} onClick={onRemove}>
          Удалить стол
        </button>
      </section>
    </>
  )
}

// Нажатие на игрока: стек, докуп сразу, пропуск раздач, «Убрать со стола»
function PlayerList({ table, view: v, amounts, apply }: { table: TableState; view: TableView; amounts: number[]; apply: Apply }) {
  const [open, setOpen] = useState<string | null>(null)
  const [stackText, setStackText] = useState('')
  const [rebuyText, setRebuyText] = useState('')
  const hand = table.hand
  const stack = parseChips(stackText) ?? (stackText.trim() === '0' ? 0 : null)
  const rebuy = parseChips(rebuyText)
  const { rebuyMaxBB, bb, startingStack } = table.settings
  const limit = rebuyMaxBB === null ? null : rebuyMaxBB * bb
  const options = [...new Set([startingStack, ...amounts])].filter((x) => limit === null || x <= limit)
  const players = [...table.players].sort((a, b) => a.seat - b.seat)

  function doRebuy(playerId: string, amount: number) {
    if (apply((t, now) => rebuyNow(t, playerId, amount, now))) setRebuyText('')
  }

  return (
    <ul className="list items">
      {players.map((p) => {
        const pending = pendingRebuy(table, p.id)
        const seat = v.seats.find((s) => s.id === p.id)
        return (
          <li key={p.id}>
            <button
              type="button"
              className="player-toggle"
              aria-expanded={open === p.id}
              onClick={() => {
                setOpen(open === p.id ? null : p.id)
                setStackText(String(p.chips))
                setRebuyText('')
              }}
            >
              <span className="grow">{p.name}</span>
              <span className="num">
                {formatNumber(seat?.chips ?? p.chips)} · закуп {formatNumber(p.buyIn)}
              </span>
            </button>
            {pending > 0 && <p className="muted">Докуп {formatNumber(pending)} — в стек после раздачи</p>}
            {open === p.id && (
              <div className="player-actions">
                {rebuyMaxBB === 0 ? (
                  <p className="muted">Докупы за этим столом выключены</p>
                ) : (
                  <>
                    <p className="muted">Докупить</p>
                    <div className="amounts">
                      {options.map((n) => (
                        <button key={n} type="button" className="big rebuy" onClick={() => doRebuy(p.id, n)}>
                          {formatNumber(n)}
                        </button>
                      ))}
                    </div>
                    <form
                      className="row"
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (rebuy !== null) doRebuy(p.id, rebuy)
                      }}
                    >
                      <input
                        className="grow"
                        inputMode="numeric"
                        pattern="[0-9 ]*"
                        placeholder="Другая сумма"
                        value={rebuyText}
                        onChange={(e) => setRebuyText(e.target.value)}
                      />
                      <button className="big rebuy" disabled={rebuy === null || (limit !== null && rebuy > limit)}>
                        Докупить
                      </button>
                    </form>
                    {limit !== null && <p className="muted">Не больше {formatNumber(limit)} за раз</p>}
                  </>
                )}
                <form
                  className="row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (stack !== null) apply((t, now) => hostDo(t, { type: 'setStack', playerId: p.id, chips: stack }, now))
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
                <button
                  type="button"
                  className="big wide"
                  onClick={() => apply((t, now) => hostDo(t, { type: 'sitOut', sittingOut: !p.sittingOut, playerId: p.id }, now))}
                >
                  {p.sittingOut ? 'Вернуть в раздачи' : 'Пропускает раздачи'}
                </button>
                <button
                  type="button"
                  className="big wide danger-text"
                  onClick={() => {
                    if (confirm(`Убрать «${p.name}» со стола? Его остаток запишется в журнал.`)) {
                      if (apply((t, now) => removePlayer(t, p.id, now))) setOpen(null)
                    }
                  }}
                >
                  Убрать со стола
                </button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// Посадить нового: постоянный, которого нет за столом, или гость по имени
function SeatNew({ table, regulars, apply }: { table: TableState; regulars: Regular[]; apply: Apply }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const seated = new Set(table.players.map((p) => p.regularId))
  const free = regulars.filter((r) => !seated.has(r.id))

  function seat(player: { name: string; regularId: string | null }) {
    if (apply((t, now) => seatPlayer(t, ulid(), player, now))) {
      setName('')
      setAdding(false)
    }
  }

  function seatGuest(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) seat({ name: name.trim(), regularId: null })
  }

  if (!adding) {
    return (
      <button type="button" className="big wide" onClick={() => setAdding(true)}>
        Посадить игрока
      </button>
    )
  }
  return (
    <div className="card">
      <h2>Посадить игрока</h2>
      {free.map((r) => (
        <button key={r.id} type="button" className="big wide" onClick={() => seat({ name: r.name, regularId: r.id })}>
          {r.name}
        </button>
      ))}
      <form onSubmit={seatGuest}>
        <label className="field">
          Гость
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" />
        </label>
        <button className="big primary wide" disabled={!name.trim()}>
          Посадить гостя
        </button>
      </form>
      <p className="muted">Новый садится с закупом {formatNumber(table.settings.startingStack)}.</p>
      <button type="button" className="big wide" onClick={() => setAdding(false)}>
        Отмена
      </button>
    </div>
  )
}
