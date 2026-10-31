import { describe, expect, it } from 'vitest'
import {
  allShown,
  autoOpenLabel,
  BOARD_FLIP_MS,
  cardsShown,
  nextWake,
  openNext,
  openNow,
  revealEvery,
  revealHold,
  revealPause,
  revealRelease,
  revealResume,
  revealStart,
  revealTick,
  secondsLeft,
  turning,
  type Reveal,
} from './casinoReveal'

const S = 1000
const FLIP = BOARD_FLIP_MS

// Прогнать часы от from до to шагами экрана: на каждом пробуждении — срок
function run(s: Reveal, from: number, to: number): Reveal {
  let now = from
  for (let i = 0; i < 1000; i++) {
    const wait = nextWake(s, now)
    if (wait === null || now + wait > to) return s
    now += wait
    s = revealTick(s, now)
  }
  throw new Error('часы не идут')
}

describe('открытие столов казино', () => {
  it('подписи выбора: «Нет» и секунды', () => {
    expect([0, 3, 5, 10].map(autoOpenLabel)).toEqual(['Нет', '3 с', '5 с', '10 с'])
  })

  it('сами через 5 с: первый — через 5 с после раздачи, следующий — через 5 с после того, как открылся', () => {
    let s = revealStart(3, 5 * S, 0, 0, 1500)
    expect(secondsLeft(s, 0)).toBe(5) // пока идёт раздача — полный промежуток
    expect(revealTick(s, 6499).opened).toBe(0)
    expect(secondsLeft(s, 3000)).toBe(4)
    s = revealTick(s, 6500)
    expect(s.opened).toBe(1)
    expect(secondsLeft(s, 6500)).toBe(5)
    s = revealTick(s, 11_499)
    expect(s.opened).toBe(1)
    s = revealTick(s, 11_500)
    expect(s.opened).toBe(2)
    s = revealTick(s, 16_500)
    expect(s.opened).toBe(3)
    // Последний открыт — отсчёт стоит, итог
    expect(s.due).toBeNull()
    expect(secondsLeft(s, 16_500)).toBeNull()
    expect(allShown(s, 16_500)).toBe(true)
    expect(nextWake(s, 16_500)).toBeNull()
  })

  it('часы экрана открывают все столы по одному и останавливаются', () => {
    const s = run(revealStart(4, 3 * S, FLIP, 0), 0, 60 * S)
    expect(s.opened).toBe(4)
    expect(allShown(s, 60 * S)).toBe(true)
  })

  it('с переворотом: отсчёт до следующего — от последней карты; итог — после неё', () => {
    let s = revealStart(2, 5 * S, FLIP, 0)
    s = revealTick(s, 5000)
    expect(s.opened).toBe(1)
    expect(turning(s, 5000)).toBe(true)
    expect(secondsLeft(s, 5000)).toBe(5) // во время переворота — полный промежуток
    expect(s.due).toBe(5000 + FLIP + 5000)
    s = revealTick(s, s.due as number)
    expect(s.opened).toBe(2)
    expect(allShown(s, 11_500 + FLIP - 1)).toBe(false)
    expect(allShown(s, 11_500 + FLIP)).toBe(true)
  })

  it('карты стола — по одной слева направо, весь стол не дольше переворота', () => {
    const s = openNext(revealStart(1, null, FLIP, 0), 1000)
    expect(cardsShown(s, 1000)).toBe(1)
    expect(cardsShown(s, 1000 + FLIP / 5)).toBe(2)
    expect(cardsShown(s, 1000 + (FLIP * 4) / 5)).toBe(5)
    expect(turning(s, 1000 + FLIP - 1)).toBe(true)
    expect(turning(s, 1000 + FLIP)).toBe(false)
    expect(nextWake(s, 1000)).toBe(FLIP / 5)
    expect(nextWake(s, 1000 + (FLIP * 4) / 5)).toBe(FLIP / 5) // последняя карта доворачивается
  })

  it('без анимации стол открывается сразу целиком', () => {
    const s = openNext(revealStart(2, null, 0, 0), 100)
    expect(turning(s, 100)).toBe(false)
    expect(cardsShown(s, 100)).toBe(5)
    expect(cardsShown(revealStart(2, null, 0, 0), 100)).toBe(0)
  })

  it('«Нет» — только кнопкой: отсчёта нет, сами не открываются', () => {
    let s = revealStart(3, null, 0, 0)
    expect(s.due).toBeNull()
    expect(secondsLeft(s, 0)).toBeNull()
    expect(revealTick(s, 1e9).opened).toBe(0)
    s = openNext(s, 10)
    s = openNext(s, 20)
    s = openNext(s, 30)
    s = openNext(s, 40)
    expect(s.opened).toBe(3)
  })

  it('«Открыть сейчас» открывает следующий, отсчёт до следующего — заново', () => {
    let s = revealStart(3, 5 * S, 0, 0)
    s = openNow(s, 2000)
    expect(s.opened).toBe(1)
    expect(s.due).toBe(7000)
    expect(secondsLeft(s, 2000)).toBe(5)
  })

  it('«Открыть сейчас» во время переворота — стол сразу целиком, следующий не открывается', () => {
    let s = revealStart(3, 5 * S, FLIP, 0)
    s = revealTick(s, 5000)
    s = openNow(s, 5300)
    expect(s.opened).toBe(1)
    expect(turning(s, 5300)).toBe(false)
    expect(cardsShown(s, 5300)).toBe(5)
    expect(s.due).toBe(5300 + 5000)
  })

  it('«Открыть сейчас» во время переворота последнего — итог сразу', () => {
    let s = revealStart(1, 5 * S, FLIP, 0)
    s = revealTick(s, 5000)
    expect(allShown(s, 5100)).toBe(false)
    s = openNow(s, 5100)
    expect(allShown(s, 5100)).toBe(true)
    expect(s.due).toBeNull()
  })

  it('кнопкой во время переворота — следующий стол, прошлый уже целиком', () => {
    let s = revealStart(3, null, FLIP, 0)
    s = openNext(s, 0)
    s = openNext(s, 300)
    expect(s.opened).toBe(2)
    expect(cardsShown(s, 300)).toBe(1)
  })

  it('«Пауза» — отсчёт стоит; «Продолжить» — заново с полного промежутка', () => {
    let s = revealStart(3, 5 * S, 0, 0)
    s = revealPause(s)
    expect(s.due).toBeNull()
    expect(secondsLeft(s, 4000)).toBeNull()
    expect(revealTick(s, 1e9).opened).toBe(0)
    expect(nextWake(s, 4000)).toBeNull()
    s = revealResume(s, 20_000)
    expect(s.due).toBe(25_000)
    expect(revealTick(s, 25_000).opened).toBe(1)
  })

  it('на паузе «Открыть сейчас» открывает стол, пауза остаётся', () => {
    let s = revealPause(revealStart(3, 5 * S, 0, 0))
    s = openNow(s, 1000)
    expect(s.opened).toBe(1)
    expect(s.paused).toBe(true)
    expect(s.due).toBeNull()
  })

  it('ушли с экрана — отсчёт стоит; вернулись — с того же места, пропущенные разом не открываются', () => {
    let s = revealStart(3, 5 * S, 0, 0)
    s = revealHold(s, 2000)
    expect(s.held).toBe(3000)
    expect(secondsLeft(s, 2000)).toBe(3)
    expect(revealTick(s, 60_000).opened).toBe(0)
    s = revealRelease(s, 60_000)
    expect(s.due).toBe(63_000)
    expect(revealTick(s, 62_999).opened).toBe(0)
    s = revealTick(s, 63_000)
    expect(s.opened).toBe(1)
    // Срок прошёл давно (телефон спал) — открывается один, следующий — через промежуток
    s = revealTick(s, 200_000)
    expect(s.opened).toBe(2)
    expect(s.due).toBe(205_000)
  })

  it('на паузе уход с экрана ничего не меняет', () => {
    const s = revealPause(revealStart(3, 5 * S, 0, 0))
    expect(revealRelease(revealHold(s, 1000), 9000)).toEqual(s)
  })

  it('один стол — открывается сам один раз', () => {
    let s = revealStart(1, 3 * S, 0, 0)
    s = revealTick(s, 3000)
    expect(s.opened).toBe(1)
    expect(s.due).toBeNull()
    expect(revealTick(s, 1e9).opened).toBe(1)
  })

  it('смена промежутка посреди раунда: «Нет» снимает отсчёт, другое — заново с нового', () => {
    let s = revealStart(3, 5 * S, 0, 0)
    s = revealEvery(s, null, 1000)
    expect(s.due).toBeNull()
    s = revealEvery(s, 10 * S, 2000)
    expect(s.due).toBe(12_000)
    expect(revealEvery(revealPause(s), 3 * S, 3000).due).toBeNull()
  })

  it('часы экрана будят на смене секунды и на сроке', () => {
    const s = revealStart(2, 5 * S, 0, 0)
    expect(nextWake(s, 0)).toBe(1000)
    expect(nextWake(s, 4200)).toBe(800)
    expect(nextWake(s, 5000)).toBe(0)
    // Пока идёт раздача — до начала отсчёта
    expect(nextWake(revealStart(2, 5 * S, 0, 0, 1500), 0)).toBe(1500)
  })
})
