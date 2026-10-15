import { useEffect, useState } from 'react'
import { formatChips, formatNumber, formatRub, formatTenths } from '../calc/format'
import { basisText, rebuysPerGame, regularStats, type Evening, type RegularStat, type Stats } from '../calc/stats'
import { formatDate } from '../dates'
import { getSettings, listGames } from '../store/db'

export const sign = (n: number) => (n > 0 ? 'plus' : n < 0 ? 'minus' : '')

// «+500 ₽ — 1 сентября 2026, Пятница»
function eveningText(e: Evening): string {
  return `${formatRub(e.kopecks, true)} — ${formatDate(e.date)}, ${e.name}`
}

// Итоги за всё время — в списке и в карточке игрока
export function StatBody({ stat }: { stat: RegularStat }) {
  if (stat.games === 0) {
    return (
      <div className="player-head">
        <strong>{stat.name}</strong>
        <span className="muted">игр нет</span>
      </div>
    )
  }
  return (
    <>
      <div className="player-head">
        <strong>{stat.name}</strong>
        <span className={sign(stat.kopecks)}>{formatRub(stat.kopecks, true)}</span>
      </div>
      {/* Три итога (Р-13); в шапке — итого */}
      <p className="muted">
        покер {formatRub(stat.poker, true)} ({formatChips(stat.chips, true)} в фишках) · казино{' '}
        {formatRub(stat.casino, true)} · итого {formatRub(stat.kopecks, true)}
      </p>
      <p className="muted">
        игр {formatNumber(stat.games)}, в плюсе {formatNumber(stat.wins)}
      </p>
      {stat.best && <p>Лучший вечер: {eveningText(stat.best)}</p>}
      {stat.worst && <p>Худший вечер: {eveningText(stat.worst)}</p>}
      <p className="muted">
        докупов {formatNumber(stat.rebuys)}, в среднем {formatTenths(rebuysPerGame(stat))} за игру
      </p>
    </>
  )
}

// Касание — карточка игрока с динамикой
function StatCard({ stat }: { stat: RegularStat }) {
  return (
    <li>
      <a className="card player game-link" href={`#/players/${encodeURIComponent(stat.regularId)}`}>
        <StatBody stat={stat} />
      </a>
    </li>
  )
}

export function PlayersScreen() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    void Promise.all([getSettings(), listGames()]).then(([settings, games]) =>
      setStats(regularStats(settings.players, games)),
    )
  }, [])

  return (
    <main className="screen">
      <header className="bar">
        <a className="bar-link" href="#/">
          ← Игры
        </a>
      </header>
      <h1>Игроки</h1>

      {stats !== null &&
        (stats.closedGames === 0 ? (
          <p className="muted center">Закрытых игр пока нет</p>
        ) : (
          <>
            <p className="muted">{basisText(stats)} — открытые в статистику не входят</p>
            {stats.rows.length === 0 && (
              <p className="muted center">Постоянных игроков нет — их добавляют в настройках</p>
            )}
            <ul className="list">
              {stats.rows.map((s) => (
                <StatCard key={s.regularId} stat={s} />
              ))}
            </ul>
          </>
        ))}
    </main>
  )
}
