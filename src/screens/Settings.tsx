import { useEffect, useState, type FormEvent } from 'react'
import { formatNumber, formatRate, parseChips, parseRate } from '../calc/format'
import { moveItem, type Settings } from '../model'
import { getSettings, saveSettings } from '../store/db'

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rateText, setRateText] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void getSettings().then((s) => {
      setSettings(s)
      setRateText(formatRate(s.defaultRate))
    })
  }, [])

  const rate = rateText === null ? null : parseRate(rateText)

  // Списки сохраняются сразу, курс — кнопкой «Сохранить»
  function update(next: Settings) {
    setSettings(next)
    void saveSettings(next)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (rate === null || settings === null) return
    const next = { ...settings, defaultRate: rate }
    setSettings(next)
    await saveSettings(next)
    setSaved(true)
  }

  return (
    <main className="screen">
      <header className="bar">
        <a className="bar-link" href="#/">
          ← Игры
        </a>
      </header>
      <h1>Настройки</h1>

      {settings !== null && rateText !== null && (
        <>
          <form className="card" onSubmit={(e) => void save(e)}>
            <label className="field">
              Курс новой игры, ₽ за фишку
              <input
                inputMode="decimal"
                value={rateText}
                onChange={(e) => {
                  setRateText(e.target.value)
                  setSaved(false)
                }}
              />
            </label>
            <p className="muted">У начатых игр курс свой — он меняется на экране игры.</p>
            {rate === null && <p className="warn">Курс — число больше нуля, например 0,5</p>}
            {saved && <p className="ok">Сохранено</p>}
            <button className="big primary wide" disabled={rate === null}>
              Сохранить
            </button>
          </form>

          <PlayersCard players={settings.players} onChange={(players) => update({ ...settings, players })} />
          <AmountsCard
            amounts={settings.quickAmounts}
            onChange={(quickAmounts) => update({ ...settings, quickAmounts })}
          />
        </>
      )}
    </main>
  )
}

type MoveButtonsProps = { index: number; length: number; onMove: (delta: number) => void }

function MoveButtons({ index, length, onMove }: MoveButtonsProps) {
  return (
    <>
      <button type="button" className="icon" aria-label="Выше" disabled={index === 0} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button
        type="button"
        className="icon"
        aria-label="Ниже"
        disabled={index === length - 1}
        onClick={() => onMove(1)}
      >
        ↓
      </button>
    </>
  )
}

function PlayersCard({ players, onChange }: { players: string[]; onChange: (players: string[]) => void }) {
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  const name = newName.trim()
  const duplicate = players.includes(name)
  const editName = editText.trim()
  const editDuplicate = editing !== null && players.some((p, i) => i !== editing && p === editName)

  function add(e: FormEvent) {
    e.preventDefault()
    if (!name || duplicate) return
    onChange([...players, name])
    setNewName('')
  }

  function rename(e: FormEvent) {
    e.preventDefault()
    if (editing === null || !editName || editDuplicate) return
    onChange(players.map((p, i) => (i === editing ? editName : p)))
    setEditing(null)
  }

  function remove(index: number) {
    if (!confirm(`Убрать «${players[index]}» из постоянных? Прошлые игры не изменятся.`)) return
    onChange(players.filter((_, i) => i !== index))
    setEditing(null)
  }

  return (
    <section className="card">
      <h2>Постоянные игроки</h2>
      <p className="muted">В новой игре они сразу отмечены — лишних можно снять.</p>
      {players.length > 0 && (
        <ul className="list items">
          {players.map((p, i) =>
            editing === i ? (
              <li key={i}>
                <form className="row" onSubmit={rename}>
                  <input
                    className="grow"
                    autoFocus
                    aria-label="Новое имя"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <button className="big primary" disabled={!editName || editDuplicate}>
                    ОК
                  </button>
                  <button type="button" className="big" onClick={() => setEditing(null)}>
                    ✕
                  </button>
                </form>
                {editDuplicate && <p className="warn">Такой игрок уже есть</p>}
              </li>
            ) : (
              <li key={i} className="item">
                <span className="grow">{p}</span>
                <MoveButtons index={i} length={players.length} onMove={(d) => onChange(moveItem(players, i, d))} />
                <button
                  type="button"
                  className="icon"
                  aria-label="Переименовать"
                  onClick={() => {
                    setEditing(i)
                    setEditText(p)
                  }}
                >
                  ✎
                </button>
                <button type="button" className="icon" aria-label="Удалить" onClick={() => remove(i)}>
                  ✕
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="row" onSubmit={add}>
        <input className="grow" placeholder="Имя игрока" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <button className="big primary" disabled={!name || duplicate}>
          Добавить
        </button>
      </form>
      {name && duplicate && <p className="warn">Такой игрок уже есть</p>}
    </section>
  )
}

function AmountsCard({ amounts, onChange }: { amounts: number[]; onChange: (amounts: number[]) => void }) {
  const [text, setText] = useState('')
  const chips = parseChips(text)
  const duplicate = chips !== null && amounts.includes(chips)

  function add(e: FormEvent) {
    e.preventDefault()
    if (chips === null || duplicate) return
    onChange([...amounts, chips])
    setText('')
  }

  return (
    <section className="card">
      <h2>Быстрые суммы, фишек</h2>
      <p className="muted">Кнопки у «Закуп», «Докуп» и «Выход» — запись одним касанием.</p>
      {amounts.length > 0 && (
        <ul className="list items">
          {amounts.map((a, i) => (
            <li key={a} className="item">
              <span className="grow">{formatNumber(a)}</span>
              <MoveButtons index={i} length={amounts.length} onMove={(d) => onChange(moveItem(amounts, i, d))} />
              <button
                type="button"
                className="icon"
                aria-label="Удалить"
                onClick={() => onChange(amounts.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="row" onSubmit={add}>
        <input
          className="grow"
          inputMode="numeric"
          pattern="[0-9 ]*"
          placeholder="Сумма, фишек"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="big primary" disabled={chips === null || duplicate}>
          Добавить
        </button>
      </form>
      {duplicate && <p className="warn">Такая сумма уже есть</p>}
    </section>
  )
}
