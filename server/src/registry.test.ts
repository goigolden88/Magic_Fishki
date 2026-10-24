import { describe, expect, it } from 'vitest'
import { CODE_PATTERN, FRESH_MS, FULL, MAX_ROOMS, release, reserve } from './registry'
import { FakeStorage } from './testing'

const alive = async () => true

describe('реестр комнат', () => {
  it('десять комнат — да, одиннадцатая — «комнат уже 10»', async () => {
    const storage = new FakeStorage()
    const codes = new Set<string>()
    for (let i = 0; i < MAX_ROOMS; i++) {
      const r = await reserve(storage, alive, 0)
      if (!r.ok) throw new Error(r.error)
      expect(r.code).toMatch(CODE_PATTERN)
      codes.add(r.code)
    }
    expect(codes.size).toBe(MAX_ROOMS)
    expect(await reserve(storage, alive, FRESH_MS + 1)).toEqual({ ok: false, error: FULL })
    expect(FULL).toBe('Комнат уже 10')
  })

  it('стёртая комната освобождает место', async () => {
    const storage = new FakeStorage()
    const first = await reserve(storage, alive, 0)
    for (let i = 1; i < MAX_ROOMS; i++) await reserve(storage, alive, 0)
    if (!first.ok) throw new Error(first.error)
    await release(storage, first.code)
    expect((await reserve(storage, alive, 0)).ok).toBe(true)
  })

  it('весть о стирании потерялась — при полном реестре мёртвые комнаты вычеркиваются', async () => {
    const storage = new FakeStorage()
    const codes: string[] = []
    for (let i = 0; i < MAX_ROOMS; i++) {
      const r = await reserve(storage, alive, 0)
      if (r.ok) codes.push(r.code)
    }
    const dead = codes[3]
    const asked: string[] = []
    const isAlive = async (code: string) => {
      asked.push(code)
      return code !== dead
    }
    // Свежие заявки не трогаем: комнату в них, может быть, ещё создают
    expect(await reserve(storage, isAlive, FRESH_MS)).toEqual({ ok: false, error: FULL })
    expect(asked).toEqual([])
    const r = await reserve(storage, isAlive, FRESH_MS + 1)
    expect(r.ok).toBe(true)
    expect(asked.length).toBe(MAX_ROOMS)
  })
})
