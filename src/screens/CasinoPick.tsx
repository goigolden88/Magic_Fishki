import { useEffect, useState } from 'react'
import { allPicked, toggleAll } from '../calc/pick'
import { createGame, type Game, type Regular } from '../model'
import { formatDate, today } from '../dates'
import { getSettings, listGames, saveGame } from '../store/db'
import { ulid } from '../ulid'
import { openGameYear } from './openYears'

const dealHash = (id: string) => `#/game/${encodeURIComponent(id)}/deal`

// «Играть» → «Казино» (#129): куда писать раунды — открытая игра или новая «только казино»
// из отмеченных постоянных (Р-29; гости — именами в раунде, Р-13). Дальше — казино-стол игры
export function CasinoPickCard({ onCancel }: { onCancel: () => void }) {
  const [games, setGames] = useState<Game[] | null>(null)
  const [regulars, setRegulars] = useState<Regular[]>([])
  const [rate, setRate] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void Promise.all([listGames(), getSettings()]).then(([all, s]) => {
      setGames(all.filter((g) => !g.closed))
      setRegulars(s.players)
      setRate(s.defaultRate)
      setPicked(new Set(s.players.map((r) => r.id)))
    })
  }, [])

  function toggle(id: string) {
    const next = new Set(picked)
    if (!next.delete(id)) next.add(id)
    setPicked(next)
  }

  async function start() {
    setBusy(true)
    try {
      const date = today()
      const game = createGame(
        {
          name: formatDate(date),
          date,
          rate,
          players: regulars.filter((r) => picked.has(r.id)),
          buyin: null,
          mode: 'casino',
          now: new Date().toISOString(),
        },
        () => ulid(),
      )
      await saveGame(game)
      openGameYear(date)
      location.hash = dealHash(game.id)
    } catch {
      setError('Не удалось создать игру — попробуйте ещё раз')
      setBusy(false)
    }
  }

  if (games === null) return null
  const regularIds = regulars.map((r) => r.id)

  if (creating) {
    return (
      <section className="card">
        <h2>Новая игра — только казино</h2>
        <p className="muted">Сегодняшняя дата, без курса и закупа. Гостя можно добавить на экране игры.</p>
        {regulars.length > 0 ? (
          <fieldset className="players-pick">
            <legend className="muted">
              Участники: {picked.size} из {regulars.length}
            </legend>
            <button type="button" className="big wide" onClick={() => setPicked(toggleAll(regularIds, picked))}>
              {allPicked(regularIds, picked) ? 'Снять все' : 'Выбрать всех'}
            </button>
            {regulars.map((r) => (
              <label key={r.id} className="check">
                <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
                {r.name}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="muted">Постоянных игроков нет — добавьте их в «Настройках» или участников на экране игры.</p>
        )}
        {error && <p className="warn">{error}</p>}
        <div className="row">
          <button type="button" className="big primary grow" disabled={busy} onClick={() => void start()}>
            Начать
          </button>
          <button type="button" className="big" onClick={() => setCreating(false)}>
            Назад
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="card">
      <h2>Казино</h2>
      <p className="muted">Куда писать раунды: карты раздаёт этот телефон, всё в открытую, без сети.</p>
      {games.length > 0 && (
        <ul className="list">
          {games.map((g) => (
            <li key={g.id}>
              <a className="big wide button-link casino-game" href={dealHash(g.id)}>
                <span>{g.name}</span>
                <span className="muted">{formatDate(g.date)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="big primary wide" onClick={() => setCreating(true)}>
        Новая игра — только казино
      </button>
      <button type="button" className="big wide" onClick={onCancel}>
        Отмена
      </button>
    </section>
  )
}
