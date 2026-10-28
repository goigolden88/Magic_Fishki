import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { addRound } from '../calc/casino'
import {
  boardResult,
  BOARD_CARDS,
  cardsUsed,
  DEAL_KINDS,
  deckSize,
  DEFAULT_STAKE,
  DEFAULT_TABLES,
  maxPlayers,
  maxTables,
  MIN_DEAL_PLAYERS,
  newDeal,
  roundShares,
  sharesToRound,
  tableParts,
  type BoardResult,
  type Deal,
  type DealKind,
} from '../calc/casinoDeal'
import { formatNumber, formatRub, parseChips, pluralForm } from '../calc/format'
import { allPicked, toggleAll } from '../calc/pick'
import type { Game } from '../model'
import { getGame, getSettings, saveGame } from '../store/db'
import { ulid } from '../ulid'
import { loadStake, saveStake } from './casinoStake'
import { PlayingCard } from './PokerRoom'

const KINDS: DealKind[] = ['holdem', 'omaha']
const KIND_NOTE: Record<DealKind, string> = {
  holdem: 'По 2 карты: рука — любые 5 из своих и стола.',
  omaha: 'По 4 карты: рука — ровно 2 своих и 3 со стола.',
}
const ABANDON = 'Бросить раунд? Он не запишется.'

const players = (n: number) => `${formatNumber(n)} ${pluralForm(n, 'участник', 'участника', 'участников')}`
const tablesOf = (n: number) => `${formatNumber(n)} ${pluralForm(n, 'стол', 'стола', 'столов')}`

// Раздача прошла: карты, победители столов и ставка этого раунда
type Dealt = { deal: Deal; results: BoardResult[]; stake: number }

// Раунд казино с картами (#76): участники, ставка, вариант и столы → карты в открытую, столы по одному,
// итог — обычным раундом казино игры (Р-13). До «Записать раунд» ничего не пишется
export function CasinoDealScreen({ id }: { id: string }) {
  const [game, setGame] = useState<Game | null | undefined>(undefined)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [stakeText, setStakeText] = useState(() => String((loadStake() ?? DEFAULT_STAKE) / 100))
  const [kind, setKind] = useState<DealKind>('holdem')
  const [tables, setTables] = useState(DEFAULT_TABLES)
  const [dealt, setDealt] = useState<Dealt | null>(null)
  const [opened, setOpened] = useState(0) // сколько столов открыто
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getGame(id).then((g) => {
      setGame(g ?? null)
      if (g) setPicked(new Set(g.players.map((p) => p.id)))
    })
  }, [id])

  const gameHash = `#/game/${encodeURIComponent(id)}`

  // Свои кнопки ухода спрашивают; системная «Назад» — нет (сторожа ухода в приложении нет)
  function leave(e?: MouseEvent) {
    if (dealt && !confirm(ABANDON)) {
      e?.preventDefault()
      return
    }
    if (!e) location.hash = gameHash
  }

  // Игра перечитывается перед записью: правки с экрана игры не теряются, закрытая — не пишется.
  // Все при своих — писать нечего: раунд без долей не добавляется
  async function record(d: Dealt) {
    setBusy(true)
    try {
      const fresh = await getGame(id)
      if (!fresh || fresh.closed) {
        setError('Игра закрыта — раунд не записан')
        return
      }
      const shares = roundShares(
        d.stake,
        d.deal.ids,
        d.results.map((r) => r.winners),
      )
      if (shares.some((s) => s.net !== 0)) {
        const names = new Map(fresh.players.map((p) => [p.id, p.name]))
        const { players: regulars } = await getSettings()
        await saveGame(addRound(fresh, sharesToRound(shares, names), regulars, ulid, new Date().toISOString()))
      }
      saveStake(d.stake)
      location.hash = gameHash
    } catch {
      setError('Не удалось записать раунд — попробуйте ещё раз')
    } finally {
      setBusy(false)
    }
  }

  const bar = (
    <header className="bar">
      <a className="bar-link" href={gameHash} onClick={(e) => leave(e)}>
        ← Игра
      </a>
    </header>
  )

  if (game === undefined) return <main className="screen" />
  if (game === null || game.closed) {
    return (
      <main className="screen">
        {bar}
        <p className="muted center">{game === null ? 'Игра не найдена' : 'Игра закрыта — раунд не раздать'}</p>
      </main>
    )
  }

  const nameById = new Map(game.players.map((p) => [p.id, p.name]))

  if (dealt) {
    return (
      <main className="screen">
        {bar}
        <DealtRound
          dealt={dealt}
          opened={opened}
          nameById={nameById}
          busy={busy}
          error={error}
          onOpen={() => setOpened((n) => n + 1)}
          onRecord={() => void record(dealt)}
          onAbandon={() => leave()}
        />
      </main>
    )
  }

  const ids = game.players.map((p) => p.id).filter((p) => picked.has(p))
  const n = ids.length
  const { hand, label } = DEAL_KINDS[kind]
  const limit = maxTables(kind, n)
  const count = Math.max(1, Math.min(tables, limit))
  const rub = parseChips(stakeText)
  const stake = rub === null ? null : rub * 100
  const enough = n >= MIN_DEAL_PLAYERS
  const ready = enough && limit >= 1 && stake !== null

  function toggle(playerId: string) {
    const next = new Set(picked)
    if (next.has(playerId)) next.delete(playerId)
    else next.add(playerId)
    setPicked(next)
  }

  function deal(e: FormEvent) {
    e.preventDefault()
    if (!ready || stake === null) return
    const d = newDeal(kind, ids, count)
    setDealt({ deal: d, results: d.boards.map((_, i) => boardResult(d, i)), stake })
    setOpened(0)
    setError(null)
  }

  return (
    <main className="screen">
      {bar}
      <h1>Раунд казино</h1>
      <p className="muted">{game.name} · карты раздаёт программа, всё в открытую</p>

      <form className="card" onSubmit={deal}>
        <fieldset className="players-pick">
          <legend className="muted">
            Участники: {n} из {game.players.length}
          </legend>
          <button
            type="button"
            className="big wide"
            onClick={() => setPicked(toggleAll(game.players.map((p) => p.id), picked))}
          >
            {allPicked(game.players.map((p) => p.id), picked) ? 'Снять все' : 'Выбрать всех'}
          </button>
          {game.players.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              {p.name}
            </label>
          ))}
        </fieldset>

        <label className="field">
          Ставка с каждого, ₽
          <input
            inputMode="numeric"
            pattern="[0-9 ]*"
            value={stakeText}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setStakeText(e.target.value)}
          />
        </label>
        {stake === null && <p className="warn">Ставка — целое число рублей больше нуля</p>}

        <fieldset className="players-pick">
          <legend className="muted">Вариант</legend>
          <div className="row">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={kind === k ? 'big primary grow' : 'big grow'}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {DEAL_KINDS[k].label}
              </button>
            ))}
          </div>
          <p className="muted">{KIND_NOTE[kind]}</p>
        </fieldset>

        <fieldset className="players-pick">
          <legend className="muted">Столов по {BOARD_CARDS} карт</legend>
          <div className="row">
            <button
              type="button"
              className="big"
              aria-label="Меньше столов"
              disabled={count <= 1}
              onClick={() => setTables(count - 1)}
            >
              −
            </button>
            <span className="grow stepper-value">{limit >= 1 ? count : '—'}</span>
            <button
              type="button"
              className="big"
              aria-label="Больше столов"
              disabled={count >= limit}
              onClick={() => setTables(count + 1)}
            >
              +
            </button>
          </div>
          {limit < 1 ? (
            <p className="warn">
              Карт одной колоды не хватит: {label.toLowerCase()} — до {players(maxPlayers(kind, 1))} даже на одном столе
            </p>
          ) : (
            <>
              {enough && count >= limit && (
                <p className="warn">
                  Больше столов нельзя: {players(n)} × {hand} карты + {tablesOf(count)} × {BOARD_CARDS} ={' '}
                  {cardsUsed(kind, n, count)} из {deckSize(kind)} карт — на ещё один стол не хватит
                </p>
              )}
              <p className="muted">
                {label}, {tablesOf(count)} — до {players(maxPlayers(kind, count))}
              </p>
            </>
          )}
        </fieldset>

        {ready && (
          <p>
            Банк: {formatRub(stake * n)} · на стол — {formatRub(tableParts(stake * n, count)[0])}
          </p>
        )}
        {!enough && <p className="muted">Нужно хотя бы {players(MIN_DEAL_PLAYERS)}</p>}
        <button className="big primary wide" disabled={!ready}>
          Раздать
        </button>
      </form>
    </main>
  )
}

type DealtProps = {
  dealt: Dealt
  opened: number
  nameById: Map<string, string>
  busy: boolean
  error: string | null
  onOpen: () => void
  onRecord: () => void
  onAbandon: () => void
}

// Карты участников лицом, столы — рубашкой до «Открыть стол»; когда открыты все — итог раунда
function DealtRound({ dealt, opened, nameById, busy, error, onOpen, onRecord, onAbandon }: DealtProps) {
  const { deal, results, stake } = dealt
  const pot = stake * deal.ids.length
  const parts = tableParts(pot, deal.boards.length)
  const done = opened >= deal.boards.length
  const shares = roundShares(
    stake,
    deal.ids,
    results.map((r) => r.winners),
  )
  const even = shares.every((s) => s.net === 0)
  const name = (pid: string) => nameById.get(pid) ?? '?'

  return (
    <>
      <h1>Раунд казино</h1>
      <p className="muted">
        {DEAL_KINDS[deal.kind].label} · ставка {formatRub(stake)} · банк {formatRub(pot)} · {tablesOf(deal.boards.length)}
      </p>

      <section className="card">
        <h2>Карты</h2>
        <ul className="deal-hands">
          {deal.ids.map((pid) => (
            <li key={pid}>
              <span className="grow">{name(pid)}</span>
              <span className="card-row">
                {deal.hands[pid].map((c) => (
                  <PlayingCard key={c} card={c} />
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {deal.boards.map((board, i) => {
        const open = i < opened
        const r = results[i]
        return (
          <section key={i} className={'card deal-board' + (open ? ' open' : '')}>
            <h2>
              Стол {i + 1} · {formatRub(parts[i])}
            </h2>
            <div className="card-row">
              {board.map((c) => (
                <PlayingCard key={c} card={open ? c : null} />
              ))}
            </div>
            {open && (
              <ul className="deal-winners">
                {/* У победителя — подпись и под ней пятёрка лучшей руки (#96); карты руки — в «Картах» выше */}
                {r.winners.map((pid) => (
                  <li key={pid} className="deal-winner">
                    <span>
                      <strong>{name(pid)}</strong> <span className="muted">· {r.hand}</span>
                    </span>
                    <span className="card-row">
                      {r.best[pid].map((c) => (
                        <PlayingCard key={c} card={c} size="small" />
                      ))}
                    </span>
                  </li>
                ))}
                {r.winners.length > 1 && <li className="muted">Ничья, поровну</li>}
              </ul>
            )}
          </section>
        )
      })}

      {!done ? (
        <button className="big primary wide" onClick={onOpen}>
          Открыть стол {opened + 1}
        </button>
      ) : (
        <section className="card summary">
          <h2>Итог раунда</h2>
          <p className="ok">
            Раунд в ноль: роздано {formatRub(shares.reduce((s, x) => s + x.won, 0))} из {formatRub(pot)}
          </p>
          <table className="totals three">
            <thead>
              <tr>
                <th />
                <th className="num">выиграл</th>
                <th className="num">ставка</th>
                <th className="num">итог</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((s) => (
                <tr key={s.id}>
                  <td>{name(s.id)}</td>
                  <td className="num">{formatRub(s.won)}</td>
                  <td className="num">−{formatRub(stake)}</td>
                  <td className={'num ' + (s.net > 0 ? 'plus' : s.net < 0 ? 'minus' : '')}>
                    <strong>{formatRub(s.net, true)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {even && <p className="muted">Все при своих — в казино игры раунд не попадёт</p>}
          {error && <p className="warn">{error}</p>}
          <button className="big primary wide" disabled={busy} onClick={onRecord}>
            {even ? 'Вернуться в игру' : 'Записать раунд'}
          </button>
        </section>
      )}

      <button className="big wide danger-text" onClick={onAbandon}>
        Бросить раунд
      </button>
    </>
  )
}
