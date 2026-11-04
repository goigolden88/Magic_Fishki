import { useState, type KeyboardEvent } from 'react'
import { SAME_NAME } from '../model'

// Поле «Гость — имя» и «Добавить» (Р-44): гостя добавляют там же, где выбирают участников.
// Без своей формы — живёт и внутри чужой (настройки казино-стола): Enter добавляет, а не отправляет.
// taken — имена, что уже есть: такое имя не добавляется, подсказка «Такой участник уже есть»
export function GuestField({ taken, onAdd }: { taken: string[]; onAdd: (name: string) => void }) {
  const [name, setName] = useState('')
  const trimmed = name.trim()
  const same = trimmed !== '' && taken.includes(trimmed)

  function add() {
    if (!trimmed || same) return
    onAdd(trimmed)
    setName('')
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    add()
  }

  return (
    <>
      <div className="row">
        <input
          className="grow"
          aria-label="Имя гостя"
          placeholder="Гость — имя"
          enterKeyHint="done"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKey}
        />
        <button type="button" className="big" disabled={!trimmed || same} onClick={add}>
          Добавить
        </button>
      </div>
      {same && <p className="warn">{SAME_NAME}</p>}
    </>
  )
}

// Добавленные гости новой игры — списком с «✕»
export function GuestList({ guests, onRemove }: { guests: string[]; onRemove: (index: number) => void }) {
  if (guests.length === 0) return null
  return (
    <ul className="list items">
      {guests.map((g, i) => (
        <li key={i} className="row">
          <span className="grow">{g}</span>
          <button type="button" className="big" aria-label={`Убрать гостя ${g}`} onClick={() => onRemove(i)}>
            ✕
          </button>
        </li>
      ))}
    </ul>
  )
}
