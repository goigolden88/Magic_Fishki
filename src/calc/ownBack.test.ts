import { describe, expect, it } from 'vitest'
import { coverCrop, isOwnBackUrl, OWN_BACK_MAX_CHARS, ownBackCss } from './ownBack'

describe('своя рубашка: обрезка под 5 : 7', () => {
  it('широкая картинка — режутся бока, по центру', () => {
    expect(coverCrop(1000, 700)).toEqual({ sx: 250, sy: 0, sw: 500, sh: 700 })
  })

  it('высокая картинка — режутся верх и низ, по центру', () => {
    expect(coverCrop(500, 1000)).toEqual({ sx: 0, sy: 150, sw: 500, sh: 700 })
  })

  it('ровно 5 : 7 — целиком', () => {
    expect(coverCrop(240, 336)).toEqual({ sx: 0, sy: 0, sw: 240, sh: 336 })
  })

  it('1 × 1 px — сам пиксель, не пусто', () => {
    expect(coverCrop(1, 1)).toEqual({ sx: 0, sy: 0, sw: 1, sh: 1 })
  })

  it('кусок не выходит за картинку', () => {
    for (const [w, h] of [
      [4032, 3024],
      [3024, 4032],
      [7, 5],
      [1, 1000],
      [1000, 1],
    ]) {
      const c = coverCrop(w, h)
      expect(c.sx).toBeGreaterThanOrEqual(0)
      expect(c.sy).toBeGreaterThanOrEqual(0)
      expect(c.sx + c.sw).toBeLessThanOrEqual(w)
      expect(c.sy + c.sh).toBeLessThanOrEqual(h)
      expect(c.sw).toBeGreaterThan(0)
      expect(c.sh).toBeGreaterThan(0)
    }
  })
})

describe('своя рубашка: проверка строки', () => {
  it('верная WebP, JPEG и PNG — да', () => {
    expect(isOwnBackUrl('data:image/webp;base64,UklGRh4AAABXRUJQ')).toBe(true)
    expect(isOwnBackUrl('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true)
    expect(isOwnBackUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true)
  })

  it('чужое — нет', () => {
    expect(isOwnBackUrl('javascript:alert(1)')).toBe(false)
    expect(isOwnBackUrl('data:image/webp;base64,AAA"')).toBe(false)
    expect(isOwnBackUrl('data:image/webp;base64,AAA)')).toBe(false)
    expect(isOwnBackUrl('data:image/webp;base64,AA A')).toBe(false)
    expect(isOwnBackUrl('data:image/svg+xml;base64,AAAA')).toBe(false)
    expect(isOwnBackUrl('data:image/webp;base64,')).toBe(false)
    expect(isOwnBackUrl('')).toBe(false)
    expect(isOwnBackUrl(null)).toBe(false)
    expect(isOwnBackUrl(42)).toBe(false)
  })

  it('длиннее предела — нет, ровно предел — да', () => {
    const head = 'data:image/webp;base64,'
    expect(isOwnBackUrl(head + 'A'.repeat(OWN_BACK_MAX_CHARS - head.length))).toBe(true)
    expect(isOwnBackUrl(head + 'A'.repeat(OWN_BACK_MAX_CHARS - head.length + 1))).toBe(false)
  })

  it('в CSS — только проверенная строка', () => {
    expect(ownBackCss('data:image/webp;base64,AAAA')).toBe('url("data:image/webp;base64,AAAA")')
    expect(ownBackCss('data:image/webp;base64,AA") , url("x')).toBeNull()
    expect(ownBackCss(null)).toBeNull()
  })
})
