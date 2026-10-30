import { useEffect, useState, type CSSProperties, type FormEvent, type MouseEvent } from 'react'
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
import { casinoLayout, MAX_CASINO_SEATS, type CasinoLayout } from '../calc/casinoLayout'
import { formatNumber, formatRub, parseChips, pluralForm } from '../calc/format'
import { addCasino } from '../calc/gameMode'
import { allPicked, toggleAll } from '../calc/pick'
import { lookClass, type Look } from '../calc/pokerLook'
import type { Game } from '../model'
import type { Card } from '../poker/cards'
import { getGame, getSettings, saveGame } from '../store/db'
import { ulid } from '../ulid'
import { loadLook, loadStake, saveLook, saveStake } from './casinoStake'
import { LookFields } from './LookFields'
import { PlayingCard } from './PokerRoom'

const KINDS: DealKind[] = ['holdem', 'omaha']
const KIND_NOTE: Record<DealKind, string> = {
  holdem: 'По 2 карты: рука — любые 5 из своих и стола.',
  omaha: 'По 4 карты: рука — ровно 2 своих и 3 со стола.',
}
const ABANDON = 'Бросить раунд? Он не запишется.'
const TOO_MANY = `За столом казино до ${MAX_CASINO_SEATS} участников`

const players = (n: number) => `${formatNumber(n)} ${pluralForm(n, 'участник', 'участника', 'участников')}`
const tablesOf = (n: number) => `${formatNumber(n)} ${pluralForm(n, 'стол', 'стола', 'столов')}`

// Раздача прошла: карты, победители столов и ставка этого раунда
type Dealt = { deal: Deal; results: BoardResult[]; stake: number }

// Казино-стол (#76, #129): участники, ставка, вариант и столы → у мест карты в открытую, столы в центре
// друг под другом, открываются по одному; итог — обычным раундом казино игры (Р-13). До «Записать раунд»
// ничего не пишется; после — «Ещё раунд» с теми же настройками или «В игру»
export function CasinoDealScreen({ id }: { id: string }) {
  const [game, setGame] = useState<Game | null | undefined>(undefined)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [stakeText, setStakeText] = useState(() => String((loadStake() ?? DEFAULT_STAKE) / 100))
  const [kind, setKind] = useState<DealKind>('holdem')
  const [tables, setTables] = useState(DEFAULT_TABLES)
  const [look, setLook] = useState<Look>(loadLook)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dealt, setDealt] = useState<Dealt | null>(null)
  const [opened, setOpened] = useState(0) // сколько столов открыто
  const [recorded, setRecorded] = useState(false) // раунд записан в игру
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getGame(id).then((g) => {
      setGame(g ?? null)
      if (g) setPicked(new Set(g.players.map((p) => p.id)))
    })
  }, [id])

  const gameHash = `#/game/${encodeURIComponent(id)}`
  const allOpen = dealt !== null && opened >= dealt.deal.boards.length
  const even =
    dealt !== null &&
    roundShares(
      dealt.stake,
      dealt.deal.ids,
      dealt.results.map((r) => r.winners),
    ).every((s) => s.net === 0)
  // Раунд кончен: записан или все при своих — писать нечего, уйти можно без вопроса
  const finished = recorded || (allOpen && even)
  const pending = dealt !== null && !finished

  // Свои кнопки ухода спрашивают; системная «Назад» — нет (сторожа ухода в приложении нет)
  function leave(e?: MouseEvent) {
    if (pending && !confirm(ABANDON)) {
      e?.preventDefault()
      return
    }
    if (!e) location.hash = gameHash
  }

  function dealWith(k: DealKind, ids: string[], count: number, stake: number) {
    const d = newDeal(k, ids, count)
    setDealt({ deal: d, results: d.boards.map((_, i) => boardResult(d, i)), stake })
    setOpened(0)
    setRecorded(false)
    setSummaryOpen(true)
    setSettingsOpen(false)
    setError(null)
  }

  // Игра перечитывается перед записью: правки с экрана игры не теряются, закрытая — не пишется.
  // Все при своих — писать нечего: раунд без долей не добавляется. Записали — остаёмся за столом
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
        // Игра «покер», выбранная из «Играть» → «Казино», становится «покер и казино» — как «Добавить казино» (Р-29)
        const next = addRound(addCasino(fresh), sharesToRound(shares, names), regulars, ulid, new Date().toISOString())
        await saveGame(next)
        setGame(next)
      }
      saveStake(d.stake)
      setRecorded(true)
      setError(null)
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
      <a className="bar-link" href="#/help" aria-label="Справка">
        ?
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
  const ids = game.players.map((p) => p.id).filter((p) => picked.has(p))
  const n = ids.length
  const { hand, label } = DEAL_KINDS[kind]
  const limit = maxTables(kind, n)
  const count = Math.max(1, Math.min(tables, limit))
  const rub = parseChips(stakeText)
  const stake = rub === null ? null : rub * 100
  const enough = n >= MIN_DEAL_PLAYERS
  const fits = n <= MAX_CASINO_SEATS
  const ready = enough && fits && limit >= 1 && stake !== null
  const why = !enough
    ? `Нужно хотя бы ${players(MIN_DEAL_PLAYERS)}`
    : !fits
      ? TOO_MANY
      : limit < 1
        ? `Карт одной колоды не хватит: ${label.toLowerCase()} — до ${players(maxPlayers(kind, 1))} даже на одном столе`
        : stake === null
          ? 'Ставка — целое число рублей больше нуля'
          : null

  function toggle(playerId: string) {
    const next = new Set(picked)
    if (next.has(playerId)) next.delete(playerId)
    else next.add(playerId)
    setPicked(next)
  }

  function changeLook(l: Partial<Look>) {
    const next = { ...look, ...l }
    setLook(next)
    saveLook(next)
  }

  // «Раздать» из настроек или снизу: идёт незаписанный раунд — сначала вопрос
  function deal(e?: FormEvent) {
    e?.preventDefault()
    if (!ready || stake === null) return
    if (pending && !confirm(ABANDON)) return
    dealWith(kind, ids, count, stake)
  }

  // «Ещё раунд» — та же раскладка заново: те же участники, вариант, столы и ставка
  function again() {
    if (!dealt) return
    dealWith(dealt.deal.kind, dealt.deal.ids, dealt.deal.boards.length, dealt.stake)
  }

  const line = [label, tablesOf(count), stake === null ? 'ставка ?' : formatRub(stake), `участников ${formatNumber(n)}`].join(' · ')

  return (
    <main className="screen casino-screen">
      {bar}
      <h1>Казино</h1>
      <p className="muted">{game.name} · карты раздаёт программа, всё в открытую</p>

      <button
        type="button"
        className="casino-fold"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen(!settingsOpen)}
      >
        <span className="grow">{line}</span>
        <span className="muted">{settingsOpen ? '▾' : '▸'}</span>
      </button>

      {settingsOpen && (
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
            {!fits && <p className="warn">{TOO_MANY}</p>}
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

          {/* Вид стола — как у покерного (#77): помнится на этом устройстве */}
          <LookFields look={look} backs onChange={changeLook} />

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
      )}

      {dealt ? (
        <CasinoTable dealt={dealt} opened={opened} nameById={nameById} look={look} />
      ) : (
        ready &&
        stake !== null && <EmptyTable kind={kind} ids={ids} tables={count} stake={stake} nameById={nameById} look={look} />
      )}

      {dealt && allOpen && (
        <Summary dealt={dealt} nameById={nameById} open={summaryOpen} onToggle={() => setSummaryOpen(!summaryOpen)} />
      )}

      <div className="casino-dock">
        {error && <p className="warn">{error}</p>}
        {!dealt ? (
          <>
            {why && <p className="warn">{why}</p>}
            <button type="button" className="big primary wide" disabled={!ready} onClick={() => deal()}>
              Раздать
            </button>
          </>
        ) : finished ? (
          <>
            <p className={recorded && !even ? 'ok' : 'muted'}>
              {recorded && !even ? 'Раунд записан в игру' : 'Все при своих — раунд не пишется'}
            </p>
            <div className="dock-row">
              <button type="button" className="big primary grow" onClick={again}>
                Ещё раунд
              </button>
              <a className="big grow button-link" href={gameHash}>
                В игру
              </a>
            </div>
          </>
        ) : (
          <>
            {allOpen ? (
              <button type="button" className="big primary wide" disabled={busy} onClick={() => void record(dealt)}>
                Записать раунд
              </button>
            ) : (
              <button type="button" className="big primary wide" onClick={() => setOpened(opened + 1)}>
                Открыть стол {opened + 1}
              </button>
            )}
            <button type="button" className="big wide danger-text" onClick={() => leave()}>
              Бросить раунд
            </button>
          </>
        )}
      </div>
    </main>
  )
}

// CSS-переменные размеров из раскладки: экран красит места и карты теми же rem, что проверяет тест
function layoutStyle(l: CasinoLayout): CSSProperties {
  const rem = (x: number) => `${x}rem`
  return {
    '--seat-w': rem(l.seat.w),
    '--seat-h': rem(l.seat.h),
    '--hand-w': rem(l.hand.w),
    '--hand-h': rem(l.hand.h),
    '--board-w': rem(l.board.w),
    '--board-card-w': rem(l.boardCard.w),
    '--board-card-h': rem(l.boardCard.h),
  } as CSSProperties
}

type SeatData = { id: string; name: string; cards: (Card | null)[]; win: string | null }
type BoardData = { cards: (Card | null)[]; part: number; open: boolean; last: boolean; foot: string; win: Card[] }

// Сукно с рядами мест над и под колонкой столов (casinoLayout): места по часовой от верхнего левого
function Felt(props: { layout: CasinoLayout; seats: SeatData[]; boards: BoardData[]; look: Look }) {
  const { layout: l, seats, boards, look } = props
  const block = (rows: number[][]) =>
    rows.map((row, r) => (
      <div key={r} className="casino-row">
        {row.map((k) => (
          <Seat key={seats[k].id} seat={seats[k]} />
        ))}
      </div>
    ))
  return (
    <div className={`casino-table ${lookClass(look)}`} style={layoutStyle(l)}>
      <div className="felt casino-felt" />
      <div className="casino-seats">{block(l.top)}</div>
      <div className="casino-boards">
        {boards.map((b, i) => (
          <section key={i} className={['casino-board', b.open && 'open', b.last && 'last'].filter(Boolean).join(' ')}>
            <div className="casino-board-line">
              Стол {i + 1} · {formatRub(b.part)}
            </div>
            <div className="card-row">
              {b.cards.map((c, k) => (
                <PlayingCard key={k} card={c} mark={b.open && c ? (b.win.includes(c) ? 'win' : 'dim') : undefined} />
              ))}
            </div>
            <div className="casino-board-line">{b.foot}</div>
          </section>
        ))}
      </div>
      <div className="casino-seats">{block(l.bottom)}</div>
    </div>
  )
}

// Место: имя, карты лицом; победитель последнего открытого стола — рамка и подпись руки
function Seat({ seat }: { seat: SeatData }) {
  return (
    <div className={seat.win ? 'casino-seat winner' : 'casino-seat'}>
      <span className="seat-name">{seat.name}</span>
      <span className="card-row casino-hand">
        {seat.cards.map((c, i) => (
          <PlayingCard key={i} card={c} />
        ))}
      </span>
      <span className="seat-mark" title={seat.win ?? undefined}>
        {seat.win ?? ' '}
      </span>
    </div>
  )
}

// До раздачи — тот же стол: места с именами и рубашками, столы рубашкой с частью банка
function EmptyTable(props: {
  kind: DealKind
  ids: string[]
  tables: number
  stake: number
  nameById: Map<string, string>
  look: Look
}) {
  const { kind, ids, tables, stake, nameById, look } = props
  const back = Array.from({ length: DEAL_KINDS[kind].hand }, () => null)
  const parts = tableParts(stake * ids.length, tables)
  return (
    <Felt
      layout={casinoLayout(kind, ids.length, tables)}
      look={look}
      seats={ids.map((pid) => ({ id: pid, name: nameById.get(pid) ?? '?', cards: back, win: null }))}
      boards={parts.map((part) => ({
        cards: Array.from({ length: BOARD_CARDS }, () => null),
        part,
        open: false,
        last: false,
        foot: ' ',
        win: [],
      }))}
    />
  )
}

// После раздачи: у мест карты лицом, столы рубашкой до «Открыть стол»
function CasinoTable(props: { dealt: Dealt; opened: number; nameById: Map<string, string>; look: Look }) {
  const { dealt, opened, nameById, look } = props
  const { deal, results, stake } = dealt
  const name = (pid: string) => nameById.get(pid) ?? '?'
  const parts = tableParts(stake * deal.ids.length, deal.boards.length)
  const current = opened > 0 ? results[opened - 1] : null
  return (
    <Felt
      layout={casinoLayout(deal.kind, deal.ids.length, deal.boards.length)}
      look={look}
      seats={deal.ids.map((pid) => ({
        id: pid,
        name: name(pid),
        cards: deal.hands[pid],
        win: current?.winners.includes(pid) ? current.hand : null,
      }))}
      boards={deal.boards.map((board, i) => {
        const open = i < opened
        const r = results[i]
        return {
          cards: open ? board : board.map(() => null),
          part: parts[i],
          open,
          last: open && i === opened - 1,
          foot: !open ? ' ' : r.winners.length > 1 ? 'Ничья, поровну' : `${name(r.winners[0])} · ${r.hand}`,
          win: open ? r.winners.flatMap((pid) => r.best[pid]) : [],
        }
      })}
    />
  )
}

// «Итог раунда» — раскрыт, касание заголовка сворачивает
function Summary(props: { dealt: Dealt; nameById: Map<string, string>; open: boolean; onToggle: () => void }) {
  const { dealt, nameById, open, onToggle } = props
  const { deal, results, stake } = dealt
  const pot = stake * deal.ids.length
  const shares = roundShares(
    stake,
    deal.ids,
    results.map((r) => r.winners),
  )
  return (
    <section className="card summary">
      <button type="button" className="casino-fold plain" aria-expanded={open} onClick={onToggle}>
        <strong className="grow">Итог раунда</strong>
        <span className="muted">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
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
                  <td>{nameById.get(s.id) ?? '?'}</td>
                  <td className="num">{formatRub(s.won)}</td>
                  <td className="num">−{formatRub(stake)}</td>
                  <td className={'num ' + (s.net > 0 ? 'plus' : s.net < 0 ? 'minus' : '')}>
                    <strong>{formatRub(s.net, true)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  )
}
