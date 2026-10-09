import { useEffect, useState, type FormEvent } from 'react'
import { formatRate, parseRate } from '../calc/format'
import { getSettings, saveSettings } from '../store/db'

export function SettingsScreen() {
  const [rateText, setRateText] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void getSettings().then((s) => setRateText(formatRate(s.defaultRate)))
  }, [])

  const rate = rateText === null ? null : parseRate(rateText)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (rate === null) return
    await saveSettings({ defaultRate: rate })
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

      {rateText !== null && (
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
      )}
    </main>
  )
}
