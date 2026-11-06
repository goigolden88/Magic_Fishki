import { describe, expect, it } from 'vitest'
import {
  NOTE_COLORS,
  NOTE_TEXT_MAX,
  labelOf,
  mergeNotes,
  noteOf,
  parseLabels,
  parseNotes,
  setLabel,
  setNote,
} from './playerNotes'

describe('цвета заметок (Р-56)', () => {
  it('восемь цветов, у каждого своя подпись по умолчанию', () => {
    expect(NOTE_COLORS).toHaveLength(8)
    expect(new Set(NOTE_COLORS.map((c) => c.id)).size).toBe(8)
    expect(new Set(NOTE_COLORS.map((c) => c.label)).size).toBe(8)
    expect(labelOf({}, 'green')).toBe('фиш')
    expect(labelOf({}, 'red')).toBe('маньяк')
  })

  it('подпись переименовывается; пусто или как по умолчанию — снова по умолчанию', () => {
    const labels = setLabel({}, 'green', '  рыба ')
    expect(labels).toEqual({ green: 'рыба' })
    expect(labelOf(labels, 'green')).toBe('рыба')
    expect(labelOf(labels, 'red')).toBe('маньяк')
    expect(setLabel(labels, 'green', '   ')).toEqual({})
    expect(setLabel(labels, 'green', 'фиш')).toEqual({})
  })
})

describe('заметка игрока', () => {
  it('по имени без пробелов по краям: одноимённые делят одну заметку', () => {
    const notes = setNote({}, ' Аня ', { color: 'red', text: ' рейзит всё ' })
    expect(notes).toEqual({ Аня: { color: 'red', text: 'рейзит всё' } })
    expect(noteOf(notes, 'Аня')).toEqual({ color: 'red', text: 'рейзит всё' })
    expect(noteOf(notes, 'Аня  ')).toEqual({ color: 'red', text: 'рейзит всё' })
    expect(noteOf(notes, 'Боря')).toBeNull()
  })

  it('только цвет или только текст — заметка есть; без цвета и текста — удаляется', () => {
    let notes = setNote({}, 'Аня', { color: 'blue', text: '' })
    expect(noteOf(notes, 'Аня')).toEqual({ color: 'blue', text: '' })
    notes = setNote(notes, 'Боря', { color: null, text: 'не верить' })
    expect(noteOf(notes, 'Боря')).toEqual({ color: null, text: 'не верить' })
    notes = setNote(notes, 'Аня', { color: null, text: '  ' })
    expect(noteOf(notes, 'Аня')).toBeNull()
    expect(setNote(notes, 'Боря', null)).toEqual({})
  })

  it('пустое имя — заметки нет; длинный текст обрезается; «__proto__» — просто имя', () => {
    expect(setNote({}, '  ', { color: 'red', text: 'x' })).toEqual({})
    const long = setNote({}, 'Аня', { color: null, text: 'а'.repeat(NOTE_TEXT_MAX + 10) })
    expect(noteOf(long, 'Аня')?.text).toHaveLength(NOTE_TEXT_MAX)
    const proto = setNote({}, '__proto__', { color: 'gray', text: 'x' })
    expect(Object.keys(proto)).toEqual(['__proto__'])
    expect(noteOf(proto, '__proto__')).toEqual({ color: 'gray', text: 'x' })
    expect(noteOf({}, 'toString')).toBeNull()
  })
})

describe('чтение заметок и подписей', () => {
  it('заметки: верные — как есть, пустые — пропускаются, не тот вид — null', () => {
    expect(parseNotes({ Аня: { color: 'green', text: 'фиш' }, Боря: { color: null, text: '' } })).toEqual({
      Аня: { color: 'green', text: 'фиш' },
    })
    expect(parseNotes([])).toBeNull()
    expect(parseNotes(null)).toBeNull()
    expect(parseNotes({ Аня: { color: 'pink', text: '' } })).toBeNull()
    expect(parseNotes({ Аня: { color: 'red' } })).toBeNull()
  })

  it('подписи: неизвестный цвет пропускается, не строка — null', () => {
    expect(parseLabels({ green: 'рыба', pink: 'розовый' })).toEqual({ green: 'рыба' })
    expect(parseLabels({ green: 5 })).toBeNull()
    expect(parseLabels('green')).toBeNull()
  })
})

describe('восстановление заметок из копии ничего не перезаписывает', () => {
  it('добавляются заметки игроков, у которых здесь её нет; подписи — только не переименованные здесь', () => {
    const mine = { Аня: { color: 'red' as const, text: 'моя' } }
    const backup = {
      notes: { Аня: { color: 'green' as const, text: 'из копии' }, Боря: { color: 'blue' as const, text: '' } },
      noteLabels: { green: 'рыба', red: 'агро' },
    }
    const merged = mergeNotes(mine, { red: 'псих' }, backup)
    expect(merged.notes).toEqual({ Аня: { color: 'red', text: 'моя' }, Боря: { color: 'blue', text: '' } })
    expect(merged.labels).toEqual({ red: 'псих', green: 'рыба' })
    expect(merged.added).toBe(1)
  })

  it('пустая копия ничего не меняет', () => {
    const mine = { Аня: { color: 'red' as const, text: '' } }
    expect(mergeNotes(mine, {}, { notes: {}, noteLabels: {} })).toEqual({ notes: mine, labels: {}, added: 0 })
  })
})
