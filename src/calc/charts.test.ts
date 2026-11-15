import { describe, expect, it } from 'vitest'
import nodesRaw from '../../data/leakproof/nodes.json?raw'
import chartsDataRaw from './chartsData.ts?raw'
import {
  actionLabel,
  chartLegend,
  chartSituations,
  chartsModuleText,
  combosText,
  handStripes,
  handText,
  lineSteps,
  packCharts,
  reachedText,
  sharePercentText,
  situationLabel,
  unpackNode,
  CHART_POSITIONS,
  type LeakproofNode,
} from './charts'
import { LEAKPROOF } from './chartsData'
import { classIndex, CLASSES } from './rangeText'

const NODES = JSON.parse(nodesRaw) as LeakproofNode[]
// Неразрывные пробелы (перед «ББ», между разрядами) — обычными: так строки в тесте читаются
const sp = (s: string) => s.replace(/ /g, ' ')

const nodeOf = (actor: string, line: string) => {
  const i = LEAKPROOF.findIndex((n) => n.actor === actor && n.line === line)
  if (i < 0) throw new Error(`нет ${actor} «${line}»`)
  return unpackNode(LEAKPROOF[i])
}

describe('чарты: перевод набора', () => {
  it('файл chartsData.ts — ровно перевод nodes.json (npm run charts)', () => {
    expect(chartsDataRaw).toBe(chartsModuleText(packCharts(NODES)))
  })

  it('78 решений, у каждой из шести позиций есть ситуации', () => {
    expect(LEAKPROOF).toHaveLength(78)
    for (const pos of CHART_POSITIONS) expect(chartSituations(LEAKPROOF, pos).length).toBeGreaterThan(0)
  })

  it('доли не правятся: каждый класс каждого решения — те же reach и доли, руки нет — пустая клетка', () => {
    NODES.forEach((node, i) => {
      const chart = unpackNode(LEAKPROOF[i])
      expect(chart.actor).toBe(node.actor)
      expect(chart.line).toBe(node.line)
      expect(chart.actions).toEqual(node.actions)
      CLASSES.forEach((cls, k) => {
        const src = node.classes[cls]
        const hand = chart.hands[k]
        if (!src) return expect(hand).toBeNull()
        expect(hand).not.toBeNull()
        expect(hand!.reach / 12).toBeCloseTo(src.reach, 5)
        hand!.strategy.forEach((s, a) => expect(s / 12).toBeCloseTo(src.strategy[a], 5))
      })
    })
  })

  it('не двенадцатые, доли не в сумме 1, чужое действие или ход — ошибка', () => {
    const base: LeakproofNode = { line: '', actor: 'UTG', actions: ['fold', 'raise 2bb'], classes: { AA: { reach: 1, strategy: [0, 1] } } }
    expect(() => packCharts([base])).not.toThrow()
    expect(() => packCharts([{ ...base, classes: { AA: { reach: 1, strategy: [0.3, 0.7] } } }])).toThrow(/двенадцатые/)
    expect(() => packCharts([{ ...base, classes: { AA: { reach: 1, strategy: [0.5, 0.25] } } }])).toThrow(/сумме/)
    expect(() => packCharts([{ ...base, actions: ['fold', 'limp'] }])).toThrow(/limp/)
    expect(() => packCharts([{ ...base, line: 'UTG call' }])).toThrow(/UTG call/)
    expect(() => packCharts([{ ...base, actor: 'MP' }])).toThrow(/позиция/)
    expect(() => packCharts([base, base])).toThrow(/дважды/)
  })
})

describe('чарты: вид экрана', () => {
  it('открытие первым — ориентиры набора: UTG около 18 %, BTN около 43 %', () => {
    const utg = chartLegend(nodeOf('UTG', ''))
    const btn = chartLegend(nodeOf('BTN', ''))
    expect(utg.reached).toBe(1326)
    expect(utg.rows.map((r) => sp(r.label))).toEqual(['Пас', 'Рейз 2 ББ'])
    expect(utg.rows[1].share).toBeGreaterThan(0.17)
    expect(utg.rows[1].share).toBeLessThan(0.19)
    expect(btn.rows[1].share).toBeGreaterThan(0.42)
    expect(btn.rows[1].share).toBeLessThan(0.44)
    expect(utg.rows[0].combos + utg.rows[1].combos).toBeCloseTo(1326, 9)
  })

  it('легенда с учётом того, как часто рука доходит: сочетания — класс × reach × доля', () => {
    const chart = nodeOf('BB', 'SB raise 3bb, BB raise 9bb, SB raise 24bb')
    const { reached, rows } = chartLegend(chart)
    let want = 0
    const src = NODES.find((n) => n.actor === 'BB' && n.line === 'SB raise 3bb, BB raise 9bb, SB raise 24bb')!
    for (const [cls, c] of Object.entries(src.classes)) want += (cls.length === 2 ? 6 : cls.endsWith('s') ? 4 : 12) * c.reach
    expect(reached).toBeCloseTo(want, 3)
    expect(rows.reduce((a, r) => a + r.combos, 0)).toBeCloseTo(reached, 9)
    expect(rows.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 9)
    expect(rows.map((r) => r.kind)).toEqual(['fold', 'call', 'allin'])
  })

  it('ситуации позиции словами и по порядку', () => {
    expect(chartSituations(LEAKPROOF, 'BTN').map((s) => sp(s.label))).toEqual([
      'Никто не входил',
      'Открылся UTG (2 ББ)',
      'Открылся HJ (2 ББ)',
      'Открылся CO (2,5 ББ)',
      'Я открылся, 3-бет от SB (11,5 ББ)',
      'Я открылся, 3-бет от BB (14 ББ)',
      'Я сделал 3-бет, 4-бет от UTG (16 ББ)',
      'Я сделал 3-бет, 4-бет от HJ (16 ББ)',
      'Я сделал 3-бет, 4-бет от CO (20 ББ)',
      'Я сделал 3-бет, олл-ин от HJ',
      'Я сделал 4-бет, олл-ин от SB',
      'Я сделал 4-бет, олл-ин от BB',
    ])
    expect(sp(chartSituations(LEAKPROOF, 'BB')[0].label)).toBe('Открылся UTG (2 ББ)')
    expect(situationLabel('CO', 'CO raise 2.5bb, BTN raise 7.5bb, CO raise 20bb, BTN allin')).toBe('Я сделал 4-бет, олл-ин от BTN')
    expect(situationLabel('BB', 'UTG raise 2bb, BB raise 11bb, UTG allin')).toBe('Я сделал 3-бет, олл-ин от UTG')
    expect(lineSteps('SB raise 3bb, BB allin')).toEqual([
      { pos: 'SB', bb: 3 },
      { pos: 'BB', bb: null },
    ])
  })

  it('действия с размером, касание клетки и полосы', () => {
    expect(sp(actionLabel('raise 7.5bb'))).toBe('Рейз 7,5 ББ')
    expect(actionLabel('fold')).toBe('Пас')
    expect(actionLabel('call')).toBe('Колл')
    expect(actionLabel('allin')).toBe('Олл-ин')
    const actions = ['fold', 'call', 'raise 7.5bb', 'allin']
    expect(handText('AKs', { reach: 12, strategy: [0, 0, 9, 3] }, actions)).toBe('AKs: рейз 75 % · олл-ин 25 %')
    expect(handText('44', { reach: 4, strategy: [0, 12, 0, 0] }, actions)).toBe('44: колл 100 % · доходит 33 %')
    expect(handText('72o', null, actions)).toBe('72o: в эту ситуацию не доходит')
    expect(handStripes({ reach: 12, strategy: [3, 0, 6, 3] }, actions)).toEqual([
      { kind: 'fold', from: 0, to: 25 },
      { kind: 'raise', from: 25, to: 75 },
      { kind: 'allin', from: 75, to: 100 },
    ])
    const chart = nodeOf('BB', 'SB raise 3bb, BB raise 9bb, SB raise 24bb')
    expect(chart.hands[classIndex('A8s')]).toEqual({ reach: 12, strategy: [0, 3, 9] })
    expect(chart.hands[classIndex('72o')]).toBeNull()
  })

  it('числа легенды словами', () => {
    expect(sharePercentText(0.181)).toBe('18,1 %')
    expect(sharePercentText(1)).toBe('100 %')
    expect(combosText(240)).toBe('240 сочетаний')
    expect(combosText(1)).toBe('1 сочетание')
    expect(combosText(0.75)).toBe('0,8 сочетания')
    expect(sp(reachedText(1326))).toBe('Доходит до ситуации: 1 326 сочетаний из 1 326 (100 % рук); доли — от дошедших')
  })
})
