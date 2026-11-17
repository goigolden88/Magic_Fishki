import { HELP_VALUES, helpGroups } from './helpText'

// Адрес в тексте раздела — ссылкой; подпись — читаемая, без %20
const URL_PART = /(https:\/\/\S+)/

function Paragraph({ text }: { text: string }) {
  return (
    <p>
      {text.split(URL_PART).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {decodeURI(part)}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  )
}

// Справка (#245): группы разделов — свёрнуты, внутри группы — её разделы, тоже свёрнутые
export function HelpScreen() {
  return (
    <main className="screen">
      <header className="bar">
        <a className="bar-link" href="#/">
          ← Игры
        </a>
      </header>
      <h1>Справка</h1>

      {helpGroups(HELP_VALUES).map((g) => (
        <details key={g.title} className="help-group">
          <summary>
            <span className="grow">{g.title}</span>
            <span className="muted">{g.sections.length}</span>
          </summary>
          {/* Р-53: на широком окне разделы группы — в две колонки */}
          <div className="cards">
            {g.sections.map((s) => (
              <details key={s.title} className="card help">
                <summary>{s.title}</summary>
                {s.text.map((p, i) => (
                  <Paragraph key={i} text={p} />
                ))}
              </details>
            ))}
          </div>
        </details>
      ))}
    </main>
  )
}
