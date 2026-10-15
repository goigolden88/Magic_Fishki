import { useEffect, useState, type ReactNode } from 'react'
import { formatNumber, formatRub, formatTenths } from '../calc/format'
import { regularStats, type RegularStat } from '../calc/stats'
import {
  WINDOW,
  averageKopecks,
  change,
  playerTrend,
  rebuysAverage,
  windowTitle,
  type Change,
  type GameWindow,
  type Trend,
} from '../calc/trend'
import { getSettings, listGames } from '../store/db'
import { StatBody, sign } from './Players'

// Строка разницы: «▲ +500 ₽», «▼ −0,4», «без изменений»
function Diff({ text, verdict }: { text: string; verdict: Change }) {
  if (verdict === 'same') return <span className="diff muted">без изменений</span>
  const better = verdict === 'better'
  return <span className={`diff ${better ? 'plus' : 'minus'}`}>{`${better ? '▲' : '▼'} ${text}`}</span>
}

// «+1», «−2», а приведённое к 5 играм — «+2,5»
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

// Последние 5 игр рядом с предыдущими; под последними — разница
function TrendCard({ trend }: { trend: Trend }) {
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
      {previous === null && <p className="muted">Для сравнения нужно больше {WINDOW} игр</p>}
      {previous !== null && previous.games < WINDOW && (
        <p className="muted">
          Предыдущих игр меньше {WINDOW} — сравнение по средним: итог и «в плюсе» приведены к {WINDOW} играм
        </p>
      )}
    </section>
  )
}

export function PlayerScreen({ id }: { id: string }) {
  // undefined — грузится, null — такого постоянного нет
  const [data, setData] = useState<{ stat: RegularStat; trend: Trend } | null | undefined>(undefined)

  useEffect(() => {
    void Promise.all([getSettings(), listGames()]).then(([settings, games]) => {
      const stat = regularStats(settings.players, games).rows.find((r) => r.regularId === id)
      setData(stat ? { stat, trend: playerTrend(id, games) } : null)
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
          {data.stat.games > 0 && <TrendCard trend={data.trend} />}
        </>
      )}
    </main>
  )
}
