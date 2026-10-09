import { useEffect, useState } from 'react'
import { balance, playerTotals } from '../calc/totals'
import { formatNumber, formatRate, parseRate } from '../calc/format'
import type { Game } from '../model'
import { getSettings, listGames, saveGame } from '../store/db'
import { formatDate, today } from '../dates'
import { ulid } from '../ulid'

function gameSummary(game: Game): string {
  const b = balance(playerTotals(game.players, game.entries, game.rate))
  const status = game.closed ? 'закрыта' : b.chipsIn === 0 ? 'записей нет' : b.ok ? 'сходится' : 'не сходится'
  return `${formatDate(game.date)} · игроков ${game.players.length} · закуплено ${formatNumber(b.chipsIn)} · ${status}`
}

export function GamesScreen() {
  const [games, setGames] = useState<Game[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [rateText, setRateText] = useState('')

  useEffect(() => {
    void listGames().then(setGames)
  }, [])

  async function openForm() {
    const settings = await getSettings()
    setName(formatDate(today()))
    setRateText(formatRate(settings.defaultRate))
    setCreating(true)
  }

  const rate = parseRate(rateText)

  async function create() {
    if (rate === null) return
    const date = today()
    const game: Game = {
      id: ulid(),
      name: name.trim() || formatDate(date),
      date,
      rate,
      players: [],
      entries: [],
      updatedAt: new Date().toISOString(),
    }
    await saveGame(game)
    location.hash = `#/game/${game.id}`
  }

  return (
    <main className="screen">
      <header className="bar">
        <h1>Фишки</h1>
        <a className="bar-link" href="#/settings">
          Настройки
        </a>
      </header>

      {creating ? (
        <section className="card">
          <h2>Новая игра</h2>
          <label className="field">
            Название
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            Курс, ₽ за фишку
            <input inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} />
          </label>
          {rate === null && <p className="warn">Курс — число больше нуля, например 0,5</p>}
          <div className="row">
            <button className="big primary" disabled={rate === null} onClick={() => void create()}>
              Создать
            </button>
            <button className="big" onClick={() => setCreating(false)}>
              Отмена
            </button>
          </div>
        </section>
      ) : (
        <button className="big primary wide" onClick={() => void openForm()}>
          Новая игра
        </button>
      )}

      {games?.length === 0 && <p className="muted center">Игр пока нет</p>}
      <ul className="list">
        {games?.map((g) => (
          <li key={g.id}>
            <a className="card game-link" href={`#/game/${g.id}`}>
              <strong>{g.name}</strong>
              <span className="muted">{gameSummary(g)}</span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}
