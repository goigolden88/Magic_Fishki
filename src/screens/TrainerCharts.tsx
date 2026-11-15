import { useMemo, useState, type CSSProperties } from 'react'
import {
  CHART_POSITIONS,
  chartLegend,
  chartSituations,
  combosText,
  handStripes,
  handText,
  reachedText,
  sharePercentText,
  TWELFTHS,
  unpackNode,
  type ChartHand,
  type ChartPosition,
} from '../calc/charts'
import { LEAKPROOF } from '../calc/chartsData'
import { CLASSES } from '../calc/rangeText'
import { CHARTS_GAME, CHARTS_ROUNDING } from '../calc/trainerView'

// Строка об источнике — дословно, как требует CC BY 4.0 (решение в #214); на экране рядом с чартами
export const CHARTS_SOURCE =
  'Preflop ranges: Leakproof 6max-100bb-norake 1.0.0 (https://github.com/a-hanamoto/leakproof-preflop-ranges), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)'

// Клетка: полосы долей действий слева направо, по высоте — доля сочетаний, что доходит до ситуации (снизу)
function cellStyle(hand: ChartHand | null, actions: string[]): CSSProperties | undefined {
  if (!hand) return undefined
  const stops = handStripes(hand, actions)
    .map((s) => `var(--act-${s.kind}) ${s.from}% ${s.to}%`)
    .join(', ')
  const height = (hand.reach * 100) / TWELFTHS
  return { background: `linear-gradient(to right, ${stops}) bottom / 100% ${height}% no-repeat, var(--chart-empty)` }
}

// Вкладка «Чарты» «Тренажёра» (#214, Р-76): набор Leakproof — модуль грузится при первом открытии вкладки
// (import() в Trainer.tsx), вместе с ним — данные chartsData. Выбор — состояние экрана, не хранится
export function TrainerCharts() {
  const [pos, setPos] = useState<ChartPosition>(CHART_POSITIONS[0])
  const situations = useMemo(() => chartSituations(LEAKPROOF, pos), [pos])
  const [picked, setPicked] = useState(situations[0].index)
  const [cell, setCell] = useState<number | null>(null)
  const index = situations.some((s) => s.index === picked) ? picked : situations[0].index
  const chart = useMemo(() => unpackNode(LEAKPROOF[index]), [index])
  const legend = useMemo(() => chartLegend(chart), [chart])

  function choosePos(p: ChartPosition) {
    setPos(p)
    setPicked(chartSituations(LEAKPROOF, p)[0].index)
  }

  return (
    <>
    <p className="muted lead">
      Префлоп {CHARTS_GAME}: как часто рука пасует, коллирует, рейзит и идёт олл-ин — по вашей позиции и тому, что было до вас.
    </p>
    <div className="charts">
      <section className="card chart-pick">
        <h2>Моя позиция</h2>
        <div className="chart-positions" role="group" aria-label="Моя позиция">
          {CHART_POSITIONS.map((p) => (
            <button key={p} type="button" className={p === pos ? 'big primary' : 'big'} aria-pressed={p === pos} onClick={() => choosePos(p)}>
              {p}
            </button>
          ))}
        </div>
        <h2>Что было до меня</h2>
        <div className="chart-situations" role="group" aria-label="Что было до меня">
          {situations.map((s) => (
            <button
              key={s.index}
              type="button"
              className={s.index === index ? 'big primary' : 'big'}
              aria-pressed={s.index === index}
              onClick={() => setPicked(s.index)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="muted chart-note">Нет лимпа SB, холодного колла 3-бета, сквиза и раздач втроём.</p>
      </section>

      <section className="card chart-view">
        <h2>
          {pos}: {situations.find((s) => s.index === index)?.label}
        </h2>
        <div className="chart-grid" role="group" aria-label="Чарт: руки по клеткам">
          {CLASSES.map((cls, k) => {
            const hand = chart.hands[k]
            return (
              <button
                key={cls}
                type="button"
                className={hand ? 'chart-cell' : 'chart-cell empty'}
                style={cellStyle(hand, chart.actions)}
                aria-pressed={cell === k}
                aria-label={handText(cls, hand, chart.actions)}
                onClick={() => setCell(cell === k ? null : k)}
              >
                <span>{cls}</span>
              </button>
            )
          })}
        </div>
        <p className="chart-hand" role="status">
          {cell === null ? 'Коснитесь клетки — доли руки' : handText(CLASSES[cell], chart.hands[cell], chart.actions)}
        </p>
        <p className="muted chart-reached">{reachedText(legend.reached)}</p>
        <ul className="chart-legend">
          {legend.rows.map((row) => (
            <li key={row.label}>
              <span className={`chart-swatch act-${row.kind}`} aria-hidden="true" />
              <span className="chart-action">{row.label}</span>
              <span className="chart-share">{sharePercentText(row.share)}</span>
              <span className="chart-combos">{combosText(row.combos)}</span>
            </li>
          ))}
        </ul>
        <p className="muted chart-note">Приближение, без рейка, {CHARTS_ROUNDING}, преобразовано в свой формат.</p>
        <p className="muted chart-note chart-source" lang="en">
          {CHARTS_SOURCE}
        </p>
      </section>
    </div>
    </>
  )
}
