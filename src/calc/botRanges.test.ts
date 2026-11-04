import { describe, expect, it } from 'vitest'
import { COMBOS, comboIndex, HAND_ORDER, handClass, inTop, openWidth, topShare } from './botRanges'

describe('диапазоны ботов', () => {
  it('таблица рук: все 169 классов по одному разу — 13 пар, 78 одномастных, 78 разномастных', () => {
    expect(HAND_ORDER).toHaveLength(169)
    expect(new Set(HAND_ORDER).size).toBe(169)
    expect(HAND_ORDER.filter((c) => c.length === 2)).toHaveLength(13)
    expect(HAND_ORDER.filter((c) => c.endsWith('s'))).toHaveLength(78)
    expect(HAND_ORDER.filter((c) => c.endsWith('o'))).toHaveLength(78)
    expect(COMBOS).toHaveLength(1326)
    expect(new Set(COMBOS.map((c) => handClass(c.a, c.b))).size).toBe(169)
  })

  it('верхняя доля: тузы — сильнейшие, 7-2 разной масти — слабейшая, одномастные выше разномастных', () => {
    expect(topShare('Ah', 'As')).toBeLessThan(0.01)
    expect(topShare('7h', '2c')).toBeGreaterThan(0.99)
    expect(topShare('Ah', 'Kh')).toBeLessThan(topShare('Ah', 'Kc'))
    expect(topShare('Kh', 'Ks')).toBeLessThan(topShare('Ah', 'Kh'))
    expect(handClass('Td', 'Js')).toBe('JTo')
    expect(comboIndex('Ah', 'Kd')).toBe(comboIndex('Kd', 'Ah'))
  })

  it('открытие: поздняя позиция шире ранней, хедз-ап шире всего; ЛАГ шире ТАГа, нит уже всех', () => {
    for (const who of ['tag', 'lag', 'abc', 'nit'] as const) {
      expect(openWidth(who, 2, 6)).toBeGreaterThan(openWidth(who, 5, 6))
      expect(openWidth(who, 2, 2)).toBeGreaterThan(openWidth(who, 2, 6))
    }
    expect(openWidth('lag', 4, 6)).toBeGreaterThan(openWidth('tag', 4, 6))
    expect(openWidth('nit', 4, 6)).toBeLessThan(openWidth('abc', 4, 6))
    // Вес за краем диапазона — плавно к нулю
    expect(inTop(0.1, 0.2)).toBe(1)
    expect(inTop(0.22, 0.2)).toBeGreaterThan(0)
    expect(inTop(0.5, 0.2)).toBe(0)
  })
})
