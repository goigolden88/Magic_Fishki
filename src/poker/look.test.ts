import { describe, expect, it } from 'vitest'
import { hostDo, parseLocalTable, startLocalTable } from '../calc/localTable'
import {
  backupLook,
  DECK_LABELS,
  deckOf,
  FACE_LABELS,
  faceOf,
  isDefaultLook,
  lookClass,
  lookOf,
  mergeMyLook,
  MY_BACK_LABELS,
  MY_FELT_LABELS,
  MY_LOOK_DEFAULT,
  parseMyLook,
  shownBack,
  suitClass,
} from '../calc/pokerLook'
import { CARD_BACKS, FELTS } from './table'
import { PROTOCOL_VERSION, type ClientBody } from './protocol'
import { handle, viewFor, type TableState } from './table'
import { call, newTable, play, start } from './testing'

const send = (state: TableState, from: string, body: ClientBody, now = 0) => handle(state, from, { v: PROTOCOL_VERSION, ...body }, now)

describe('вид стола (#77)', () => {
  it('выбор ведущего доходит в вид стола у всех; меняется и во время раздачи', () => {
    let s = play(newTable(['h', 'g']), [start('h'), call('h')], true)
    const r = send(s, 'h', { type: 'look', felt: 'burgundy', cardBack: 'geo' })
    expect(r.ok).toBe(true)
    s = r.ok ? r.state : s
    expect(s.hand).not.toBeNull() // раздача идёт дальше
    expect(lookOf(viewFor(s, 'g').settings)).toEqual({ felt: 'burgundy', cardBack: 'geo' })
    expect(lookClass(viewFor(s, null).settings)).toBe('table-look felt-burgundy back-geo')
  })

  it('нет поля — не меняется', () => {
    let s = newTable(['h', 'g'], { felt: 'blue', cardBack: 'green' })
    const r = send(s, 'h', { type: 'look', felt: 'graphite' })
    s = r.ok ? r.state : s
    expect(lookOf(s.settings)).toEqual({ felt: 'graphite', cardBack: 'green' })
  })

  it('не ведущему — отказ', () => {
    const s = newTable(['h', 'g'])
    expect(send(s, 'g', { type: 'look', felt: 'blue' })).toEqual({ ok: false, error: 'Это может только ведущий' })
  })

  it('неизвестное значение — отказ, и при создании стола', () => {
    const s = newTable(['h', 'g'])
    expect(send(s, 'h', { type: 'look', felt: 'pink' as 'blue' })).toEqual({
      ok: false,
      error: 'Сукно — зелёное, синее, бордовое или графит',
    })
    expect(send(s, 'h', { type: 'look', cardBack: null as unknown as 'geo' }).ok).toBe(false)
    expect(() => newTable(['h'], { cardBack: 'toString' as 'geo' })).toThrow('Рубашка карт')
  })

  it('стол без полей вида (до #77) — зелёное и классика; правила работают', () => {
    const old = newTable(['h', 'g'])
    delete old.settings.felt
    delete old.settings.cardBack
    expect(lookOf(old.settings)).toEqual({ felt: 'green', cardBack: 'classic' })
    expect(lookClass(old.settings)).toBe('table-look felt-green back-classic')
    const s = play(old, [start('h'), call('h')], true)
    expect(s.hand?.number).toBe(1)
  })

  it('стол на одном телефоне: сукно при начале и тем же сообщением; сохранённый до #77 открывается', () => {
    let n = 0
    const r = startLocalTable(
      [
        { name: 'Аня', regularId: null },
        { name: 'Боря', regularId: null },
      ],
      { sb: 5, bb: 10, startingStack: 1000, felt: 'blue' },
      0,
      () => `id${n++}`,
    )
    if (!r.ok) throw new Error(r.error)
    expect(lookOf(r.local.table.settings).felt).toBe('blue')
    const changed = hostDo(r.local.table, { type: 'look', felt: 'graphite' }, 0)
    expect(changed.ok && changed.state.settings.felt).toBe('graphite')

    const old = structuredClone(r.local)
    delete old.table.settings.felt
    delete old.table.settings.cardBack
    const parsed = parseLocalTable(JSON.stringify(old))
    expect(parsed && lookOf(parsed.table.settings)).toEqual({ felt: 'green', cardBack: 'classic' })
  })
})

describe('личный вид стола (Р-61)', () => {
  it('списки: прежние четыре и по два новых; у ведущего — прежние, их знает сервер', () => {
    expect(MY_FELT_LABELS.map(([f]) => f)).toEqual([...FELTS, 'navy', 'black'])
    expect(MY_BACK_LABELS.map(([b]) => b)).toEqual([...CARD_BACKS, 'chip', 'dark'])
    expect(MY_FELT_LABELS.slice(-2).map(([, l]) => l)).toEqual(['Тёмно-синее', 'Чёрное'])
    expect(DECK_LABELS).toEqual([
      ['two', 'Две масти цветом'],
      ['four', 'Четыре цвета'],
    ])
  })

  it('«Как у стола» — выбор ведущего; свой выбор — поверх него', () => {
    const settings = { felt: 'burgundy' as const, cardBack: 'geo' as const }
    expect(lookClass(settings, MY_LOOK_DEFAULT)).toBe('table-look felt-burgundy back-geo')
    expect(lookClass(settings, { ...MY_LOOK_DEFAULT, felt: 'black' })).toBe('table-look felt-black back-geo')
    expect(lookClass(settings, { felt: null, cardBack: 'dark', deck: 'four' })).toBe('table-look felt-burgundy back-dark')
  })

  it('стол до #77 без полей вида — свой выбор всё равно свой', () => {
    expect(lookClass({}, { felt: 'navy', cardBack: 'chip', deck: 'two' })).toBe('table-look felt-navy back-chip')
  })

  it('своя рубашка (#220): с картинкой — back-own, без картинки — как у стола', () => {
    const settings = { felt: 'burgundy' as const, cardBack: 'geo' as const }
    const own = { ...MY_LOOK_DEFAULT, cardBack: 'own' as const }
    expect(lookClass(settings, own, true)).toBe('table-look felt-burgundy back-own')
    expect(lookClass(settings, own, false)).toBe('table-look felt-burgundy back-geo')
    expect(lookClass(settings, own)).toBe('table-look felt-burgundy back-geo')
    expect(lookClass({}, own, false)).toBe('table-look felt-green back-classic')
    // встроенная рубашка — как прежде, картинка в памяти ей не мешает
    expect(lookClass(settings, { ...MY_LOOK_DEFAULT, cardBack: 'dark' }, true)).toBe('table-look felt-burgundy back-dark')
    expect(shownBack(own, false)).toBeNull()
    expect(shownBack(own, true)).toBe('own')
  })

  it('своя рубашка из памяти — «Своя»; в копию — «Как у стола», остальное как было', () => {
    expect(parseMyLook({ felt: 'navy', cardBack: 'own', deck: 'two', face: 'color' })).toEqual({
      felt: 'navy',
      cardBack: 'own',
      deck: 'two',
      face: 'color',
    })
    expect(MY_BACK_LABELS.some(([b]) => b === 'own')).toBe(false)
    const own = { felt: 'navy' as const, cardBack: 'own' as const, deck: 'two' as const, face: 'color' as const }
    expect(backupLook(own)).toEqual({ ...own, cardBack: null })
    const dark = { ...own, cardBack: 'dark' as const }
    expect(backupLook(dark)).toEqual(dark)
  })

  it('цвет масти: две масти — черви и бубны красные; четыре цвета — класс по масти', () => {
    expect(['As', 'Kh', 'Qd', 'Jc'].map((c) => suitClass(c, 'two'))).toEqual(['', 'red', 'red', ''])
    expect(['As', 'Kh', 'Qd', 'Jc'].map((c) => suitClass(c, 'four'))).toEqual(['suit-s', 'suit-h', 'suit-d', 'suit-c'])
  })

  it('из памяти: не из готовых, не объект или нет поля — «Как у стола» и колода не выбрана', () => {
    expect(parseMyLook(null)).toEqual(MY_LOOK_DEFAULT)
    expect(parseMyLook([1])).toEqual(MY_LOOK_DEFAULT)
    expect(parseMyLook({ felt: 'black', cardBack: 'toString', deck: 'four' })).toEqual({
      felt: 'black',
      cardBack: null,
      deck: 'four',
      face: null,
    })
    expect(parseMyLook({ felt: 'black', deck: 'six' }).deck).toBeNull()
  })

  it('колода по умолчанию — четыре цвета; записанная — как в записи (#192)', () => {
    expect(MY_LOOK_DEFAULT.deck).toBeNull()
    expect(deckOf(MY_LOOK_DEFAULT)).toBe('four')
    expect(deckOf(parseMyLook({ felt: 'navy' }))).toBe('four')
    expect(deckOf(parseMyLook({ felt: null, cardBack: null, deck: 'two' }))).toBe('two')
    expect(deckOf(parseMyLook({ deck: 'four' }))).toBe('four')
  })

  it('«ничего не выбрано» — только без своей колоды: выбор «две масти» сам по себе запоминается', () => {
    expect(isDefaultLook(MY_LOOK_DEFAULT)).toBe(true)
    expect(isDefaultLook({ ...MY_LOOK_DEFAULT, deck: 'two' })).toBe(false)
    expect(isDefaultLook({ ...MY_LOOK_DEFAULT, deck: 'four' })).toBe(false)
    expect(isDefaultLook({ ...MY_LOOK_DEFAULT, felt: 'black' })).toBe(false)
    const saved = JSON.parse(JSON.stringify({ ...MY_LOOK_DEFAULT, deck: 'two' }))
    expect(parseMyLook(saved)).toEqual({ felt: null, cardBack: null, deck: 'two', face: null })
  })

  it('восстановление: из копии — что здесь не выбрано; свой выбор остаётся', () => {
    const backup = { felt: 'navy' as const, cardBack: 'chip' as const, deck: 'four' as const, face: null }
    expect(mergeMyLook(MY_LOOK_DEFAULT, backup)).toEqual(backup)
    expect(mergeMyLook({ felt: 'green', cardBack: null, deck: null }, backup)).toEqual({
      felt: 'green',
      cardBack: 'chip',
      deck: 'four',
      face: null,
    })
    expect(mergeMyLook(backup, MY_LOOK_DEFAULT)).toEqual(backup)
  })

  it('лицо карт (#219): из памяти — только из готовых; мусор, не строка или нет поля — не выбрано', () => {
    expect(FACE_LABELS.map(([id]) => id)).toEqual(['big', 'classic', 'color'])
    expect(MY_LOOK_DEFAULT.face).toBeNull()
    expect(parseMyLook({ face: 'classic' }).face).toBe('classic')
    expect(parseMyLook({ face: 'color' }).face).toBe('color')
    expect(parseMyLook({ face: 'big' }).face).toBe('big')
    expect(parseMyLook({ face: 'gg' }).face).toBeNull()
    expect(parseMyLook({ face: 'toString' }).face).toBeNull()
    expect(parseMyLook({ face: 2 }).face).toBeNull()
    expect(parseMyLook({ face: ['color'] }).face).toBeNull()
    expect(parseMyLook({ felt: 'navy' }).face).toBeNull()
  })

  it('лицо карт: запись до #219 без поля читается как прежде, а рисуется «Крупным»', () => {
    const old = JSON.parse(JSON.stringify({ felt: 'black', cardBack: 'chip', deck: 'two' }))
    expect(parseMyLook(old)).toEqual({ felt: 'black', cardBack: 'chip', deck: 'two', face: null })
    expect(faceOf(parseMyLook(old))).toBe('big')
    expect(faceOf(MY_LOOK_DEFAULT)).toBe('big')
    expect(faceOf({ felt: null, cardBack: null, deck: null })).toBe('big')
    expect(faceOf({ ...MY_LOOK_DEFAULT, face: 'color' })).toBe('color')
  })

  it('лицо карт: выбранное, и «Крупное» тоже, — запись есть; туда и обратно — то же', () => {
    expect(isDefaultLook({ felt: null, cardBack: null, deck: null })).toBe(true)
    expect(isDefaultLook({ ...MY_LOOK_DEFAULT, face: 'classic' })).toBe(false)
    expect(isDefaultLook({ ...MY_LOOK_DEFAULT, face: 'big' })).toBe(false)
    const saved = JSON.parse(JSON.stringify({ ...MY_LOOK_DEFAULT, face: 'color' }))
    expect(parseMyLook(saved)).toEqual({ felt: null, cardBack: null, deck: null, face: 'color' })
  })

  it('лицо карт: восстановление — своё побеждает копию, не выбранное здесь берётся из копии', () => {
    const backup = { ...MY_LOOK_DEFAULT, face: 'color' as const }
    expect(mergeMyLook(MY_LOOK_DEFAULT, backup).face).toBe('color')
    expect(mergeMyLook({ ...MY_LOOK_DEFAULT, face: 'classic' }, backup).face).toBe('classic')
    expect(mergeMyLook({ ...MY_LOOK_DEFAULT, face: 'big' }, backup).face).toBe('big')
    expect(mergeMyLook(MY_LOOK_DEFAULT, { felt: null, cardBack: null, deck: null }).face).toBeNull()
    expect(mergeMyLook({ felt: null, cardBack: null, deck: null }, backup).face).toBe('color')
  })

  it('восстановление: свои «две масти» копия не затирает; копия без колоды не выбирает её здесь', () => {
    const backup = { felt: null, cardBack: null, deck: 'four' as const }
    expect(mergeMyLook({ ...MY_LOOK_DEFAULT, deck: 'two' }, backup).deck).toBe('two')
    expect(mergeMyLook(MY_LOOK_DEFAULT, { ...MY_LOOK_DEFAULT, deck: 'two' }).deck).toBe('two')
    expect(mergeMyLook(MY_LOOK_DEFAULT, MY_LOOK_DEFAULT).deck).toBeNull()
  })
})
