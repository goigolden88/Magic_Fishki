import { describe, expect, it } from 'vitest'
import { newTable } from './testing'
import { canRejoin, issueToken } from './tokens'

describe('токен возврата', () => {
  it('32 шестнадцатеричных знака из 16 случайных байт', () => {
    expect(issueToken((b) => b.fill(0xab))).toBe('ab'.repeat(16))
    expect(issueToken()).toMatch(/^[0-9a-f]{32}$/)
    expect(issueToken()).not.toBe(issueToken())
  })

  it('пускает на место только с верным токеном и пока игрок за столом', () => {
    const table = newTable(['p0', 'p1'])
    const tokens = { p0: 'secret0', p1: 'secret1', gone: 'secret2' }
    expect(canRejoin(tokens, table, 'p1', 'secret1')).toEqual({ ok: true })
    expect(canRejoin(tokens, table, 'p1', 'secret0')).toEqual({ ok: false, reason: 'badToken' })
    expect(canRejoin(tokens, table, 'p9', 'secret1')).toEqual({ ok: false, reason: 'unknownPlayer' })
    expect(canRejoin(tokens, table, 'gone', 'secret2')).toEqual({ ok: false, reason: 'notSeated' })
    expect(canRejoin(tokens, table, 'p1', '')).toEqual({ ok: false, reason: 'noCreds' })
  })
})
