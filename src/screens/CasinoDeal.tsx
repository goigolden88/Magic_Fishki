import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
} from 'react'
import { addRound } from '../calc/casino'
import {
  allShown,
  AUTO_OPEN_CHOICES,
  autoOpenLabel,
  BOARD_FLIP_MS,
  cardsShown,
  nextWake,
  openNext,
  openNow,
  revealEvery,
  revealHold,
  revealPause,
  revealRelease,
  revealResume,
  revealStart,
  revealTick,
  secondsLeft,
  turning,
  type Reveal,
} from '../calc/casinoReveal'
import { dealFlights, flightsEnd, flyKey, seatGroup, type Flight } from '../calc/dealAnimation'
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
import { topOdds, type CasinoOdds } from '../calc/casinoOdds'
import { formatNumber, formatRub, parseChips, pluralForm } from '../calc/format'
import { addCasino } from '../calc/gameMode'
import { allPicked, toggleAll } from '../calc/pick'
import { lookClass, type Look } from '../calc/pokerLook'
import { SAME_NAME, withGuest, type Game } from '../model'
import type { Card } from '../poker/cards'
import { getGame, getSettings, saveGame } from '../store/db'
import { ulid } from '../ulid'
import { useCasinoOdds } from './casinoOddsClient'
import { restoredReveal, savedCasinoRound } from '../calc/savedCasino'
import {
  clearRound,
  loadAutoOpen,
  loadLook,
  loadOdds,
  loadRound,
  loadStake,
  saveAutoOpen,
  saveOdds,
  saveRound,
  saveStake,
} from './casinoStake'
import { playFlights, useLandOnHide } from './cardFly'
import { GuestField } from './GuestField'
import { PlayingCard } from './PokerRoom'
import { loadCardAnim, loadMyLook } from './pokerStorage'
import { useWide } from './useWide'

const KINDS: DealKind[] = ['holdem', 'omaha']
const KIND_NOTE: Record<DealKind, string> = {
  holdem: 'По 2 карты: рука — любые 5 из своих и стола.',
  omaha: 'По 4 карты: рука — ровно 2 своих и 3 со стола.',
}
const ABANDON = 'Бросить раунд? Он не запишется.'
const TOO_MANY = `За столом казино до ${MAX_CASINO_SEATS} участников`

const players = (n: number) => `${formatNumber(n)} ${pluralForm(n, 'участник', 'участника', 'участников')}`
const tablesOf = (n: number) => `${formatNumber(n)} ${pluralForm(n, 'стол', 'стола', 'столов')}`

// Раздача прошла: карты, победители столов, ставка этого раунда и план анимации раздачи (#133; нет — карты сразу)
type Dealt = { deal: Deal; results: BoardResult[]; stake: number; fly: Flight[] | null }

// Казино-стол (#76, #129): участники, ставка, вариант и столы → у мест карты в открытую, столы в центре
// друг под другом, открываются по одному; итог — обычным раундом казино игры (Р-13). До «Записать раунд»
// ничего не пишется; после — «Ещё раунд» с теми же настройками или «В игру»
export function CasinoDealScreen({ id }: { id: string }) {
  const [game, setGame] = useState<Game | null | undefined>(undefined)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [full, setFull] = useState(false) // гость добавлен в игру, но не отмечен: за столом уже предел
  const [stakeText, setStakeText] = useState(() => String((loadStake() ?? DEFAULT_STAKE) / 100))
  const [kind, setKind] = useState<DealKind>('holdem')
  const [tables, setTables] = useState(DEFAULT_TABLES)
  // «Как у стола» казино: сукно и рубашка, выбранные здесь до Р-59 (нет — зелёное и классика); свой — «Вид стола»
  const [look] = useState<Look>(loadLook)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [autoOpen, setAutoOpen] = useState(loadAutoOpen) // «Открывать столы сами», секунд; 0 — «Нет» (#134)
  const [showOdds, setShowOdds] = useState(loadOdds) // «Шансы» (#137)
  const [dealt, setDealt] = useState<Dealt | null>(null)
  const [reveal, setReveal] = useState<Reveal | null>(null) // сколько столов открыто и отсчёт до следующего
  const [now, setNow] = useState(() => Date.now()) // часы экрана: по ним переворот карт и отсчёт
  const [recorded, setRecorded] = useState(false) // раунд записан в игру
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Незаписанный раунд этой игры на устройстве (#151) — тот же раунд: карты уже лежат, без анимации раздачи,
  // столы сами — на паузе до касания. Игры нет или закрыта — сохранённый стирается
  useEffect(() => {
    void getGame(id).then((g) => {
      setGame(g ?? null)
      if (!g || g.closed) {
        clearRound(id)
        return
      }
      const saved = loadRound(id, g.players.map((p) => p.id))
      if (!saved) {
        setPicked(new Set(g.players.map((p) => p.id)))
        return
      }
      const { deal: d, stake: s, opened: o } = saved
      const t = Date.now()
      setPicked(new Set(d.ids))
      setKind(d.kind)
      setTables(d.boards.length)
      setStakeText(String(s / 100))
      setDealt({ deal: d, results: d.boards.map((_, i) => boardResult(d, i)), stake: s, fly: null })
      setNow(t)
      setReveal(restoredReveal(d.boards.length, o, autoOpen > 0 ? autoOpen * 1000 : null, loadCardAnim() ? BOARD_FLIP_MS : 0, t))
    })
  }, [id])

  // Шаг открытия столов в эту минуту: часы экрана — заодно
  function act(step: (r: Reveal, t: number) => Reveal) {
    const t = Date.now()
    setNow(t)
    setReveal((r) => (r ? step(r, t) : r))
  }

  // Будильник экрана: к следующей карте, смене секунды отсчёта или сроку; срок пришёл — открыть стол
  useEffect(() => {
    if (!reveal) return
    const wait = nextWake(reveal, now)
    if (wait === null) return
    const timer = setTimeout(() => act(revealTick), wait)
    return () => clearTimeout(timer)
  }, [reveal, now])

  // Свернули приложение или ушли на другую вкладку — отсчёт стоит; вернулись — с того же места
  useEffect(() => {
    const onVisibility = () => act(document.visibilityState === 'hidden' ? revealHold : revealRelease)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const gameHash = `#/game/${encodeURIComponent(id)}`
  const allOpen = dealt !== null && reveal !== null && allShown(reveal, now)
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

  // Открытие столов: сколько открыто, сколько карт лицом у последнего, переворачивается ли он
  const opened = reveal?.opened ?? 0

  // Раунд не записан — на устройстве после раздачи и каждого открытого стола (#151); кончен — стёрт
  useEffect(() => {
    if (!dealt) return
    if (finished) clearRound(id)
    else saveRound(savedCasinoRound(id, dealt.deal, dealt.stake, opened))
  }, [id, dealt, opened, finished])
  const shown = reveal ? cardsShown(reveal, now) : 0
  const flipping = reveal !== null && turning(reveal, now)
  // Шансы (#137): видимые карты столов — открытые целиком, открывающийся — сколько лицом, остальные рубашкой
  const visible = dealt ? dealt.deal.boards.map((_, i) => (i < opened - 1 ? BOARD_CARDS : i === opened - 1 ? shown : 0)) : []
  const odds = useCasinoOdds(showOdds && dealt ? dealt.deal : null, dealt?.stake ?? 0, visible)

  // «Бросить раунд?» — пока вопрос, отсчёт стоит; остались — идёт с того же места
  function abandon(): boolean {
    if (!pending) return true
    const held = reveal && revealHold(reveal, Date.now())
    const ok = confirm(ABANDON)
    if (ok) clearRound(id)
    if (!ok && held) {
      const t = Date.now()
      setNow(t)
      setReveal(revealRelease(held, t))
    }
    return ok
  }

  // Свои кнопки ухода спрашивают; системная «Назад» — нет (сторожа ухода в приложении нет),
  // но раунд остаётся на устройстве и ждёт возврата (#151)
  function leave(e?: MouseEvent) {
    if (!abandon()) {
      e?.preventDefault()
      return
    }
    if (!e) location.hash = gameHash
  }

  function dealWith(k: DealKind, ids: string[], count: number, stake: number) {
    const d = newDeal(k, ids, count)
    const anim = loadCardAnim()
    // Анимация раздачи (#133): карты по местам по одной, по часовой с первого; план — один на раздачу,
    // открытие столов его не проигрывает заново. Первый стол сам — через промежуток после неё (#134)
    const fly = anim ? dealFlights(d.ids.map((_, i) => i), 0, DEAL_KINDS[k].hand) : null
    const t = Date.now()
    setDealt({ deal: d, results: d.boards.map((_, i) => boardResult(d, i)), stake, fly })
    setNow(t)
    setReveal(
      revealStart(d.boards.length, autoOpen > 0 ? autoOpen * 1000 : null, anim ? BOARD_FLIP_MS : 0, t, fly ? flightsEnd(fly) : 0),
    )
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
      clearRound(id)
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
    setFull(false)
  }

  // Гость за столом (Р-44): сразу участник игры — игра перечитывается и сохраняется, как перед записью
  // раунда; отмечен в раунд, если за столом есть место, иначе — прежняя подсказка о пределе
  async function addGuest(guest: string) {
    setBusy(true)
    try {
      const fresh = await getGame(id)
      if (!fresh || fresh.closed) {
        setError('Игра закрыта — гость не добавлен')
        return
      }
      const { players: regulars } = await getSettings()
      const added = withGuest(fresh.players, guest, regulars, ulid())
      if (!added) {
        setError(SAME_NAME)
        return
      }
      const next = await saveGame({ ...fresh, players: added })
      setGame(next)
      const newId = added[added.length - 1].id
      const room = fresh.players.filter((p) => picked.has(p.id)).length < MAX_CASINO_SEATS
      if (room) setPicked(new Set([...picked, newId]))
      setFull(!room)
      setError(null)
    } catch {
      setError('Не удалось добавить гостя — попробуйте ещё раз')
    } finally {
      setBusy(false)
    }
  }

  // Промежуток помнится на устройстве; посреди раунда — отсчёт заново с новым, «Нет» — снят
  function changeAutoOpen(seconds: number) {
    setAutoOpen(seconds)
    saveAutoOpen(seconds)
    act((r, t) => revealEvery(r, seconds > 0 ? seconds * 1000 : null, t))
  }

  function changeOdds(on: boolean) {
    setShowOdds(on)
    saveOdds(on)
  }

  // «Раздать» из настроек или снизу: идёт незаписанный раунд — сначала вопрос
  function deal(e?: FormEvent) {
    e?.preventDefault()
    if (!ready || stake === null) return
    if (!abandon()) return
    dealWith(kind, ids, count, stake)
  }

  // «Ещё раунд» — та же раскладка заново: те же участники, вариант, столы и ставка
  function again() {
    if (!dealt) return
    dealWith(dealt.deal.kind, dealt.deal.ids, dealt.deal.boards.length, dealt.stake)
  }

  const line = [
    label,
    tablesOf(count),
    stake === null ? 'ставка ?' : formatRub(stake),
    `участников ${formatNumber(n)}`,
    autoOpen > 0 && `сами через ${autoOpen} с`,
  ]
    .filter(Boolean)
    .join(' · ')

  const counting = reveal !== null && reveal.every !== null && reveal.opened < reveal.total
  const autoLine = !reveal
    ? ''
    : reveal.paused
      ? `Пауза · стол ${opened + 1}`
      : `Стол ${opened + 1} через ${secondsLeft(reveal, now) ?? autoOpen} с`

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
              onClick={() => {
                setPicked(toggleAll(game.players.map((p) => p.id), picked))
                setFull(false)
              }}
            >
              {allPicked(game.players.map((p) => p.id), picked) ? 'Снять все' : 'Выбрать всех'}
            </button>
            {game.players.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                {p.name}
              </label>
            ))}
            {(!fits || full) && <p className="warn">{TOO_MANY}</p>}
            {/* Р-44: гость — сразу участник игры; во время незаписанного раунда — нет */}
            {!pending && (
              <GuestField taken={game.players.map((p) => p.name)} onAdd={(g) => void addGuest(g)} />
            )}
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

          {/* Столы сами через промежуток (#134): помнится на этом устройстве */}
          <fieldset className="players-pick">
            <legend className="muted">Открывать столы сами</legend>
            <div className="row casino-auto">
              {AUTO_OPEN_CHOICES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={autoOpen === s ? 'big primary grow' : 'big grow'}
                  aria-pressed={autoOpen === s}
                  onClick={() => changeAutoOpen(s)}
                >
                  {autoOpenLabel(s)}
                </button>
              ))}
            </div>
            <p className="muted">
              {autoOpen > 0
                ? `После раздачи столы открываются по одному, каждый через ${autoOpen} с после прошлого`
                : 'Столы открываются кнопкой «Открыть стол»'}
            </p>
          </fieldset>

          {/* Шансы победы (#137): помнится на этом устройстве */}
          <fieldset className="players-pick">
            <legend className="muted">Шансы</legend>
            <div className="row">
              {[true, false].map((on) => (
                <button
                  key={String(on)}
                  type="button"
                  className={showOdds === on ? 'big primary grow' : 'big grow'}
                  aria-pressed={showOdds === on}
                  onClick={() => changeOdds(on)}
                >
                  {on ? 'Да' : 'Нет'}
                </button>
              ))}
            </div>
            <p className="muted">
              {showOdds
                ? 'Под каждым столом — шансы победы, у мест — ожидаемый итог раунда; пересчёт после каждой открытой карты'
                : 'Только карты и победители столов'}
            </p>
          </fieldset>

          {/* Р-59: свой выбор вида в казино дублировал «Вид стола» в «Настройках» — выбор там; прежний читается */}
          <p className="muted">Сукно, рубашка и колода — в «Настройках», «Вид стола».</p>

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
        <CasinoTable
          dealt={dealt}
          opened={opened}
          shown={shown}
          flipping={flipping}
          odds={odds}
          nameById={nameById}
          look={look}
        />
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
            ) : counting ? (
              <>
                <p className="muted" aria-live="polite">
                  {autoLine}
                </p>
                <div className="dock-row">
                  <button type="button" className="big primary grow" onClick={() => act(openNow)}>
                    Открыть сейчас
                  </button>
                  <button
                    type="button"
                    className="big grow"
                    onClick={() => act(reveal?.paused ? revealResume : revealPause)}
                  >
                    {reveal?.paused ? 'Продолжить' : 'Пауза'}
                  </button>
                </div>
              </>
            ) : opened < dealt.deal.boards.length ? (
              <button type="button" className="big primary wide" onClick={() => act(openNext)}>
                Открыть стол {opened + 1}
              </button>
            ) : (
              // Последний стол ещё переворачивается — открыть его сразу целиком
              <button type="button" className="big primary wide" onClick={() => act(openNow)}>
                Открыть сейчас
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
    '--board-cols': String(l.cols),
    '--center-w': rem(l.center.w),
    '--layout-w': rem(l.width),
    '--board-card-w': rem(l.boardCard.w),
    '--board-card-h': rem(l.boardCard.h),
    '--win-card-w': rem(l.winCard.w),
    '--win-card-h': rem(l.winCard.h),
    '--win-row-h': rem(l.winRow.h),
  } as CSSProperties
}

// net — шансы включены (#137): ожидаемый итог раунда, копеек; exact — все столы открыты, итог точный
type SeatData = { id: string; name: string; cards: (Card | null)[]; win: string | null; net?: number; exact?: boolean }
type Chance = { name: string; percent: number }
// turn — стол открывается: карты лицом по одной (#134), победителя ещё не видно.
// chances — шансы стола вместо подписи под картами, пока он не открыт целиком (#137); more — «ещё N».
// Касание строки раскрывает её (#142): all — все ненулевые шансы, expanded — раскрыта, onToggle — касание
type Chances = { top: Chance[]; more: number; all: Chance[]; expanded: boolean; onToggle: () => void }
// Победитель открытого стола (Р-50): имя, название руки и пять карт лучшей руки — сначала комбинация, затем старшие
type Winner = { name: string; hand: string; cards: Card[] }
// winners — у открытого целиком стола, ничья — несколько (над ними «Ничья, поровну»); иначе пусто
type BoardData = {
  cards: (Card | null)[]
  part: number
  open: boolean
  turn?: boolean
  last: boolean
  winners: Winner[]
  win: Card[]
  chances?: Chances
}

// Сукно с рядами мест над и под колонкой столов (casinoLayout): места по часовой от верхнего левого.
// fly — анимация раздачи (#133): новый план — карты мест летят к ним из колонки столов; нет — карты сразу на местах
function Felt(props: { layout: CasinoLayout; seats: SeatData[]; boards: BoardData[]; look: Look; fly?: Flight[] | null }) {
  const { layout: l, seats, boards, look, fly = null } = props
  const ref = useRef<HTMLDivElement>(null)
  // До отрисовки: карты не мелькают на местах перед полётом
  useLayoutEffect(() => {
    if (fly && ref.current && document.visibilityState === 'visible') playFlights(ref.current, fly)
  }, [fly])
  useLandOnHide(ref)
  const block = (rows: number[][]) =>
    rows.map((row, r) => (
      <div key={r} className="casino-row">
        {row.map((k) => (
          <Seat key={seats[k].id} seat={seats[k]} index={k} />
        ))}
      </div>
    ))
  return (
    <div ref={ref} className={`casino-table${l.wide ? ' wide' : ''} ${lookClass(look, loadMyLook())}`} style={layoutStyle(l)}>
      <div className="felt casino-felt" />
      <div className="casino-seats">{block(l.top)}</div>
      <div className="casino-boards" data-fly-origin>
        {boards.map((b, i) => (
          <section
            key={i}
            className={['casino-board', b.open && 'open', b.turn && 'turn', b.last && 'last'].filter(Boolean).join(' ')}
          >
            <div className="casino-board-line">
              Стол {i + 1} · {formatRub(b.part)}
            </div>
            <div className="card-row">
              {b.cards.map((c, k) => (
                <PlayingCard key={k} card={c} mark={b.open && c ? (b.win.includes(c) ? 'win' : 'dim') : undefined} />
              ))}
            </div>
            {b.chances && <ChanceLine {...b.chances} />}
            {/* Победитель — под картами; на широком окне (Р-60) — тоже, имя и рука переносятся */}
            <div className="casino-board-side">
              {!b.chances && b.winners.length !== 1 && (
                <div className={b.winners.length > 1 ? 'casino-board-line' : 'casino-board-line casino-win-gap'}>
                  {b.winners.length > 1 ? 'Ничья, поровну' : ' '}
                </div>
              )}
              {b.winners.length > 0 ? (
                b.winners.map((w, k) => <WinnerLine key={k} winner={w} />)
              ) : (
                // Место под ряд карт победителя: открылся стол — столы ниже не сдвигаются
                <div className="casino-win-row" aria-hidden="true" />
              )}
            </div>
          </section>
        ))}
      </div>
      <div className="casino-seats">{block(l.bottom)}</div>
    </div>
  )
}

// Строка победителя стола (Р-50): «Имя · рука» — длинное имя сжимается многоточием, рука видна;
// под ней — пять мелких карт его лучшей руки, как у победителя в покерной комнате.
// На широком окне (Р-60) — то же, но имя и рука переносятся целиком, карты крупнее (стили .casino-table.wide)
function WinnerLine({ winner: w }: { winner: Winner }) {
  return (
    <>
      <div className="casino-board-line casino-win-line" title={`${w.name} · ${w.hand}`}>
        <span className="win-name">{w.name}</span>
        <span className="win-hand">· {w.hand}</span>
      </div>
      <span className="card-row casino-win-row">
        {w.cards.map((c) => (
          <PlayingCard key={c} card={c} size="small" />
        ))}
      </span>
    </>
  )
}

// Строка шансов стола (#137): одна строка подписи — имена сжимаются многоточием, проценты и «ещё N» — нет.
// Кнопка (#142): касание раскрывает список столбиком — все ненулевые шансы, полные имена; ещё касание сворачивает
function ChanceLine({ top, more, all, expanded, onToggle }: Chances) {
  if (expanded)
    return (
      <button
        type="button"
        className="casino-odds-toggle"
        aria-expanded
        title="Шансы стола — свернуть"
        onClick={onToggle}
      >
        <span className="odds-list">
          {all.map((c, i) => (
            <span key={i} className="odds-row">
              <span className="odds-full">{c.name}</span> — <span className="odds-pct">{`${c.percent} %`}</span>
            </span>
          ))}
        </span>
      </button>
    )
  return (
    <button
      type="button"
      className="casino-odds-toggle casino-board-line casino-odds"
      aria-expanded={false}
      disabled={top.length === 0}
      title="Шансы стола — раскрыть"
      onClick={onToggle}
    >
      {top.map((c, i) => (
        <span key={i} className="odds-item">
          <span className="odds-name">{c.name}</span>
          <span className="odds-pct">{`${c.percent} %`}</span>
        </span>
      ))}
      {more > 0 && <span className="odds-more">ещё {more}</span>}
      {top.length > 0 && (
        <span className="odds-more" aria-hidden="true">
          ▾
        </span>
      )}
      {top.length === 0 && ' '}
    </button>
  )
}

// Место: имя, карты лицом; победитель последнего открытого стола — рамка и подпись руки.
// С шансами (#137) вместо подписи руки — ожидаемый итог раунда («≈ +45 ₽»), рука — в подсказке; все столы
// открыты — итог точный, как в «Итоге раунда». index — номер места по часовой: по нему карты места в анимации раздачи
function Seat({ seat, index }: { seat: SeatData; index: number }) {
  const net = seat.net
  const estimate = net === undefined ? 0 : seat.exact ? net : Math.round(net / 100) * 100
  return (
    <div className={seat.win ? 'casino-seat winner' : 'casino-seat'}>
      <span className="seat-name">{seat.name}</span>
      <span className="card-row casino-hand">
        {seat.cards.map((c, i) => (
          <PlayingCard key={i} card={c} fly={flyKey(seatGroup(index), i)} />
        ))}
      </span>
      {net === undefined ? (
        <span className="seat-mark" title={seat.win ?? undefined}>
          {seat.win ?? ' '}
        </span>
      ) : (
        <span
          className={'seat-mark seat-net ' + (estimate > 0 ? 'plus' : estimate < 0 ? 'minus' : '')}
          title={seat.win ?? undefined}
        >
          {(seat.exact ? '' : '≈ ') + formatRub(estimate, true)}
        </span>
      )}
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
  const wide = useWide()
  const back = Array.from({ length: DEAL_KINDS[kind].hand }, () => null)
  const parts = tableParts(stake * ids.length, tables)
  return (
    <Felt
      layout={casinoLayout(kind, ids.length, tables, wide)}
      look={look}
      seats={ids.map((pid) => ({ id: pid, name: nameById.get(pid) ?? '?', cards: back, win: null }))}
      boards={parts.map((part) => ({
        cards: Array.from({ length: BOARD_CARDS }, () => null),
        part,
        open: false,
        last: false,
        winners: [],
        win: [],
      }))}
    />
  )
}

// После раздачи: у мест карты лицом, столы рубашкой до «Открыть стол» или своего срока (#134).
// Открывающийся стол (flipping) — shown карт лицом слева, остальные рубашкой; победитель — после последней
function CasinoTable(props: {
  dealt: Dealt
  opened: number
  shown: number
  flipping: boolean
  odds: CasinoOdds | null // шансы выключены или ещё не посчитаны — null (#137)
  nameById: Map<string, string>
  look: Look
}) {
  const { dealt, opened, shown, flipping, odds, nameById, look } = props
  const { deal, results, stake, fly } = dealt
  const wide = useWide()
  const name = (pid: string) => nameById.get(pid) ?? '?'
  const parts = tableParts(stake * deal.ids.length, deal.boards.length)
  const current = opened > 0 && !flipping ? results[opened - 1] : null
  const exact = opened >= deal.boards.length && !flipping
  // Раскрытые строки шансов (#142) — только у этой раздачи: «Ещё раунд» — всё свёрнуто; не помнится
  const [unfolded, setUnfolded] = useState<{ deal: Deal; boards: number[] }>({ deal, boards: [] })
  const expanded = unfolded.deal === deal ? unfolded.boards : []
  const toggle = (t: number) =>
    setUnfolded({ deal, boards: expanded.includes(t) ? expanded.filter((b) => b !== t) : [...expanded, t] })
  const chancesOf = (t: number): Chances => {
    const shares = odds?.boards[t] ?? []
    const named = (list: { id: string; percent: number }[]) => list.map((c) => ({ name: name(c.id), percent: c.percent }))
    const { top, more } = topOdds(deal.ids, shares)
    return {
      top: named(top),
      more,
      all: named(topOdds(deal.ids, shares, deal.ids.length).top),
      expanded: expanded.includes(t),
      onToggle: () => toggle(t),
    }
  }
  return (
    <Felt
      layout={casinoLayout(deal.kind, deal.ids.length, deal.boards.length, wide)}
      look={look}
      fly={fly}
      seats={deal.ids.map((pid, p) => ({
        id: pid,
        name: name(pid),
        cards: deal.hands[pid],
        win: current?.winners.includes(pid) ? current.hand : null,
        ...(odds && { net: odds.net[p], exact }),
      }))}
      boards={deal.boards.map((board, i) => {
        const turn = flipping && i === opened - 1
        const open = i < opened && !turn // открыт целиком
        const r = results[i]
        return {
          cards: open ? board : turn ? board.map((c, k) => (k < shown ? c : null)) : board.map(() => null),
          part: parts[i],
          open,
          turn,
          last: open && i === opened - 1,
          // У каждого открытого стола — его победители (Р-50), а не только у последнего
          winners: open ? r.winners.map((pid) => ({ name: name(pid), hand: r.hand, cards: r.best[pid] })) : [],
          win: open ? r.winners.flatMap((pid) => r.best[pid]) : [],
          ...(odds && !open && { chances: chancesOf(i) }),
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
