import { describe, expect, it } from 'vitest'
import { bestHand, buildDeck, compareHands, HOLDEM, OMAHA, SHORT_DECK, winners, type Variant } from './cards'

const c = (s: string) => s.split(' ')
const best = (variant: Variant, hand: string, board: string) => bestHand(variant, c(hand), c(board))

describe('колода', () => {
  it('52 карты по порядку, без повторов', () => {
    const deck = buildDeck(HOLDEM)
    expect(deck).toHaveLength(52)
    expect(new Set(deck).size).toBe(52)
    expect(deck.slice(0, 5)).toEqual(['2s', '2h', '2d', '2c', '3s'])
    expect(deck[51]).toBe('Ac')
    expect(buildDeck(OMAHA)).toEqual(deck)
  })

  it('шорт-дек — 36 карт, без двоек–пятёрок', () => {
    const deck = buildDeck(SHORT_DECK)
    expect(deck).toHaveLength(36)
    expect(new Set(deck).size).toBe(36)
    expect(deck[0]).toBe('6s')
    expect(deck.some((x) => '2345'.includes(x[0]))).toBe(false)
  })
})

describe('холдем — комбинации и названия', () => {
  it.each([
    ['Ah Kh', 'Qh Jh Th 2c 3d', 'straightFlush', 'Роял-флеш'],
    ['9s 8s', '7s 6s 5s Ad Ac', 'straightFlush', 'Стрит-флеш до девятки'],
    ['Ah 2h', '3h 4h 5h Kd Kc', 'straightFlush', 'Стрит-флеш до пятёрки'],
    ['Ah Ad', 'As Ac Kd 2c 3d', 'quads', 'Каре, тузы'],
    ['Kh Kd', 'Ks 7c 7d 2c 3d', 'fullHouse', 'Фулл-хаус, короли и семёрки'],
    ['Ah 3h', 'Kh 9h 2h 7c 8d', 'flush', 'Флеш, старший туз'],
    ['Qh 3h', 'Jh 9h 2h 7c 8d', 'flush', 'Флеш, старшая дама'],
    ['Ah 2d', '3c 4s 5h Kd Qc', 'straight', 'Стрит до пятёрки'],
    ['Ah Kd', 'Qc Js Th 2d 3c', 'straight', 'Стрит до туза'],
    ['Qh Qd', 'Qs 7c 4d 2c 9d', 'trips', 'Тройка, дамы'],
    ['Kh 7d', 'Ks 7c 2h 9d 3s', 'twoPair', 'Две пары, короли и семёрки'],
    ['Jh Jd', 'As 7c 4d 2c 9d', 'pair', 'Пара, валеты'],
    ['Ah Jd', '8s 7c 4d 2c 9d', 'high', 'Старшая карта, туз'],
  ])('%s + %s → %s', (hand, board, category, name) => {
    const r = best(HOLDEM, hand, board)
    expect(r.category).toBe(category)
    expect(r.name).toBe(name)
    expect(r.cards).toHaveLength(5)
  })

  it('лучшая пятёрка: сначала комбинация, затем кикер', () => {
    expect(best(HOLDEM, 'Kh 7d', 'Ks 7c 2h 9d 3s').cards).toEqual(['Kh', 'Ks', '7d', '7c', '9d'])
  })

  it('A-2-3-4-5 — младший стрит: туз в конце, проигрывает стриту до шестёрки', () => {
    const wheel = best(HOLDEM, 'Ah 2d', '3c 4s 5h Kd Qc')
    expect(wheel.cards).toEqual(['5h', '4s', '3c', '2d', 'Ah'])
    expect(compareHands(best(HOLDEM, '6h 2d', '3c 4s 5h Kd Qc'), wheel)).toBeGreaterThan(0)
    expect(winners(HOLDEM, c('3c 4s 5h Kd Qc'), [{ id: 'a', cards: c('Ah 2d') }, { id: 'b', cards: c('6h 7d') }])).toEqual(['b'])
  })

  it('играет стол: все пять со стола — ничья у всех', () => {
    const board = c('Ts Js Qs Ks As')
    const r = bestHand(HOLDEM, c('2c 3d'), board)
    expect(r.name).toBe('Роял-флеш')
    expect(r.cards.sort()).toEqual([...board].sort())
    expect(winners(HOLDEM, board, [{ id: 'a', cards: c('2c 3d') }, { id: 'b', cards: c('4h 5h') }])).toEqual(['a', 'b'])
  })

  it('кикер решает: пара тузов с королём сильнее пары тузов с дамой', () => {
    const board = c('Ad 9c 6s 3h 2d')
    const a = bestHand(HOLDEM, c('Ah Kc'), board)
    const b = bestHand(HOLDEM, c('As Qd'), board)
    expect(compareHands(a, b)).toBeGreaterThan(0)
    expect(compareHands(b, a)).toBeLessThan(0)
    expect(winners(HOLDEM, board, [{ id: 'b', cards: c('As Qd') }, { id: 'a', cards: c('Ah Kc') }])).toEqual(['a'])
  })

  it('кикер за пределами пятёрки не считается — ничья', () => {
    const board = c('Ah Ad Kc Ks Qd')
    expect(winners(HOLDEM, board, [{ id: 'a', cards: c('2c 3c') }, { id: 'b', cards: c('Jd 5d') }])).toEqual(['a', 'b'])
  })

  it('равные руки разных мастей — ничья', () => {
    const board = c('Kd 8c 5s 3h 2d')
    const a = bestHand(HOLDEM, c('Ah Jc'), board)
    const b = bestHand(HOLDEM, c('As Jd'), board)
    expect(compareHands(a, b)).toBe(0)
  })

  it('вторая пара и кикер в двух парах', () => {
    const board = c('Kd Kc 7s 7h 2d')
    expect(winners(HOLDEM, board, [{ id: 'a', cards: c('Qh 3c') }, { id: 'b', cards: c('Ah 3d') }])).toEqual(['b'])
    const board2 = c('Kd Kc 7s 4h 2d')
    expect(winners(HOLDEM, board2, [{ id: 'a', cards: c('7h 3c') }, { id: 'b', cards: c('4s Ad') }])).toEqual(['a'])
  })

  it('холдем: фулл-хаус старше флеша, флеш старше стрита', () => {
    const board = c('Kh Ks 7h 2h 9c')
    expect(winners(HOLDEM, board, [{ id: 'flush', cards: c('Ah 3h') }, { id: 'full', cards: c('Kd 7c') }])).toEqual(['full'])
    const board2 = c('8h 9h Th 2c 3d')
    expect(winners(HOLDEM, board2, [{ id: 'straight', cards: c('Jc Qd') }, { id: 'flush', cards: c('4h 5h') }])).toEqual(['flush'])
  })

  it('несколько претендентов: ничья двоих из трёх', () => {
    const board = c('Ad 9c 6s 3h 2d')
    const out = winners(HOLDEM, board, [
      { id: 'a', cards: c('Ah Kc') },
      { id: 'b', cards: c('Qh Jc') },
      { id: 'c', cards: c('As Kd') },
    ])
    expect(out).toEqual(['a', 'c'])
  })

  it('флоп: стол из трёх карт — сравнение работает', () => {
    const board = c('Ad 9c 6s')
    expect(best(HOLDEM, 'Ah Kc', 'Ad 9c 6s').name).toBe('Пара, тузы')
    expect(winners(HOLDEM, board, [{ id: 'a', cards: c('Ah Kc') }, { id: 'b', cards: c('9h 9d') }])).toEqual(['b'])
  })

  it('нет претендентов — нет победителей', () => {
    expect(winners(HOLDEM, c('Ad 9c 6s'), [])).toEqual([])
  })
})

describe('омаха — ровно 2 из руки и 3 со стола', () => {
  it('флеш на столе из 4 карт при одной такой масти в руке — не флеш', () => {
    const r = best(OMAHA, 'Ah Kd 9s 9c', '2h 5h 8h Jh 3c')
    expect(r.category).not.toBe('flush')
    expect(r.name).toBe('Пара, девятки')
    expect(best(HOLDEM, 'Ah Kd', '2h 5h 8h Jh 3c').category).toBe('flush')
  })

  it('стрит из 4 карт на столе при одной подходящей в руке — не стрит', () => {
    const r = best(OMAHA, '9c 2d 2s Qh', '5c 6d 7h 8s Kd')
    expect(r.category).not.toBe('straight')
    expect(r.name).toBe('Пара, двойки')
    expect(best(HOLDEM, '9c 2d', '5c 6d 7h 8s Kd').category).toBe('straight')
  })

  it('рука из четырёх тузов — только пара тузов', () => {
    const r = best(OMAHA, 'As Ah Ad Ac', 'Kc 8d 5h 3s 2c')
    expect(r.name).toBe('Пара, тузы')
    expect(r.cards.filter((x) => x[0] === 'A')).toHaveLength(2)
  })

  it('флеш из двух карт руки и трёх со стола', () => {
    const r = best(OMAHA, 'Ah 3h Kd Kc', '2h 5h 8h Jc 3c')
    expect(r.name).toBe('Флеш, старший туз')
    expect(r.cards).toEqual(['Ah', '8h', '5h', '3h', '2h'])
  })

  it('флоп и победители', () => {
    const board = c('Kc 8d 5h')
    expect(best(OMAHA, 'Kd Ks 2c 3c', 'Kc 8d 5h').name).toBe('Тройка, короли')
    expect(winners(OMAHA, board, [{ id: 'a', cards: c('Kd Ks 2c 3c') }, { id: 'b', cards: c('8s 8c 5d 5s') }])).toEqual(['a'])
  })

  it('пять карт в руке — то же правило «ровно 2»', () => {
    // Две пары — тузы и короли — потребовали бы трёх карт руки
    expect(best(OMAHA, 'As Ah Ad Ac Kd', 'Kc 8d 5h 3s 2c').name).toBe('Пара, тузы')
  })
})

describe('шорт-дек — 36 карт', () => {
  it('флеш старше фулл-хауса', () => {
    const board = c('Kh Ks 7h 6h 9c')
    expect(winners(SHORT_DECK, board, [{ id: 'full', cards: c('Kd 7c') }, { id: 'flush', cards: c('Ah 8h') }])).toEqual(['flush'])
    expect(compareHands(bestHand(SHORT_DECK, c('Ah Th'), board), bestHand(SHORT_DECK, c('Kd 7c'), board))).toBeGreaterThan(0)
  })

  it('A-6-7-8-9 — младший стрит, проигрывает стриту до десятки', () => {
    const wheel = best(SHORT_DECK, 'Ah 6d', '7c 8s 9h Kd Kc')
    expect(wheel.name).toBe('Стрит до девятки')
    expect(wheel.cards).toEqual(['9h', '8s', '7c', '6d', 'Ah'])
    expect(winners(SHORT_DECK, c('7c 8s 9h Kd Qc'), [{ id: 'a', cards: c('Ah 6d') }, { id: 'b', cards: c('Th 6s') }])).toEqual(['b'])
  })

  it('A-6-7-8-9 одной масти — стрит-флеш до девятки', () => {
    expect(best(SHORT_DECK, 'As 6s', '7s 8s 9s Kd Kc').name).toBe('Стрит-флеш до девятки')
  })

  it('стрит старше тройки (по умолчанию, как в холдеме)', () => {
    const board = c('7c 8s 9h Qd Qc')
    expect(winners(SHORT_DECK, board, [{ id: 'trips', cards: c('Qh 6c') }, { id: 'straight', cards: c('Th Js') }])).toEqual(['straight'])
  })

  it('карты 2–5 в шорт-деке — ошибка', () => {
    expect(() => best(SHORT_DECK, 'Ah 5d', '7c 8s 9h')).toThrow('нет в колоде')
  })
})

describe('правило варианта — параметром', () => {
  it('три карты в руке «любые из руки» — C(8,5)', () => {
    expect(best(HOLDEM, 'Ah Ad As', 'Kc Kd 2h 3s 9c').name).toBe('Фулл-хаус, тузы и короли')
  })

  it('«ровно 3 из руки» при пяти картах в руке', () => {
    const v: Variant = { ...OMAHA, fromHand: 3 }
    // Из руки — ровно три: две пары на руке дают только пару и кикер
    expect(best(v, 'Ah Ad Kh Kd 2c', 'Qs Js 9s 7c 4d').name).toBe('Пара, тузы')
    expect(best(v, 'Ah Ad As 2c 3c', 'Kc Kd 9s 7c 4d').name).toBe('Фулл-хаус, тузы и короли')
  })

  it('порядок старшинства меняется одним параметром: тройка старше стрита', () => {
    const order = [...SHORT_DECK.order]
    order.splice(order.indexOf('trips'), 1)
    order.splice(order.indexOf('straight') + 1, 0, 'trips')
    const triton: Variant = { ...SHORT_DECK, order }
    const board = c('7c 8s 9h Qd Qc')
    const players = [
      { id: 'trips', cards: c('Qh 6c') },
      { id: 'straight', cards: c('Th Js') },
    ]
    expect(winners(triton, board, players)).toEqual(['trips'])
  })
})

describe('ошибки — понятные, а не случайный ответ', () => {
  it.each(['Xh', '10h', 'Az', 'ah', '', 'Ahh'])('неверная запись «%s»', (bad) => {
    expect(() => bestHand(HOLDEM, ['Kd', bad], c('2c 3d 4h'))).toThrow('Неверная запись карты')
  })

  it('одна карта дважды — в руке и на столе', () => {
    expect(() => best(HOLDEM, 'Ah Kd', 'Ah 3d 4h')).toThrow('встречается дважды')
  })

  it('одна карта у двух претендентов', () => {
    expect(() => winners(HOLDEM, c('2c 3d 4h'), [{ id: 'a', cards: c('Ah Kd') }, { id: 'b', cards: c('Ah Qd') }])).toThrow(
      'встречается дважды',
    )
  })

  it('на столе меньше 3 или больше 5 карт', () => {
    expect(() => best(HOLDEM, 'Ah Kd', '2c 3d')).toThrow('от 3 до 5')
    expect(() => best(HOLDEM, 'Ah Kd', '2c 3d 4h 5s 6s 7s')).toThrow('от 3 до 5')
  })

  it('в руке омахи меньше двух карт', () => {
    expect(() => best(OMAHA, 'Ah', '2c 3d 4h 5s')).toThrow('не меньше 2')
  })
})
