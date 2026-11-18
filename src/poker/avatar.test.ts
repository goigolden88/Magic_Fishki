import { describe, expect, it } from 'vitest'
import {
  AVATAR_IDS,
  AVATAR_MAX_CHARS,
  avatarOf,
  defaultAvatar,
  isAvatar,
  isAvatarId,
  isAvatarPicture,
  myAvatar,
} from './avatar'

describe('аватарки (#298)', () => {
  it('набор — 10 рисунков без повторов', () => {
    expect(AVATAR_IDS).toHaveLength(10)
    expect(new Set(AVATAR_IDS).size).toBe(10)
  })

  it('по умолчанию — стабильно по имени: тот же рисунок каждый раз, регистр и пробелы по краям не важны', () => {
    // Значения записаны: другой результат — у всех телефонов стали бы другие рисунки
    expect(defaultAvatar('Аня')).toBe(defaultAvatar('Аня'))
    expect(defaultAvatar(' аня ')).toBe(defaultAvatar('Аня'))
    expect(defaultAvatar('АНЯ')).toBe(defaultAvatar('Аня'))
    expect(['Аня', 'Боря', 'Вика', 'Гоша', 'Дима'].map(defaultAvatar)).toMatchInlineSnapshot(`
      [
        "heart",
        "cloud",
        "hedgehog",
        "cat",
        "heart",
      ]
    `)
    expect(isAvatarId(defaultAvatar(''))).toBe(true)
  })

  it('по умолчанию — разные имена расходятся по всему набору', () => {
    const names = Array.from({ length: 200 }, (_, i) => `Игрок ${i}`)
    expect(new Set(names.map(defaultAvatar)).size).toBe(AVATAR_IDS.length)
  })

  it('проверка: id набора или WebP / JPEG base64 не длиннее предела', () => {
    expect(isAvatar('cat')).toBe(true)
    expect(isAvatar('data:image/webp;base64,UklGRh4AAABXRUJQ')).toBe(true)
    expect(isAvatar('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true)
    expect(isAvatar('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
    expect(isAvatar('data:image/svg+xml;base64,AAAA')).toBe(false)
    expect(isAvatar('data:image/webp;base64,AA")')).toBe(false)
    expect(isAvatar('own')).toBe(false)
    expect(isAvatar('toString')).toBe(false)
    expect(isAvatar(null)).toBe(false)
    expect(isAvatar(7)).toBe(false)
    const head = 'data:image/webp;base64,'
    expect(isAvatarPicture(head + 'A'.repeat(AVATAR_MAX_CHARS - head.length))).toBe(true)
    expect(isAvatarPicture(head + 'A'.repeat(AVATAR_MAX_CHARS - head.length + 1))).toBe(false)
  })

  it('свой выбор: рисунок — он; «Своя» — картинка, если есть; иначе — null (по умолчанию)', () => {
    const pic = 'data:image/webp;base64,AAAA'
    expect(myAvatar('moon', pic)).toBe('moon')
    expect(myAvatar('own', pic)).toBe(pic)
    expect(myAvatar('own', null)).toBeNull()
    expect(myAvatar('own', 'data:image/png;base64,AAAA')).toBeNull()
    expect(myAvatar(null, pic)).toBeNull()
    expect(myAvatar(undefined, null)).toBeNull()
  })

  it('место: присланная, если годится, иначе по умолчанию по ключу', () => {
    expect(avatarOf('heart', 'Аня')).toBe('heart')
    expect(avatarOf(undefined, 'Аня')).toBe(defaultAvatar('Аня'))
    expect(avatarOf('dragon', 'Аня')).toBe(defaultAvatar('Аня'))
  })
})
