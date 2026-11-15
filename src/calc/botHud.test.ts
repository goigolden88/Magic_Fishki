import { describe, expect, it } from 'vitest'
import { HUD_FEW_HANDS, type HudCounts } from '../poker/hud'
import { BOT_STYLES, type BotStyle } from './bot'
import { HUD_FIRM_HANDS, readRival, readStage, readWeight } from './botHud'

// Чтение соперника в две точки (#240, Р-80): с HUD_FEW_HANDS — половина по игре, к HUD_FIRM_HANDS — вся
describe('чтение соперника по HUD: две точки', () => {
  it(`вес по игре: 0 до ${HUD_FEW_HANDS} раздач, 0,5 на ${HUD_FEW_HANDS}, ровно растёт, 1 с ${HUD_FIRM_HANDS}`, () => {
    expect([HUD_FEW_HANDS, HUD_FIRM_HANDS]).toEqual([30, 100])
    expect(readWeight(0)).toBe(0)
    expect(readWeight(29)).toBe(0)
    expect(readWeight(30)).toBe(0.5)
    expect(readWeight(65)).toBeCloseTo(0.75)
    expect(readWeight(99)).toBeLessThan(1)
    expect(readWeight(99)).toBeGreaterThan(readWeight(98))
    expect(readWeight(100)).toBe(1)
    expect(readWeight(500)).toBe(1)
    expect([29, 30, 99, 100].map(readStage)).toEqual(['prior', 'first', 'first', 'firm'])
  })

  const hudOf = (c: Partial<HudCounts>): HudCounts => ({
    hands: 100, vpip: 0, pfr: 0, stealChances: 30, steals: 0, cbChances: 10, cbs: 0, raises: 0, calls: 0, ...c,
  })
  // Маньяк за 100 раздач: входит в две трети раздач, повышает почти половину, давит
  const MANIAC = hudOf({ vpip: 66, pfr: 46, steals: 20, cbs: 8, raises: 60, calls: 22 })
  const signs: [BotStyle | undefined][] = [...BOT_STYLES.map(([s]) => [s] as [BotStyle]), [undefined]]
  const signed = (sign: BotStyle | undefined): Record<string, BotStyle> => (sign ? { x: sign } : {})

  it(`маньяк на ${HUD_FIRM_HANDS} раздачах читается маньяком при любой подписи — и без подписи`, () => {
    for (const omaha of [false, true]) {
      for (const [sign] of signs) {
        expect(readRival('x', signed(sign), { x: MANIAC }, omaha).who, `${sign ?? 'без подписи'}${omaha ? ', омаха' : ''}`).toBe('maniac')
      }
    }
  })

  it('на 30 раздачах — половина по подписи: нит с игрой маньяка ещё не маньяк, к 100 — маньяк', () => {
    const at = (hands: number) => hudOf({ ...MANIAC, hands, vpip: Math.round(0.66 * hands), pfr: Math.round(0.46 * hands) })
    expect(readRival('x', { x: 'nit' }, { x: at(30) }, false).who).not.toBe('maniac')
    expect(readRival('x', { x: 'nit' }, { x: at(HUD_FIRM_HANDS) }, false).who).toBe('maniac')
  })

  it(`с ${HUD_FIRM_HANDS} раздач — только по счётчикам: у маньяка и спокойного игрока подпись чтения не меняет`, () => {
    const CALM = hudOf({ vpip: 22, pfr: 15, steals: 8, cbs: 6, raises: 30, calls: 15 })
    for (const hud of [MANIAC, CALM]) {
      const reads = signs.map(([sign]) => readRival('x', signed(sign), { x: hud }, false))
      for (const r of reads) expect(r).toEqual(reads[0])
    }
  })

  it(`меньше ${HUD_FEW_HANDS} раздач — как подписан, без подписи — ABC`, () => {
    const few = { x: { ...MANIAC, hands: HUD_FEW_HANDS - 1 } }
    expect(readRival('x', { x: 'nit' }, few, false).who).toBe('nit')
    expect(readRival('x', {}, few, false).who).toBe('abc')
  })
})
