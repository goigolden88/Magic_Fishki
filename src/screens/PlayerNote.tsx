import { useState, useSyncExternalStore, type FormEvent } from 'react'
import {
  NOTE_COLORS,
  NOTE_TEXT_MAX,
  hexOf,
  labelOf,
  noteOf,
  setNote,
  type NoteColor,
  type NoteLabels,
  type PlayerNote,
} from '../calc/playerNotes'
import { loadNotes, saveNotes, subscribeNotes, type NotesState } from './pokerStorage'

// Заметки об игроках (Р-56, #165): цвет и текст по имени, только на этом телефоне.
// За столом — точка у места и правка по касанию имени; в карточке постоянного — блок «Заметка»

export function useNotes(): NotesState {
  return useSyncExternalStore(subscribeNotes, loadNotes)
}

// Подпись цвета словами, а нет цвета — «без цвета»
function colorText(labels: NoteLabels, color: NoteColor | null): string {
  return color === null ? 'без цвета' : labelOf(labels, color)
}

// Точка у места: цвет заметки; заметка без цвета — пустой кружок. Касание — показать заметку
export function NoteDot({ note, labels, onOpen }: { note: PlayerNote; labels: NoteLabels; onOpen: () => void }) {
  return (
    <button
      type="button"
      className="note-dot"
      aria-label={`Заметка: ${colorText(labels, note.color)}${note.text ? `, ${note.text}` : ''}`}
      onClick={onOpen}
    >
      <span className={note.color === null ? 'note-swatch empty' : 'note-swatch'} style={note.color ? { background: hexOf(note.color) } : undefined} />
    </button>
  )
}

// Заметка словами: цвет с подписью и текст
export function NoteView({ note, labels }: { note: PlayerNote; labels: NoteLabels }) {
  return (
    <>
      {note.color !== null && (
        <span className="note-label">
          <span className="note-swatch" style={{ background: hexOf(note.color) }} /> {labelOf(labels, note.color)}
        </span>
      )}
      {note.text ? <p className="note-text">{note.text}</p> : <p className="muted">Без текста</p>}
    </>
  )
}

// Правка заметки: цвет — кнопками с подписями, текст — полем; «Сохранить» без цвета и текста удаляет заметку
export function NoteForm({ name, onDone }: { name: string; onDone: () => void }) {
  const { notes, labels } = useNotes()
  const now = noteOf(notes, name)
  const [color, setColor] = useState<NoteColor | null>(now?.color ?? null)
  const [text, setText] = useState(now?.text ?? '')

  function save(e: FormEvent) {
    e.preventDefault()
    const state = loadNotes()
    saveNotes({ ...state, notes: setNote(state.notes, name, { color, text }) })
    onDone()
  }

  function remove() {
    const state = loadNotes()
    saveNotes({ ...state, notes: setNote(state.notes, name, null) })
    onDone()
  }

  return (
    <form className="note-form" onSubmit={save}>
      <fieldset className="note-colors">
        <legend className="muted">Цвет</legend>
        {NOTE_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            className={color === c.id ? 'note-color on' : 'note-color'}
            aria-pressed={color === c.id}
            onClick={() => setColor(color === c.id ? null : c.id)}
          >
            <span className="note-swatch" style={{ background: c.hex }} />
            <span className="note-color-label">{labelOf(labels, c.id)}</span>
          </button>
        ))}
      </fieldset>
      <label className="field">
        Текст
        <textarea
          className="note-input"
          maxLength={NOTE_TEXT_MAX}
          placeholder="Например: на ривере блефует"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button className="big primary wide">Сохранить</button>
      {now && (
        <button type="button" className="big wide danger-text" onClick={remove}>
          Удалить заметку
        </button>
      )}
      <button type="button" className="big wide" onClick={onDone}>
        Отмена
      </button>
    </form>
  )
}

// Заметка поверх стола: edit — сразу правка (касание имени), иначе — показ (касание точки) с «Поправить»
export function NotePop({ name, edit, onClose }: { name: string; edit: boolean; onClose: () => void }) {
  const { notes, labels } = useNotes()
  const [editing, setEditing] = useState(edit)
  const note = noteOf(notes, name)
  return (
    <div className="hud-pop" role="dialog" aria-label={`Заметка: ${name}`}>
      <strong className="hud-name">Заметка · {name}</strong>
      {editing || note === null ? (
        <>
          <span className="muted">Видна только на этом телефоне — у всех игроков с этим именем.</span>
          <NoteForm name={name} onDone={onClose} />
        </>
      ) : (
        <>
          <NoteView note={note} labels={labels} />
          <button type="button" className="big primary wide" onClick={() => setEditing(true)}>
            Поправить
          </button>
          <button type="button" className="big wide" onClick={onClose}>
            Закрыть
          </button>
        </>
      )}
    </div>
  )
}

// Карточка постоянного игрока: заметка видна и правится тут же
export function NoteCard({ name }: { name: string }) {
  const { notes, labels } = useNotes()
  const [editing, setEditing] = useState(false)
  const note = noteOf(notes, name)
  return (
    <section className="card note-card" aria-label="Заметка">
      <strong className="poker-all-title">Заметка</strong>
      {editing ? (
        <NoteForm name={name} onDone={() => setEditing(false)} />
      ) : (
        <>
          {note ? <NoteView note={note} labels={labels} /> : <p className="muted">Заметки нет — видна только на этом телефоне.</p>}
          <button type="button" className="big wide" onClick={() => setEditing(true)}>
            {note ? 'Поправить заметку' : 'Написать заметку'}
          </button>
        </>
      )}
    </section>
  )
}
