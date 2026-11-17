// Копия из FamilyCore@d9e5ec6 (core/token.test.ts), правится здесь
import { describe, expect, it } from 'vitest'
import { expiryDay, WARN_DAYS } from './token'

describe('token', () => {
  it('порог предупреждения — 30 дней, день — первые десять знаков', () => {
    expect(WARN_DAYS).toBe(30)
    expect(expiryDay('2027-09-09 12:00:00 +0300')).toBe('2027-09-09')
    expect(expiryDay('2027-09-09')).toBe('2027-09-09')
  })

  it('срок неизвестен или кривой — null, а не выдуманная дата', () => {
    expect(expiryDay(null)).toBeNull()
    expect(expiryDay('')).toBeNull()
    expect(expiryDay('2027-02-31')).toBeNull()
    expect(expiryDay('скоро')).toBeNull()
  })
})
