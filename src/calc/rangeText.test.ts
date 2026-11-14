import { describe, expect, it } from 'vitest'
import { HAND_ORDER } from './botRanges'
import { CLASSES, classIndex, emptyRange, fullRange, parseRange, rangeText } from './rangeText'

function weightsOf(text: string): number[] {
  const r = parseRange(text)
  if ('error' in r) throw new Error(r.error)
  return r.weights
}

// Классы с весом: { класс: вес }
function named(weights: number[]): Record<string, number> {
  const out: Record<string, number> = {}
  weights.forEach((w, i) => {
    if (w > 0) out[CLASSES[i]] = w
  })
  return out
}

describe('классы сетки', () => {
  it('169 классов — те же, что в таблице ботов, без повторов', () => {
    expect(CLASSES).toHaveLength(169)
    expect(new Set(CLASSES).size).toBe(169)
    expect([...CLASSES].sort()).toEqual([...HAND_ORDER].sort())
  })

  it('строка — старшая карта: пары на диагонали, одномастные выше, разномастные ниже', () => {
    expect(CLASSES.slice(0, 3)).toEqual(['AA', 'AKs', 'AQs'])
    expect(CLASSES[13]).toBe('AKo')
    expect(CLASSES[14]).toBe('KK')
    expect(CLASSES[168]).toBe('22')
    expect(classIndex('AKs')).toBe(1)
    expect(classIndex('KAs')).toBe(-1)
  })
})

describe('parseRange', () => {
  it('запись из задачи — в веса 169 классов', () => {
    const w = named(weightsOf('77+, A9s+, AJo+, KTs-K8s, 22-55, AKs, AKs:0.5'))
    const one = (list: string) => Object.fromEntries(list.split(' ').map((c) => [c, 1]))
    expect(w).toEqual({
      ...one('AA KK QQ JJ TT 99 88 77 55 44 33 22'),
      ...one('AQs AJs ATs A9s AJo AQo AKo KTs K9s K8s'),
      AKs: 0.5,
    })
  })

  it('без масти — обе; «+» у руки — кикер до ранга под старшей; отрезок в любом порядке', () => {
    expect(named(weightsOf('KQ'))).toEqual({ KQs: 1, KQo: 1 })
    expect(Object.keys(named(weightsOf('A2+')))).toHaveLength(24)
    expect(named(weightsOf('Q9o+'))).toEqual({ Q9o: 1, QTo: 1, QJo: 1 })
    expect(weightsOf('K8s-KTs')).toEqual(weightsOf('KTs-K8s'))
    expect(weightsOf('55-22')).toEqual(weightsOf('22-55'))
    expect(named(weightsOf('AA+'))).toEqual({ AA: 1 })
  })

  it('строчные буквы, пробелы и точка с запятой', () => {
    expect(weightsOf('aks , qq+ kts - k8s ; 77 : 0.25')).toEqual(weightsOf('AKs, QQ+, KTs-K8s, 77:0.25'))
  })

  it('последний кусок побеждает; вес 0 — класс убран', () => {
    expect(named(weightsOf('AKs:0.5, AKs'))).toEqual({ AKs: 1 })
    expect(named(weightsOf('QQ+, KK:0'))).toEqual({ AA: 1, QQ: 1 })
  })

  it('пустой текст — пустой диапазон', () => {
    expect(weightsOf('')).toEqual(emptyRange())
    expect(weightsOf('  ,  ')).toEqual(emptyRange())
  })

  it('мусор — ошибка с указанием куска', () => {
    const cases: [string, string][] = [
      ['QQ+, AKx', 'AKx'],
      ['AA, ZZ', 'ZZ'],
      ['AAs', 'AAs'],
      ['KTs-Q8s', 'KTs-Q8s'],
      ['KTs-K8o', 'KTs-K8o'],
      ['22-AK', '22-AK'],
      ['AKs:1.5', 'AKs:1.5'],
      ['AKs:-1', 'AKs:-1'],
      ['AKs:abc', 'AKs:abc'],
      ['AKs+-AQs', 'AKs+-AQs'],
      ['A', 'A'],
    ]
    for (const [text, piece] of cases) {
      const r = parseRange(text)
      expect(r, text).toMatchObject({ piece })
      if ('error' in r) expect(r.error).toContain(piece)
    }
  })
})

describe('rangeText', () => {
  it('короткая запись: «+», отрезки, обе масти без буквы, вес — в конце куска', () => {
    expect(rangeText(weightsOf('77+, A9s+, AJo+, KTs-K8s, 22-55, AKs, AKs:0.5'))).toBe(
      '77+, 55-22, AQs-A9s, AJo+, KTs-K8s, AKs:0.5',
    )
    expect(rangeText(weightsOf('AKs, AKo, A2s+, A2o+'))).toBe('A2+')
    expect(rangeText(fullRange())).toBe('22+, A2+, K2+, Q2+, J2+, T2+, 92+, 82+, 72+, 62+, 52+, 42+, 32')
    expect(rangeText(emptyRange())).toBe('')
  })

  it('обратная запись разбирается в те же веса', () => {
    const texts = [
      '77+, A9s+, AJo+, KTs-K8s, 22-55, AKs, AKs:0.5',
      'QQ+, AKs, JJ:0.75, ATs-A2s:0.3, KQo:0.125',
      '22+, A2+, K9s+, 76s, 54o:0.5',
    ]
    for (const text of texts) {
      const w = weightsOf(text)
      expect(weightsOf(rangeText(w)), text).toEqual(w)
    }
    // Случайные веса с повторами уровней — тоже
    let seed = 7
    const next = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let t = 0; t < 20; t++) {
      const w = CLASSES.map(() => {
        const x = next()
        return x < 0.5 ? 0 : x < 0.8 ? 1 : x < 0.9 ? 0.5 : Math.round(next() * 1000) / 1000
      })
      expect(weightsOf(rangeText(w))).toEqual(w)
    }
    const tiny = emptyRange()
    tiny[classIndex('AA')] = 1e-7
    expect(weightsOf(rangeText(tiny))).toEqual(tiny)
  })
})
