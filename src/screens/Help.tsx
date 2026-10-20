import { HELP_VALUES, helpSections } from './helpText'

// Справка: раздел на экран плюс расчёт, данные и «если что-то не так»; разделы свёрнуты
export function HelpScreen() {
  return (
    <main className="screen">
      <header className="bar">
        <a className="bar-link" href="#/">
          ← Игры
        </a>
      </header>
      <h1>Справка</h1>

      {helpSections(HELP_VALUES).map((s) => (
        <details key={s.title} className="card help">
          <summary>{s.title}</summary>
          {s.text.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </details>
      ))}
    </main>
  )
}
