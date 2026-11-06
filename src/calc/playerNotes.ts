// Заметки об игроках (Р-56, #165): цветная метка и текст — по имени игрока, только на этом телефоне.
// Подписи цветов задаются в «Настройках»; по умолчанию — готовые. В комнату и на сервер не уходят,
// в файл-копию — да (формат 4)

// Восемь цветов: id — для хранения, hex — точка у места, name — цвет словами (для чтения с экрана)
export const NOTE_COLORS = [
  { id: 'green', hex: '#3ecf7a', name: 'зелёный', label: 'фиш' },
  { id: 'red', hex: '#ff5a4e', name: 'красный', label: 'маньяк' },
  { id: 'blue', hex: '#4a9dff', name: 'синий', label: 'тайтовый' },
  { id: 'purple', hex: '#b07cff', name: 'фиолетовый', label: 'регуляр' },
  { id: 'orange', hex: '#ff9a3c', name: 'оранжевый', label: 'блефует' },
  { id: 'yellow', hex: '#ffd84a', name: 'жёлтый', label: 'не верить' },
  { id: 'cyan', hex: '#38d6d6', name: 'голубой', label: 'колл-станция' },
  { id: 'gray', hex: '#a7b3ac', name: 'серый', label: 'другое' },
] as const

export type NoteColor = (typeof NOTE_COLORS)[number]['id']

const COLOR_IDS = new Set<string>(NOTE_COLORS.map((c) => c.id))

export function isNoteColor(v: unknown): v is NoteColor {
  return typeof v === 'string' && COLOR_IDS.has(v)
}

// Заметка: цвет (нет — без метки) и текст; без цвета и текста заметки нет
export type PlayerNote = { color: NoteColor | null; text: string }

// Заметки по имени игрока (без пробелов по краям): одноимённые делят одну заметку — так задумано
export type PlayerNotes = Record<string, PlayerNote>

// Подписи цветов — только переименованные; нет цвета — подпись по умолчанию
export type NoteLabels = Partial<Record<NoteColor, string>>

export const NOTE_TEXT_MAX = 500
export const NOTE_LABEL_MAX = 30

export const noteKey = (name: string) => name.trim()

// Своим полем, а не присваиванием: имя «__proto__» — тоже просто имя
function put<T>(obj: Record<string, T>, key: string, value: T) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
}

export function noteOf(notes: PlayerNotes, name: string): PlayerNote | null {
  const key = noteKey(name)
  return key !== '' && Object.hasOwn(notes, key) ? notes[key] : null
}

// Новая заметка игрока; без цвета и текста — заметка удаляется
export function setNote(notes: PlayerNotes, name: string, note: PlayerNote | null): PlayerNotes {
  const key = noteKey(name)
  if (key === '') return notes
  const next = { ...notes }
  const text = (note?.text ?? '').trim().slice(0, NOTE_TEXT_MAX)
  const color = note?.color ?? null
  if (color === null && text === '') delete next[key]
  else put(next, key, { color, text })
  return next
}

export function defaultLabel(color: NoteColor): string {
  return NOTE_COLORS.find((c) => c.id === color)?.label ?? ''
}

export function labelOf(labels: NoteLabels, color: NoteColor): string {
  return labels[color] ?? defaultLabel(color)
}

export function hexOf(color: NoteColor): string {
  return NOTE_COLORS.find((c) => c.id === color)?.hex ?? 'transparent'
}

// Переименовать подпись; пусто или как по умолчанию — снова по умолчанию
export function setLabel(labels: NoteLabels, color: NoteColor, text: string): NoteLabels {
  const label = text.trim().slice(0, NOTE_LABEL_MAX)
  const next = { ...labels }
  if (label === '' || label === defaultLabel(color)) delete next[color]
  else next[color] = label
  return next
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNote(v: unknown): v is PlayerNote {
  return isObject(v) && (v.color === null || isNoteColor(v.color)) && typeof v.text === 'string'
}

// Заметки из памяти телефона или копии: null — не тот вид. Пустые и с пустым именем — пропускаются
export function parseNotes(raw: unknown): PlayerNotes | null {
  if (!isObject(raw)) return null
  let notes: PlayerNotes = {}
  for (const [name, note] of Object.entries(raw)) {
    if (!isNote(note)) return null
    notes = setNote(notes, name, note)
  }
  return notes
}

// Подписи из памяти телефона или копии: null — не тот вид; неизвестный цвет — пропускается
export function parseLabels(raw: unknown): NoteLabels | null {
  if (!isObject(raw)) return null
  let labels: NoteLabels = {}
  for (const [color, label] of Object.entries(raw)) {
    if (typeof label !== 'string') return null
    if (isNoteColor(color)) labels = setLabel(labels, color, label)
  }
  return labels
}

// Восстановление из копии ничего не перезаписывает: заметки игроков, у которых здесь её нет, добавляются;
// подписи — только у цветов, которые здесь не переименованы
export function mergeNotes(
  notes: PlayerNotes,
  labels: NoteLabels,
  fromBackup: { notes: PlayerNotes; noteLabels: NoteLabels },
): { notes: PlayerNotes; labels: NoteLabels; added: number } {
  const nextNotes = { ...notes }
  let added = 0
  for (const [name, note] of Object.entries(fromBackup.notes)) {
    if (Object.hasOwn(nextNotes, name)) continue
    put(nextNotes, name, note)
    added++
  }
  const nextLabels = { ...labels }
  for (const c of NOTE_COLORS) {
    const label = fromBackup.noteLabels[c.id]
    if (label !== undefined && nextLabels[c.id] === undefined) nextLabels[c.id] = label
  }
  return { notes: nextNotes, labels: nextLabels, added }
}
