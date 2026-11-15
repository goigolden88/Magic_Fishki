import { describe, expect, it } from 'vitest'
import { chartLegend, situationKey, unpackNode } from './charts'
import { LEAKPROOF } from './chartsData'
import {
  applyRange,
  builtinCells,
  chartFileName,
  chartFileText,
  chartName,
  chartProblem,
  emptyCells,
  newChartActions,
  ownChartGrid,
  parseChartFile,
  parseRaiseBB,
  sameCells,
  stepDown,
  stepUp,
  type OwnChart,
} from './ownCharts'
import { CLASSES, classIndex, parseRange } from './rangeText'

const ACTIONS = ['fold', 'call', 'raise 3bb', 'allin']

const CHART: OwnChart = {
  id: 'c1',
  name: 'Мой BTN',
  base: 'BTN|',
  actions: ['fold', 'raise 2.5bb'],
  cells: { AA: [0, 1], '72o': [1, 0], AKs: [0.25, 0.75] },
  updatedAt: '2026-11-14T10:00:00.000Z',
}

const weightsOf = (text: string) => {
  const parsed = parseRange(text)
  if (!('weights' in parsed)) throw new Error(parsed.error)
  return parsed.weights
}

describe('свои чарты: из встроенного (#215)', () => {
  it('доли встроенного — те же, что на экране; встроенный набор не меняется', () => {
    const before = JSON.stringify(LEAKPROOF)
    const node = LEAKPROOF[0]
    const cells = builtinCells(node)
    const chart = unpackNode(node)
    CLASSES.forEach((cls, k) => {
      const hand = chart.hands[k]
      if (!hand) return expect(cells[cls]).toBeUndefined()
      cells[cls].forEach((s, i) => expect(s).toBeCloseTo(hand.strategy[i] / 12, 9))
      expect(cells[cls].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    })
    expect(JSON.stringify(LEAKPROOF)).toBe(before)
    expect(situationKey(node)).toBe(`${node.actor}|${node.line}`)
  })

  it('открытие первым у UTG: доля рейза в легенде своего чарта — как у встроенного, если рука доходит целиком', () => {
    const node = LEAKPROOF.find((n) => n.actor === 'UTG' && n.line === '')!
    const own = chartLegend(ownChartGrid({ actions: node.actions, cells: builtinCells(node) }))
    const built = chartLegend(unpackNode(node))
    expect(own.reached).toBeCloseTo(built.reached, 9)
    own.rows.forEach((r, i) => expect(r.share).toBeCloseTo(built.rows[i].share, 9))
  })

  it('сравнение долей: правка видна, та же — равны', () => {
    const cells = builtinCells(LEAKPROOF[0])
    expect(sameCells(cells, builtinCells(LEAKPROOF[0]))).toBe(true)
    const aa = cells.AA
    expect(sameCells(cells, { ...cells, AA: stepDown(aa, aa.indexOf(Math.max(...aa))) })).toBe(false)
    const { AA: _aa, ...noAA } = cells
    expect(sameCells(cells, noAA)).toBe(false)
  })
})

describe('свои чарты: правка клетки шагом 25 %', () => {
  it('«+» берёт у паса, затем у других действий с конца; сумма — 100 %', () => {
    expect(stepUp([1, 0, 0, 0], 2)).toEqual([0.75, 0, 0.25, 0])
    expect(stepUp([0, 0.5, 0, 0.5], 1)).toEqual([0, 0.75, 0, 0.25])
    expect(stepUp([0, 0, 0, 1], 0)).toEqual([0.25, 0, 0, 0.75])
    expect(stepUp([0, 1, 0, 0], 1)).toEqual([0, 1, 0, 0])
  })

  it('доли встроенного не на отметке — «+» и «−» до ближайшей отметки 25 %', () => {
    const up = stepUp([1 / 12, 11 / 12], 0)
    expect(up[0]).toBeCloseTo(0.25, 9)
    expect(up[0] + up[1]).toBeCloseTo(1, 9)
    const down = stepDown([5 / 12, 7 / 12], 1)
    expect(down[1]).toBeCloseTo(0.5, 9)
    expect(down[0]).toBeCloseTo(0.5, 9)
  })

  it('«−» отдаёт пасу, у паса — первому действию после него; ниже нуля — нет', () => {
    expect(stepDown([0, 0, 1, 0], 2)).toEqual([0.25, 0, 0.75, 0])
    expect(stepDown([0.5, 0, 0.5, 0], 0)).toEqual([0.25, 0.25, 0.5, 0])
    expect(stepDown([1, 0, 0, 0], 3)).toEqual([1, 0, 0, 0])
  })
})

describe('свои чарты: новый и «Загрузить текстом»', () => {
  it('действия нового: пас первым, колл, рейзы по размеру без повторов, олл-ин', () => {
    expect(newChartActions({ call: true, raises: [7.5, 2.5, 7.5], allin: true })).toEqual(['fold', 'call', 'raise 2.5bb', 'raise 7.5bb', 'allin'])
    expect(newChartActions({ call: false, raises: [], allin: true })).toEqual(['fold', 'allin'])
    expect(parseRaiseBB('2,5')).toBe(2.5)
    expect(parseRaiseBB(' 3 bb')).toBe(3)
    expect(parseRaiseBB('7.5ББ')).toBe(7.5)
    expect(parseRaiseBB('2,55')).toBeNull()
    expect(parseRaiseBB('0')).toBeNull()
    expect(parseRaiseBB('')).toBeNull()
    expect(chartName('  Мой   BTN ')).toBe('Мой BTN')
  })

  it('новый чарт: все руки пасуют целиком', () => {
    const cells = emptyCells(ACTIONS)
    expect(Object.keys(cells)).toHaveLength(169)
    expect(cells.AA).toEqual([1, 0, 0, 0])
  })

  it('диапазон ложится на действие, остаток — пас; вне диапазона — доля 0', () => {
    const cells = applyRange(emptyCells(ACTIONS), ACTIONS, 2, weightsOf('77+, A9s+, AKs:0.5'))
    expect(cells['77']).toEqual([0, 0, 1, 0])
    expect(cells.A9s).toEqual([0, 0, 1, 0])
    expect(cells.AKs).toEqual([0.5, 0, 0.5, 0])
    expect(cells['72o']).toEqual([1, 0, 0, 0])
    expect(Object.keys(cells)).toHaveLength(169)
  })

  it('вторая вставка — другое действие: прежнее остаётся, а не влезает — урезается', () => {
    const raised = applyRange(emptyCells(ACTIONS), ACTIONS, 2, weightsOf('AA, KK:0.5, QQ'))
    const called = applyRange(raised, ACTIONS, 1, weightsOf('KK:0.5, QQ:0.5, JJ'))
    expect(called.AA).toEqual([0, 0, 1, 0])
    expect(called.KK).toEqual([0, 0.5, 0.5, 0])
    expect(called.QQ).toEqual([0, 0.5, 0.5, 0])
    expect(called.JJ).toEqual([0, 1, 0, 0])
  })

  it('руки нет в чарте: диапазон её добавляет; нет и в диапазоне — её и не будет', () => {
    const cells = applyRange({ AA: [1, 0, 0, 0] }, ACTIONS, 3, weightsOf('KK'))
    expect(cells).toEqual({ AA: [1, 0, 0, 0], KK: [0, 0, 0, 1] })
  })

  it('каждая клетка после вставки — в сумме 100 %', () => {
    const cells = applyRange(builtinCells(LEAKPROOF[5]), LEAKPROOF[5].actions, 1, weightsOf('22+, A2+, K9s+, QTo:0.3'))
    for (const shares of Object.values(cells)) expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
    expect(cells.QTo[1]).toBeCloseTo(0.3, 9)
    expect(classIndex('QTo')).toBeGreaterThan(0)
  })
})

describe('свои чарты: файл', () => {
  it('выгрузка и загрузка — тот же чарт; имя файла — chart-имя.json', () => {
    expect(parseChartFile(chartFileText(CHART))).toEqual({ ok: true, chart: CHART })
    expect(chartFileName('Мой BTN')).toBe('chart-Мой BTN.json')
    expect(chartFileName('UTG/HJ: 3-бет?')).toBe('chart-UTG-HJ- 3-бет-.json')
  })

  it('чужой или битый файл — понятная ошибка', () => {
    expect(parseChartFile('{"app":')).toEqual({ ok: false, error: 'Файл не читается: это не чарт «Фишек» или он повреждён' })
    expect(parseChartFile(JSON.stringify({ app: 'magic_fishki', format: 7, games: [] }))).toEqual({ ok: false, error: 'Это не чарт «Фишек»' })
    const file = (chart: unknown, format = 1) => JSON.stringify({ app: 'magic_fishki', kind: 'chart', format, chart })
    expect(parseChartFile(file(CHART, 2))).toEqual({ ok: false, error: 'Чарт из более новой версии «Фишек» — обновите приложение' })
    expect(parseChartFile(file({ ...CHART, cells: { AA: [0.5, 0.25] } }))).toEqual({
      ok: false,
      error: 'Чарт повреждён: у AA доли не в сумме 100 %',
    })
    expect(parseChartFile(file({ ...CHART, cells: { ZZ: [0, 1] } }))).toEqual({ ok: false, error: 'Чарт повреждён: рука «ZZ» не разобрана' })
    expect(chartProblem({ ...CHART, actions: ['raise 2bb', 'fold'] })).toBe('действия — пас и хотя бы одно ещё')
    expect(chartProblem({ ...CHART, actions: ['fold', 'limp'] })).toBe('действие не разобрано')
    expect(chartProblem({ ...CHART, name: '  ' })).toBe('нет имени')
    expect(chartProblem(CHART)).toBeNull()
  })
})
