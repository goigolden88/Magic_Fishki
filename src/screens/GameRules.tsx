// Правила игры стола (#277): строка над столом с «ⓘ» — касание открывает карточку «Правила: <название>» с отличиями
// от холдема (gameRules). Карточка — поверх страницы, без затемнения: стол под ней работает, отсчёт хода идёт.
// Один компонент для комнаты, стола на этом телефоне и против ботов
import { useEffect, useState, type ReactNode } from 'react'
import { gameRules, type GameRules } from '../calc/gameRules'
import type { Settings } from '../poker/table'

// Строка над столом: у холдема — как была, иначе кнопкой со значком «ⓘ»
export function TableInfo({ settings, children }: { settings: Settings; children: ReactNode }) {
  const rules = gameRules(settings)
  const [open, setOpen] = useState(false)
  if (!rules) return <p className="muted table-info">{children}</p>
  return (
    <>
      <button
        type="button"
        className="muted table-info rules-line"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {children}{' '}
        <span className="rules-mark" aria-label={`Правила: ${rules.title}`}>
          ⓘ
        </span>
      </button>
      {open && <RulesCard rules={rules} onClose={() => setOpen(false)} />}
    </>
  )
}

export function RulesCard({ rules, onClose }: { rules: GameRules; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="rules-pop" role="dialog" aria-label={`Правила: ${rules.title}`}>
      <strong className="rules-title">Правила: {rules.title}</strong>
      <span className="muted">Чем отличается от холдема</span>
      <ul className="rules-lines">
        {rules.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <button type="button" className="big wide" onClick={onClose}>
        Закрыть
      </button>
    </div>
  )
}
