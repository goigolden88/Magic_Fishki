import { useEffect, useMemo, useState } from 'react'
import { formatChips, formatNumber, formatRub, formatTenths } from '../calc/format'
import { hasDemo } from '../calc/demo'
import { statsShareText } from '../calc/share'
import {
  basisText,
  defaultPeriod,
  rebuysPerGame,
  regularStats,
  statsYears,
  type Evening,
  type Period,
  type RegularStat,
  type Stats,
} from '../calc/stats'
import { formatDate } from '../dates'
import type { Game, Regular } from '../model'
import { getSettings, listGames } from '../store/db'
import { useRemoteVersion } from '../sync/instance'

export const sign = (n: number) => (n > 0 ? 'plus' : n < 0 ? 'minus' : '')

// «+500 ₽ — 1 сентября 2026, Пятница»
function eveningText(e: Evening): string {
  return `${formatRub(e.kopecks, true)} — ${formatDate(e.date)}, ${e.name}`
}

// Итоги — в списке за выбранный период (#328), в карточке игрока за всё время
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

// Выбранный период (#328, Р-120) — в памяти, пока приложение открыто: из карточки игрока назад — тот же;
// не хранится. undefined — не выбирали, берётся по умолчанию
let chosenPeriod: Period | undefined

// Переключатель периода: годы закрытых игр, новые слева, и «Всё время»
function PeriodPick({ years, period, onPick }: { years: number[]; period: Period; onPick: (p: Period) => void }) {
  const options: [Period, string][] = [...years.map((y): [Period, string] => [y, String(y)]), [null, 'Всё время']]
  return (
    <div className="row" role="group" aria-label="Период">
      {options.map(([value, label]) => (
        <button
          key={label}
          type="button"
          className={period === value ? 'big primary grow' : 'big grow'}
          aria-pressed={period === value}
          onClick={() => onPick(value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

type Loaded = { regulars: Regular[]; games: Game[] }

export function PlayersScreen() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [picked, setPicked] = useState<Period | undefined>(chosenPeriod)
  const [shareNote, setShareNote] = useState<string | null>(null) // «Скопировано» под кнопкой
  const remote = useRemoteVersion() // влитое с другого устройства (#265) — итоги перечитываются

  useEffect(() => {
    void Promise.all([getSettings(), listGames()]).then(([settings, games]) => {
      setLoaded({ regulars: settings.players, games })
    })
  }, [remote])

  const years = useMemo(() => (loaded ? statsYears(loaded.games) : []), [loaded])
  // Выбранный год пропал (игры удалили) — по умолчанию
  const period: Period =
    picked !== undefined && (picked === null || years.includes(picked))
      ? picked
      : defaultPeriod(years, new Date().getFullYear())
  const stats = useMemo(
    () => (loaded ? regularStats(loaded.regulars, loaded.games, period) : null),
    [loaded, period],
  )
  const demo = loaded !== null && hasDemo(loaded.games) // есть демо-игры — строка, что они не считаются (Р-04)

  function pick(p: Period) {
    chosenPeriod = p
    setPicked(p)
  }

  // Как «Поделиться итогом» в игре: системное «Поделиться»; где его нет — в буфер обмена
  async function share(stats: Stats) {
    const text = statsShareText(stats)
    if ('share' in navigator) {
      try {
        await navigator.share({ text })
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return // передумали
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      setShareNote('Скопировано')
    } catch {
      setShareNote('Не удалось скопировать')
    }
    setTimeout(() => setShareNote(null), 3000)
  }

  return (
    <main className="screen">
      <header className="bar">
        <a className="bar-link" href="#/">
          ← Игры
        </a>
      </header>
      <h1>Игроки</h1>
      {demo && <p className="muted">Демо-игры в статистику не входят</p>}

      {stats !== null &&
        (years.length === 0 ? (
          <p className="muted center">Закрытых игр пока нет</p>
        ) : (
          <>
            {years.length > 1 && <PeriodPick years={years} period={period} onPick={pick} />}
            {stats.closedGames === 0 ? (
              <p className="muted center">Закрытых игр в периоде нет</p>
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
                {stats.rows.some((s) => s.games > 0) && (
                  <>
                    <button className="big primary wide" onClick={() => void share(stats)}>
                      Поделиться статистикой
                    </button>
                    {shareNote && (
                      <p className={shareNote === 'Скопировано' ? 'ok center' : 'warn center'}>{shareNote}</p>
                    )}
                  </>
                )}
              </>
            )}
          </>
        ))}
    </main>
  )
}
