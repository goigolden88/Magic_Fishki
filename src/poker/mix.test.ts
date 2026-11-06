import { describe, expect, it } from 'vitest'
import { deckFor, HOLDEM_GAME, OMAHA_GAME, SHORT_DECK_GAME } from './game'
import { MIX_VOTE_MS, mixPasses } from './mix'
import { PROTOCOL_VERSION, VERSION_ERROR, type ClientBody } from './protocol'
import { DEFAULT_TOURNAMENT } from './tournament'
import {
  AUTO_START_MS,
  createTable,
  handle,
  limitFor,
  mixProposeError,
  mixProposer,
  nextDeadline,
  onTime,
  type Settings,
  type TableState,
} from './table'
import { fold, MODES, newTable, play, start, type Step } from './testing'

const MIX: Partial<Settings> = { cards: 'phones', mix: true }

const msg = (from: string, body: ClientBody, now = 0): Step => ({ from, msg: body, now })
const propose = (from: string, game: 'holdem' | 'omaha' | 'shortdeck', now = 0) => msg(from, { type: 'mixPropose', game }, now)
const vote = (from: string, yes: boolean, now = 0) => msg(from, { type: 'mixVote', yes }, now)

// Отказ — текст
const refuse = (s: TableState, from: string, body: Record<string, unknown>, now = 0, deck?: string[]) => {
  const r = handle(s, from, { v: PROTOCOL_VERSION, ...body }, now, deck as never)
  return r.ok ? null : r.error
}

// Четверо; первая раздача холдема: кнопка p0, малый p1, большой p2, первым p3 — все сбросили до большого
const afterHand = (rt: boolean, settings: Partial<Settings> = {}) =>
  play(newTable(['p0', 'p1', 'p2', 'p3'], { ...MIX, ...settings }), [start('p0', deckFor(HOLDEM_GAME)), fold('p3'), fold('p0'), fold('p1')], rt)

describe('доля «против»', () => {
  it('смена — если против не больше доли всех голосовавших', () => {
    expect(mixPasses(2, 4)).toBe(true) // половина из четырёх — проходит
    expect(mixPasses(3, 4)).toBe(false)
    expect(mixPasses(2, 5)).toBe(true)
    expect(mixPasses(3, 5)).toBe(false)
    expect(mixPasses(1, 3, 'third')).toBe(true)
    expect(mixPasses(2, 4, 'third')).toBe(false)
    expect(mixPasses(4, 6, 'twothirds')).toBe(true)
    expect(mixPasses(5, 6, 'twothirds')).toBe(false)
  })
})

describe.each(MODES)('«Микс» (%s)', (_, rt) => {
  it('предлагает батон прошлой раздачи, одну из других игр; остальные голосуют', () => {
    const s = afterHand(rt)
    expect(s.hand).toBeNull()
    expect(mixProposer(s)).toBe('p0')
    expect(mixProposeError(s, 'p1')).toBe('Игру предлагает батон прошлой раздачи')
    expect(refuse(s, 'p1', { type: 'mixPropose', game: 'omaha' })).toBe('Игру предлагает батон прошлой раздачи')
    expect(refuse(s, 'p0', { type: 'mixPropose', game: 'holdem' })).toBe('Эта игра уже идёт — выберите другую')
    expect(refuse(s, 'p0', { type: 'mixPropose', game: 'stud' })).toBe('Игра — холдем, омаха или шорт-дек')
    const v = play(s, [propose('p0', 'omaha', 1000)], rt)
    expect(v.mixVote).toEqual({ after: 1, by: 'p0', from: 'holdem', game: 'omaha', deadline: 1000 + MIX_VOTE_MS, voters: ['p1', 'p2', 'p3'], answers: {} })
    expect(nextDeadline(v)).toBe(1000 + MIX_VOTE_MS)
    expect(refuse(v, 'p0', { type: 'mixPropose', game: 'shortdeck' })).toBe('Голосование уже идёт')
    expect(refuse(v, 'p0', { type: 'mixVote', yes: true })).toBe('Вы в этом голосовании не участвуете')
  })

  it('до раздач, во время раздачи и без «Микса» — предложить нельзя', () => {
    const fresh = newTable(['p0', 'p1'], MIX)
    expect(mixProposer(fresh)).toBeNull()
    expect(refuse(fresh, 'p0', { type: 'mixPropose', game: 'omaha' })).toBe('Игру предлагают после раздачи')
    const dealing = play(fresh, [start('p0', deckFor(HOLDEM_GAME))], rt)
    expect(refuse(dealing, 'p0', { type: 'mixPropose', game: 'omaha' })).toBe('Игру предлагают между раздачами')
    const off = play(newTable(['p0', 'p1', 'p2', 'p3'], { cards: 'phones' }), [start('p0', deckFor(HOLDEM_GAME)), fold('p3'), fold('p0'), fold('p1')], rt)
    expect(mixProposer(off)).toBeNull()
    expect(refuse(off, 'p0', { type: 'mixPropose', game: 'omaha' })).toBe('«Микс» за этим столом выключен')
  })

  it('против не больше половины — следующая раздача новой игрой: колода, четыре карты, пот-лимит', () => {
    const s = play(afterHand(rt), [propose('p0', 'omaha'), vote('p1', false), vote('p2', false), vote('p3', true)], rt)
    expect(s.mixVote).toBeNull()
    expect(s.mixResult).toEqual({ after: 1, from: 'holdem', game: 'omaha', changed: true, against: 2, total: 4 })
    expect(s.settings.game).toBe('omaha')
    expect(limitFor(s.settings)).toBe('pot')
    const next = play(s, [start('p0', deckFor(OMAHA_GAME))], rt)
    expect(next.hand?.cards?.game.id).toBe('omaha')
    expect(next.hand?.limit).toBe('pot')
    expect(next.hand?.cards?.hole.p2).toHaveLength(4)
  })

  it('против больше доли — остаёмся в прежней игре; игра держится, пока следующий батон не предложит', () => {
    const stay = play(afterHand(rt), [propose('p0', 'omaha'), vote('p1', false), vote('p2', false), vote('p3', false)], rt)
    expect(stay.mixResult).toMatchObject({ from: 'holdem', game: 'omaha', changed: false, against: 3, total: 4 })
    expect(stay.settings.game ?? 'holdem').toBe('holdem')
    expect(refuse(stay, 'p0', { type: 'mixPropose', game: 'shortdeck' })).toBe('Игру уже выбирали — следующий батон предложит после раздачи')
    // Треть: двое против из четырёх — уже много
    const third = play(afterHand(rt, { mixAgainst: 'third' }), [propose('p0', 'omaha'), vote('p1', false), vote('p2', false), vote('p3', true)], rt)
    expect(third.mixResult?.changed).toBe(false)
    // Вторая раздача: кнопка p1, малый p2, большой p3, первым p0 — новый батон p1 предлагает шорт-дек
    const changed = play(afterHand(rt), [propose('p0', 'omaha'), vote('p1', true), vote('p2', true), vote('p3', true)], rt)
    const second = play(changed, [start('p0', deckFor(OMAHA_GAME)), fold('p0'), fold('p1'), fold('p2')], rt)
    expect(second.settings.game).toBe('omaha')
    expect(mixProposer(second)).toBe('p1')
    const third2 = play(second, [propose('p1', 'shortdeck'), vote('p0', true), vote('p2', true), vote('p3', true)], rt)
    expect(third2.settings.game).toBe('shortdeck')
    // Колода шорт-дека — 36 карт: полная колода холдема уже не подходит
    expect(refuse(third2, 'p0', { type: 'start' }, 0, deckFor(HOLDEM_GAME))).toBe('Нет колоды — раздача не начата')
    const sd = play(third2, [start('p0', deckFor(SHORT_DECK_GAME))], rt)
    expect(sd.hand?.cards?.game.id).toBe('shortdeck')
    expect(sd.hand?.cards?.hole.p0).toHaveLength(2)
    expect(sd.hand?.limit ?? 'nolimit').toBe('nolimit') // пот-лимит омахи не тянется в шорт-дек
  })

  it('не ответил до срока — «За»; будильник подводит итог, раньше срока — нет', () => {
    const s = play(afterHand(rt), [propose('p0', 'omaha', 1000), vote('p1', false, 2000)], rt)
    expect(s.mixVote?.answers).toEqual({ p1: false })
    expect(onTime(s, 1000 + MIX_VOTE_MS - 1)).toBeNull()
    const done = onTime(rt ? JSON.parse(JSON.stringify(s)) : s, 1000 + MIX_VOTE_MS)!
    expect(done.mixVote).toBeNull()
    expect(done.mixResult).toMatchObject({ changed: true, against: 1, total: 4 })
    expect(done.settings.game).toBe('omaha')
    expect(onTime(done, 1000 + MIX_VOTE_MS + 1)).toBeNull()
  })

  it('раздача «сама» ждёт конца голосования, ведущий не начинает раздачу до итога', () => {
    const s = afterHand(rt, { autoStart: 'fast' })
    expect(s.nextHandAt).toBe(AUTO_START_MS.fast)
    const v = play(s, [propose('p0', 'omaha', 1000)], rt)
    expect(v.nextHandAt).toBeNull()
    expect(refuse(v, 'p0', { type: 'start' }, 1000, deckFor(HOLDEM_GAME))).toBe(
      'Идёт голосование за игру — дождитесь итога или нажмите «Без смены»',
    )
    // Ответили все — итог сразу, раздача «сама» — через полную паузу от него
    const done = play(v, [vote('p1', true, 2000), vote('p2', true, 3000), vote('p3', true, 4000)], rt)
    expect(done.nextHandAt).toBe(4000 + AUTO_START_MS.fast)
    // По сроку — тоже через паузу
    const timed = onTime(v, 1000 + MIX_VOTE_MS)!
    expect(timed.nextHandAt).toBe(1000 + MIX_VOTE_MS + AUTO_START_MS.fast)
    const dealt = onTime(timed, 1000 + MIX_VOTE_MS + AUTO_START_MS.fast, deckFor(OMAHA_GAME))!
    expect(dealt.hand?.cards?.game.id).toBe('omaha')
  })

  it('«Без смены» — только ведущий: голосование прервано, игра прежняя', () => {
    const v = play(afterHand(rt), [propose('p0', 'omaha'), vote('p1', true)], rt)
    expect(refuse(v, 'p1', { type: 'mixCancel' })).toBe('Это может только ведущий')
    const s = play(v, [msg('p0', { type: 'mixCancel' })], rt)
    expect(s.mixVote).toBeNull()
    expect(s.mixResult).toMatchObject({ from: 'holdem', game: 'omaha', changed: false, cancelled: true })
    expect(s.settings.game ?? 'holdem').toBe('holdem')
    expect(refuse(s, 'p0', { type: 'mixCancel' })).toBe('Голосования сейчас нет')
    expect(refuse(s, 'p1', { type: 'mixVote', yes: true })).toBe('Голосования сейчас нет')
  })

  it('ушёл голосующий — итог без него, когда ответили остальные', () => {
    const s = play(afterHand(rt), [propose('p0', 'omaha'), vote('p1', false), vote('p2', true), msg('p0', { type: 'remove', playerId: 'p3' })], rt)
    expect(s.mixVote).toBeNull()
    expect(s.mixResult).toMatchObject({ changed: true, against: 1, total: 3 })
  })

  it('турнир — «Микс» тоже есть', () => {
    const t = { format: 'tournament' as const, tournament: { ...DEFAULT_TOURNAMENT, buyIn: 500 } }
    const s = play(afterHand(rt, t), [propose('p0', 'shortdeck'), vote('p1', true), vote('p2', true), vote('p3', true)], rt)
    expect(s.settings.game).toBe('shortdeck')
  })
})

describe('«Микс»: настройки и версия', () => {
  it('только с картами на телефонах; доля — из списка', () => {
    expect(createTable('h', 'H', { mix: true }, 0)).toEqual({ ok: false, error: '«Микс» — только с картами на телефонах' })
    expect(createTable('h', 'H', { ...MIX, mixAgainst: 'all' as never }, 0)).toEqual({
      ok: false,
      error: 'Сменить игру, если против не больше трети, половины или двух третей',
    })
    expect(createTable('h', 'H', { ...MIX, mixAgainst: 'twothirds' }, 0).ok).toBe(true)
  })

  it('старая копия приложения — «обновите приложение»', () => {
    const s = afterHand(false)
    expect(PROTOCOL_VERSION).toBe(16)
    const r = handle(s, 'p0', { v: 15, type: 'mixPropose', game: 'omaha' }, 0)
    expect(r).toEqual({ ok: false, error: VERSION_ERROR })
  })
})
