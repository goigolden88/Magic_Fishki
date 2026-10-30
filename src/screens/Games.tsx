import { useEffect, useState } from 'react'
import { formatNumber, formatRate, parseRate } from '../calc/format'
import { defaultOpenYear, gameSummary, groupByYear, isYearOpen } from '../calc/gameList'
import { MODE_LABEL } from '../calc/gameMode'
import { allPicked, toggleAll } from '../calc/pick'
import { createGame, DEFAULT_BUYIN, DEFAULT_RATE, GAME_MODES, type Game, type GameMode, type Regular } from '../model'
import { getSettings, listGames, saveGame } from '../store/db'
import { formatDate, today } from '../dates'
import { ulid } from '../ulid'
import { loadOpenYears, openGameYear, saveOpenYears } from './openYears'
import { loadBotTable, loadLocalTable } from './pokerStorage'

export function GamesScreen() {
  const [games, setGames] = useState<Game[] | null>(null)
  const [openYears, setOpenYears] = useState<Record<string, boolean>>(loadOpenYears)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [rateText, setRateText] = useState('')
  const [mode, setMode] = useState<GameMode>('poker') // режим новой игры (Р-29)
  const [defaultRate, setDefaultRate] = useState(DEFAULT_RATE) // курс из настроек — у «только казино»
  const [regulars, setRegulars] = useState<Regular[]>([]) // постоянные игроки из настроек
  const [picked, setPicked] = useState<Set<string>>(new Set()) // id отмеченных — участники игры
  const [defaultBuyin, setDefaultBuyin] = useState(DEFAULT_BUYIN) // закуп по умолчанию из настроек (Р-09)
  const [askBuyin, setAskBuyin] = useState(false) // вопрос «Записать всем закуп?»
  const [recording, setRecording] = useState(false) // выбор «Записать игру»: вручную или из Телеграма
  // Стол с ботами или на этом телефоне идёт — напоминание под «Играть», чтобы не потерять его
  const [tableGoing] = useState(() => loadLocalTable() !== null || loadBotTable() !== null)

  useEffect(() => {
    void listGames().then(setGames)
  }, [])

  async function openForm() {
    const settings = await getSettings()
    setName(formatDate(today()))
    setRateText(formatRate(settings.defaultRate))
    setDefaultRate(settings.defaultRate)
    setMode('poker')
    setRegulars(settings.players)
    setPicked(new Set(settings.players.map((r) => r.id)))
    setDefaultBuyin(settings.defaultBuyin)
    setAskBuyin(false)
    setRecording(false)
    setCreating(true)
  }

  function toggle(id: string) {
    const next = new Set(picked)
    if (!next.delete(id)) next.add(id)
    setPicked(next)
  }

  const groups = groupByYear(games ?? [])
  const openByDefault = defaultOpenYear(groups, today().slice(0, 4))

  function toggleYear(year: string) {
    const next = { ...openYears, [year]: !isYearOpen(year, openYears, openByDefault) }
    setOpenYears(next)
    saveOpenYears(next)
  }

  // «Только казино» — курс из настроек: поля нет (Р-29)
  const rate = mode === 'casino' ? defaultRate : parseRate(rateText)

  const players = regulars.filter((r) => picked.has(r.id))
  const regularIds = regulars.map((r) => r.id)

  // Участники выбраны — сначала вопрос про закуп; нет участников или «только казино» — сразу игра без записей
  function startCreate() {
    if (rate === null) return
    if (players.length > 0 && mode !== 'casino') setAskBuyin(true)
    else void create(null)
  }

  async function create(buyin: number | null) {
    if (rate === null) return
    const date = today()
    const game = createGame(
      { name: name.trim() || formatDate(date), date, rate, players, buyin, mode, now: new Date().toISOString() },
      () => ulid(),
    )
    await saveGame(game)
    openGameYear(date)
    location.hash = `#/game/${game.id}`
  }

  return (
    <main className="screen">
      <header className="bar">
        <h1>Фишки</h1>
        <nav className="bar-links">
          <a className="bar-link" href="#/players">
            Игроки
          </a>
          <a className="bar-link" href="#/settings">
            Настройки
          </a>
          <a className="bar-link" href="#/help" aria-label="Справка">
            ?
          </a>
        </nav>
      </header>

      {creating && askBuyin ? (
        <section className="card">
          <h2>Записать всем закуп по {formatNumber(defaultBuyin)} фишек?</h2>
          <p className="muted">Участников: {players.length}. Сумма меняется в настройках.</p>
          <div className="row">
            <button className="big primary grow" onClick={() => void create(defaultBuyin)}>
              Да
            </button>
            <button className="big grow" onClick={() => void create(null)}>
              Нет
            </button>
          </div>
          <button className="big wide" onClick={() => setAskBuyin(false)}>
            Назад
          </button>
        </section>
      ) : creating ? (
        <section className="card">
          <h2>Новая игра</h2>
          <label className="field">
            Название
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {/* Р-29: режим игры; «Только казино» — без курса и без вопроса о закупе */}
          <fieldset className="players-pick">
            <legend className="muted">Режим</legend>
            {GAME_MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={mode === m ? 'big primary wide' : 'big wide'}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </fieldset>
          {mode !== 'casino' && (
            <>
              <label className="field">
                Курс, ₽ за фишку
                <input inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} />
              </label>
              {rate === null && <p className="warn">Курс — число больше нуля, например 0,5</p>}
            </>
          )}
          {regulars.length > 0 && (
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
              <p className="muted">Гостя можно добавить на экране игры.</p>
            </fieldset>
          )}
          <div className="row">
            <button className="big primary" disabled={rate === null} onClick={startCreate}>
              Создать
            </button>
            <button className="big" onClick={() => setCreating(false)}>
              Отмена
            </button>
          </div>
        </section>
      ) : recording ? (
        <section className="card">
          <h2>Записать игру</h2>
          <button className="big primary wide" onClick={() => void openForm()}>
            Вручную
          </button>
          <button className="big wide" onClick={() => (location.hash = '#/import')}>
            Из Телеграма
          </button>
          <button className="big wide" onClick={() => setRecording(false)}>
            Отмена
          </button>
        </section>
      ) : (
        <>
          {/* #126: две двери — «Играть» (экран покера) и «Записать игру» (учёт вечера) */}
          <button className="big primary wide" onClick={() => (location.hash = '#/poker')}>
            Играть
          </button>
          {tableGoing && <p className="muted">Идёт стол — продолжить в «Играть»</p>}
          <button className="big wide" onClick={() => setRecording(true)}>
            Записать игру
          </button>
        </>
      )}

      {games?.length === 0 && <p className="muted center">Игр пока нет</p>}
      {groups.map(({ year, games: yearGames }) => {
        const open = isYearOpen(year, openYears, openByDefault)
        return (
          <section key={year} className="year">
            <button className="year-head" aria-expanded={open} onClick={() => toggleYear(year)}>
              <span>
                {year} · игр {yearGames.length}
              </span>
              <span className="muted">{open ? '▾' : '▸'}</span>
            </button>
            {open && (
              <ul className="list">
                {yearGames.map((g) => (
                  <li key={g.id}>
                    <a className="card game-link" href={`#/game/${g.id}`}>
                      <strong>{g.name}</strong>
                      <span className="muted">{gameSummary(g)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </main>
  )
}
