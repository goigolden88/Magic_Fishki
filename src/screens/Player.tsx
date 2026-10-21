import { useEffect, useState, type ReactNode } from 'react'
import { formatNumber, formatRub, formatTenths } from '../calc/format'
import { regularStats, type RegularStat } from '../calc/stats'
import {
  averageKopecks,
  change,
  gamesWord,
  playerSpans,
  playerTrend,
  rebuysAverage,
  windowTitle,
  type Change,
  type GameWindow,
  type Span,
  type Spans,
  type Trend,
} from '../calc/trend'
import { formatDayMonth } from '../dates'
import { getSettings, listGames } from '../store/db'
import { StatBody, sign } from './Players'

// Строка разницы: «▲ +500 ₽», «▼ −0,4», «без изменений»
function Diff({ text, verdict }: { text: string; verdict: Change }) {
  if (verdict === 'same') return <span className="diff muted">без изменений</span>
  const better = verdict === 'better'
  return <span className={`diff ${better ? 'plus' : 'minus'}`}>{`${better ? '▲' : '▼'} ${text}`}</span>
}

// «+1», «−2», а приведённое к окну — «+2,5»
const winsText = (n: number) => (Number.isInteger(n) ? (n > 0 ? '+' : '') + formatNumber(n) : formatTenths(n, true))

type Metric = {
  label: string
  value: (w: GameWindow) => ReactNode
  diff: (t: Trend) => ReactNode
}

const METRICS: Metric[] = [
  {
    label: 'Итог',
    value: (w) => <span className={sign(w.kopecks)}>{formatRub(w.kopecks, true)}</span>,
    diff: ({ delta: d }) => d && <Diff text={formatRub(d.kopecks, true)} verdict={change(d.kopecks)} />,
  },
  {
    label: 'В плюсе',
    value: (w) => `${formatNumber(w.wins)} из ${formatNumber(w.games)}`,
    diff: ({ delta: d }) => d && <Diff text={winsText(d.wins)} verdict={change(d.wins)} />,
  },
  {
    label: 'Средний итог за игру',
    value: (w) => <span className={sign(averageKopecks(w))}>{formatRub(averageKopecks(w), true)}</span>,
    diff: ({ delta: d }) => d && <Diff text={formatRub(d.average, true)} verdict={change(d.average)} />,
  },
  {
    label: 'Докупов в среднем за игру',
    value: (w) => formatTenths(rebuysAverage(w)),
    diff: ({ delta: d }) => d && <Diff text={formatTenths(d.rebuys, true)} verdict={change(d.rebuys, true)} />,
  },
]

// Последние игры рядом с предыдущими, по окну сравнения; под последними — разница
function TrendCard({ trend, size }: { trend: Trend; size: number }) {
  const { recent, previous } = trend
  if (recent === null) return null
  return (
    <section className="card trend">
      <table className="windows">
        <thead>
          <tr>
            <th>{windowTitle('recent', recent.games)}</th>
            {previous && <th>{windowTitle('previous', previous.games)}</th>}
          </tr>
        </thead>
        {METRICS.map((m) => (
          <tbody key={m.label}>
            <tr>
              <th className="label" colSpan={previous ? 2 : 1}>
                {m.label}
              </th>
            </tr>
            <tr>
              <td>
                {m.value(recent)}
                {m.diff(trend)}
              </td>
              {previous && <td>{m.value(previous)}</td>}
            </tr>
          </tbody>
        ))}
      </table>
      {previous === null && <p className="muted">Для сравнения нужно больше {size} игр</p>}
      {previous !== null && previous.games < size && (
        <p className="muted">
          Предыдущих игр меньше {size} — сравнение по средним: итог и «в плюсе» приведены к {size} играм
        </p>
      )}
    </section>
  )
}

// «+1 500 ₽, 05.09–10.10»
function SpanText({ span }: { span: Span }) {
  return (
    <>
      <span className={sign(span.kopecks)}>{formatRub(span.kopecks, true)}</span>
      {`, ${formatDayMonth(span.from)}–${formatDayMonth(span.to)}`}
    </>
  )
}

// Лучший и худший промежуток — окно сравнения игр подряд (Р-15)
function SpansCard({ spans, size }: { spans: Spans; size: number }) {
  const { best, worst } = spans
  return (
    <section className="card spans">
      {best && worst ? (
        <>
          <p>
            Лучший промежуток: <SpanText span={best} /> ({size} {gamesWord(size)})
          </p>
          <p>
            Худший промежуток: <SpanText span={worst} />
          </p>
        </>
      ) : (
        <p className="muted">
          Лучший и худший промежуток по {size} {gamesWord(size)} подряд — когда закрытых игр будет {size * 2}, сейчас{' '}
          {spans.evenings}
        </p>
      )}
    </section>
  )
}

type Data = { stat: RegularStat; trend: Trend; spans: Spans; size: number }

export function PlayerScreen({ id }: { id: string }) {
  // undefined — грузится, null — такого постоянного нет
  const [data, setData] = useState<Data | null | undefined>(undefined)

  useEffect(() => {
    void Promise.all([getSettings(), listGames()]).then(([settings, games]) => {
      const stat = regularStats(settings.players, games).rows.find((r) => r.regularId === id)
      const size = settings.compareWindow
      setData(
        stat ? { stat, trend: playerTrend(id, games, size), spans: playerSpans(id, games, size), size } : null,
      )
    })
  }, [id])

  return (
    <main className="screen">
      <header className="bar">
        <a className="bar-link" href="#/players">
          ← Игроки
        </a>
      </header>

      {data === null && <p className="muted center">Игрок не найден — возможно, удалён в настройках</p>}
      {data && (
        <>
          <h1>{data.stat.name}</h1>
          <h2>За всё время</h2>
          <section className="card player">
            <StatBody stat={data.stat} />
          </section>
          {data.stat.games > 0 && <TrendCard trend={data.trend} size={data.size} />}
          {data.trend.recent !== null && <SpansCard spans={data.spans} size={data.size} />}
        </>
      )}
    </main>
  )
}
