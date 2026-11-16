import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Card } from '../poker/cards'
import { deckOf, suitClass } from '../calc/pokerLook'
import { cardFace } from '../calc/pokerView'
import { CLASSES, emptyRange, parseRange, RANGE_EXAMPLE, rangeText } from '../calc/rangeText'
import { TRAINER_PATH, type TrainerStart } from '../calc/trainerFromHand'
import {
  BOARD_MAX,
  HAND_CARDS,
  pickCard,
  rangeSizeText,
  runsText,
  shareText,
  takenCards,
  TRAINER_DECK,
  TRAINER_SIDES_MAX,
  TRAINER_SIDES_MIN,
  TRAINER_WEIGHTS,
  trainerInput,
  weightLabel,
  winTieText,
  type SideMode,
  type TrainerSide,
} from '../calc/trainerView'
import { loadMyLook } from './pokerStorage'
import { PlayingCard } from './PokerRoom'
import { useTrainerOdds } from './trainerOddsClient'

export const TRAINER_HASH = `#${TRAINER_PATH}`

// Сторона экрана: к руке и диапазону — номер (ключ и выбор карт), текст диапазона, его ошибка и вес касания
type Side = TrainerSide & { id: number; text: string; error: string | null; weight: number }

let nextId = 1
const newSide = (): Side => ({ id: nextId++, mode: 'hand', cards: [], range: emptyRange(), text: '', error: null, weight: TRAINER_WEIGHTS[0] })
// Сторона раздачи из истории (#221): карты известны — «Рука», нет — «Диапазон» с пустой сеткой
const sideOf = (cards: Card[] | null): Side => (cards ? { ...newSide(), cards } : { ...newSide(), mode: 'range' })

// Вкладки вверху (#214): сначала «Калькулятор»
type Tab = 'calc' | 'charts'
const TABS: { id: Tab; label: string }[] = [
  { id: 'calc', label: 'Калькулятор' },
  { id: 'charts', label: 'Чарты' },
]
// Вкладка «Чарты» с данными — отдельный файл сборки: грузится при первом открытии (кеш PWA — без сети)
type ChartsModule = typeof import('./TrainerCharts')

// «Тренажёр» (#213, Р-73): калькулятор эквити — 2…6 сторон (рука или диапазон на сетке 13 × 13) и борд;
// счёт — в фоне (useTrainerOdds). Ввод живёт, пока открыт экран: не хранится, при возврате — с чистого листа.
// Вкладки (#214, Р-76): «Калькулятор» и «Чарты»; переключение ввод вкладок не стирает.
// start — стороны и борд раздачи из истории (#221, из адреса): только начальный ввод, правка адрес не меняет
export function TrainerScreen({ start = null }: { start?: TrainerStart | null }) {
  const [tab, setTab] = useState<Tab>('calc')
  const [charts, setCharts] = useState<ChartsModule | 'loading' | 'failed' | null>(null)
  const [sides, setSides] = useState<Side[]>(() => (start ? start.sides.map(sideOf) : [newSide(), newSide()]))
  const [board, setBoard] = useState<Card[]>(() => start?.board ?? [])
  const [open, setOpen] = useState<number | 'board' | null>(null) // чья колода открыта: сторона (id) или борд
  const input = useMemo(() => trainerInput(sides, board), [sides, board])
  const odds = useTrainerOdds('sides' in input ? input.sides : null, board)

  function openTab(next: Tab) {
    setTab(next)
    if (next !== 'charts' || (charts !== null && charts !== 'failed')) return
    setCharts('loading')
    import('./TrainerCharts').then(
      (m) => setCharts(m),
      () => setCharts('failed'),
    )
  }

  const change = (id: number, make: (s: Side) => Side) => setSides((all) => all.map((s) => (s.id === id ? make(s) : s)))

  function remove(id: number) {
    setSides((all) => all.filter((s) => s.id !== id))
    if (open === id) setOpen(null)
  }

  function pickHand(side: Side, card: Card) {
    const cards = pickCard(side.cards, card, HAND_CARDS)
    change(side.id, (s) => ({ ...s, cards }))
    if (cards.length === HAND_CARDS) setOpen(null)
  }

  function pickBoard(card: Card) {
    const next = pickCard(board, card, BOARD_MAX)
    setBoard(next)
    if (next.length === BOARD_MAX) setOpen(null)
  }

  // Итог: причина входа, причина счёта или доли; пока считает — прошлый итог приглушён, если сторон столько же
  const reason = 'reason' in input ? input.reason : odds.result && !odds.result.ok && !odds.counting ? odds.result.reason : null
  const shown = !reason && odds.result?.ok && odds.result.sides.length === sides.length ? odds.result : null
  const status = reason ?? (odds.counting ? 'Считаем…' : shown ? runsText(shown, board.length) : '')

  return (
    <main className="screen trainer">
      <header className="bar">
        <a className="bar-link" href="#/poker">
          ← Играть
        </a>
        <a className="bar-link" href="#/help" aria-label="Справка">
          ?
        </a>
      </header>
      <h1>Тренажёр</h1>
      <div className="row trainer-tabs" role="group" aria-label="Тренажёр">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'big primary grow' : 'big grow'} aria-pressed={tab === t.id} onClick={() => openTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div hidden={tab !== 'charts'}>
        {charts === 'loading' && <p className="muted">Загружаем чарты…</p>}
        {charts === 'failed' && (
          <p className="warn" role="alert">
            Чарты не загрузились. Откройте сайт со связью — дальше они откроются и без сети.
          </p>
        )}
        {charts !== null && typeof charts === 'object' && <charts.TrainerCharts />}
      </div>

      <div hidden={tab !== 'calc'}>
      <p className="muted lead">Сколько банка в среднем берёт каждая сторона: рука или диапазон, борд — до пяти карт. Только холдем.</p>

      <section className="card trainer-board">
        <h2>Борд</h2>
        <div className="trainer-cards">
          <button type="button" className="card-slots" aria-expanded={open === 'board'} onClick={() => setOpen(open === 'board' ? null : 'board')}>
            <Slots cards={board} count={BOARD_MAX} />
            <span className="slots-hint">{open === 'board' ? 'Готово' : board.length === 0 ? 'Выбрать борд' : 'Поменять'}</span>
          </button>
          {board.length > 0 && (
            <button type="button" className="big" onClick={() => setBoard([])}>
              Очистить борд
            </button>
          )}
        </div>
        {open === 'board' && <Deck picked={board} taken={takenCards(sides, board, 'board')} onPick={pickBoard} />}
      </section>

      <p className={reason ? 'warn trainer-status' : 'muted trainer-status'} role="status">
        {status}
      </p>

      <div className="trainer-sides">
        {sides.map((side, i) => {
          const share = shown?.sides[i]
          return (
            <section key={side.id} className="card trainer-side">
              <div className="side-head">
                <h2>Сторона {i + 1}</h2>
                {sides.length > TRAINER_SIDES_MIN && (
                  <button type="button" className="link" onClick={() => remove(side.id)}>
                    Убрать
                  </button>
                )}
              </div>
              {!reason && (
                <div className={odds.counting ? 'side-result counting' : 'side-result'}>
                  <p className="side-share">{share ? shareText(share.share) : '—'}</p>
                  <p className="side-wintie">{share ? winTieText(share.win, share.tie) : ' '}</p>
                </div>
              )}
              <div className="row">
                {(['hand', 'range'] as SideMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={side.mode === mode ? 'big primary grow' : 'big grow'}
                    aria-pressed={side.mode === mode}
                    onClick={() => {
                      change(side.id, (s) => ({ ...s, mode }))
                      if (open === side.id) setOpen(null)
                    }}
                  >
                    {mode === 'hand' ? 'Рука' : 'Диапазон'}
                  </button>
                ))}
              </div>
              {side.mode === 'hand' ? (
                <>
                  <div className="trainer-cards">
                    <button
                      type="button"
                      className="card-slots"
                      aria-expanded={open === side.id}
                      onClick={() => setOpen(open === side.id ? null : side.id)}
                    >
                      <Slots cards={side.cards} count={HAND_CARDS} />
                      <span className="slots-hint">{open === side.id ? 'Готово' : side.cards.length === 0 ? 'Выбрать карты' : 'Поменять'}</span>
                    </button>
                  </div>
                  {open === side.id && <Deck picked={side.cards} taken={takenCards(sides, board, i)} onPick={(c) => pickHand(side, c)} />}
                </>
              ) : (
                <RangeEditor side={side} onChange={(make) => change(side.id, make)} />
              )}
            </section>
          )
        })}
      </div>

      {sides.length < TRAINER_SIDES_MAX && (
        <button type="button" className="big wide" onClick={() => setSides((all) => [...all, newSide()])}>
          Добавить сторону
        </button>
      )}
      </div>
    </main>
  )
}

// Места под карты: выбранные лицом, пустые — пунктиром
function Slots({ cards, count }: { cards: Card[]; count: number }) {
  return (
    <span className="card-row slots">
      {Array.from({ length: count }, (_, k) =>
        cards[k] ? <PlayingCard key={k} card={cards[k]} size="mid" /> : <span key={k} className="slot-empty" aria-hidden="true" />,
      )}
    </span>
  )
}

// Колода 52 карт касаниями: ряд — масть; занятая другой стороной или бордом — недоступна
function Deck({ picked, taken, onPick }: { picked: Card[]; taken: Set<Card>; onPick: (card: Card) => void }) {
  const deck = deckOf(loadMyLook())
  return (
    <div className="deck" role="group" aria-label="Колода">
      {TRAINER_DECK.flat().map((card) => {
        const f = cardFace(card)
        const on = picked.includes(card)
        return (
          <button
            key={card}
            type="button"
            className={`playing-card deck-card ${suitClass(card, deck)}`}
            data-card={card}
            aria-pressed={on}
            disabled={!on && taken.has(card)}
            onClick={() => onPick(card)}
          >
            <span>{f.rank}</span>
            <span>{f.suit}</span>
          </button>
        )
      })}
    </div>
  )
}

// Диапазон: вес касания, сетка 13 × 13 (касание и проведение пальцем ставят вес), размер, текст и «Очистить»
function RangeEditor({ side, onChange }: { side: Side; onChange: (make: (s: Side) => Side) => void }) {
  const grid = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null) // палец или мышь, что красит
  const last = useRef(-1) // клетка, покрашенная последней в этом проведении

  // Правка сетки — новый текст; ошибки текста больше нет
  const paint = (cell: number) =>
    onChange((s) => {
      if (s.range[cell] === s.weight && s.error === null) return s
      const range = s.range.map((w, k) => (k === cell ? s.weight : w))
      return { ...s, range, text: rangeText(range), error: null }
    })

  function cellAt(x: number, y: number): number {
    const el = document.elementFromPoint(x, y)
    const cell = el instanceof HTMLElement ? el.closest<HTMLElement>('[data-cell]') : null
    return cell && grid.current?.contains(cell) ? Number(cell.dataset.cell) : -1
  }

  function down(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const cell = cellAt(e.clientX, e.clientY)
    if (cell < 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = e.pointerId
    last.current = cell
    paint(cell)
  }

  function move(e: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current !== e.pointerId) return
    const cell = cellAt(e.clientX, e.clientY)
    if (cell < 0 || cell === last.current) return
    last.current = cell
    paint(cell)
  }

  const stop = () => {
    drag.current = null
    last.current = -1
  }

  // Ввод текста — сетка; не разобрать — сетка прежняя, ошибка строкой
  function typed(text: string) {
    const parsed = parseRange(text)
    onChange((s) => ('weights' in parsed ? { ...s, text, range: parsed.weights, error: null } : { ...s, text, error: parsed.error }))
  }

  return (
    <div className="range-editor">
      <div className="weights" role="group" aria-label="Вес касания">
        {TRAINER_WEIGHTS.map((w) => (
          <button
            key={w}
            type="button"
            className={side.weight === w ? 'primary' : ''}
            aria-pressed={side.weight === w}
            onClick={() => onChange((s) => ({ ...s, weight: w }))}
          >
            {weightLabel(w)}
          </button>
        ))}
      </div>
      <div
        ref={grid}
        className="range-grid"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
      >
        {CLASSES.map((cls, k) => {
          const w = side.range[k]
          const kind = cls.length === 2 ? 'pair' : cls.endsWith('s') ? 'suited' : 'offsuit'
          return (
            <button
              key={cls}
              type="button"
              data-cell={k}
              className={`range-cell ${kind}${w >= 1 ? ' on' : w > 0 ? ' part' : ''}`}
              style={{ '--w': w } as CSSProperties}
              aria-label={`${cls}, ${weightLabel(w)}`}
              // Касание и проведение — в down/move; Enter и пробел с клавиатуры (detail 0) — здесь
              onClick={(e) => e.detail === 0 && paint(k)}
            >
              <span>{cls}</span>
            </button>
          )
        })}
      </div>
      <p className="range-size">{rangeSizeText(side.range)}</p>
      <label className="field">
        Диапазон текстом
        <input
          className="range-text"
          value={side.text}
          onChange={(e) => typed(e.target.value)}
          placeholder={RANGE_EXAMPLE}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {side.error && <p className="warn">{side.error}</p>}
      <button
        type="button"
        className="big"
        disabled={!side.range.some((w) => w > 0) && side.text === ''}
        onClick={() => onChange((s) => ({ ...s, range: emptyRange(), text: '', error: null }))}
      >
        Очистить
      </button>
    </div>
  )
}
