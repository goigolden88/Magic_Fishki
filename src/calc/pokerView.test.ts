import { describe, expect, it } from 'vitest'
import { SHORT_DECK } from '../poker/cards'
import { finishedHand, handFor, keepHand, type HistoryHand } from '../poker/history'
import { allin, award, call, check, fold, newTable, play, raise, stackedDeck, start, type Step } from '../poker/testing'
import { hiddenOf, HOST_TAKEOVER_MS, onTime, viewFor, type TableState } from '../poker/table'
import type { SavedHand } from './evenings'
import {
  cardFace,
  defaultWinners,
  finalStacks,
  historyHandView,
  historyList,
  lastHandRecord,
  lastHandWins,
  liveHandView,
  myTurnMark,
  positionLabels,
  tableView,
  toggleWinner,
  winnersReady,
} from './pokerView'

const three = (stacks: Record<string, number> = {}) => newTable(['p0', 'p1', 'p2'], {}, stacks)

// Запись раздачи, как в копии на телефоне; без стола вечера — как записи до Р-54
const savedOf = (hand: HistoryHand): SavedHand => ({ evening: 'e', code: null, startedAt: 0, number: hand.number, hand })

describe('экран стола', () => {
  it('префлоп: кнопка, блайнды, банк, чей ход; кнопки хода — у того, чей ход', () => {
    const s = play(three(), [start('p0')], false)
    const v = tableView(s, 'p0', 0)
    expect(v.seats.map((x) => [x.name, x.chips, x.bet, x.button, x.position, x.toAct])).toEqual([
      ['P0', 1000, 0, true, 'BTN', true],
      ['P1', 995, 5, false, 'SB', false],
      ['P2', 990, 10, false, 'BB', false],
    ])
    expect([v.stageLabel, v.handNumber, v.pot, v.toActName]).toEqual(['Префлоп', 1, 15, 'P0'])
    expect(v.pots).toEqual([])
    expect(v.actions).toEqual({
      myTurn: true,
      check: false,
      call: 10,
      raise: {
        label: 'Рейз',
        min: 20,
        max: 1000,
        allIn: true,
        potLimit: null,
        // До флопа — «Мин» и множители ББ (Р-62)
        quick: [
          { label: 'Мин', to: 20 },
          { label: '2,5 ББ', to: 25 },
          { label: '3 ББ', to: 30 },
          { label: '4 ББ', to: 40 },
        ],
        // Ползунок (Р-69): банк после колла — 15 + 10; прилипает к быстрым суммам до флопа
        spot: { preflop: true, currentBet: 10, pot: 25, bb: 10, pre: [25, 30, 40] },
      },
      allIn: 1000,
    })
    // Не мой ход — те же кнопки, неактивны
    expect(tableView(s, 'p1', 0).actions).toMatchObject({ myTurn: false, check: false, call: 5 })
    expect(v.canStart).toBe(false)
  })

  it('хедз-ап: кнопка ставит малый блайнд; на новой улице — «Ставка» и «Чек»', () => {
    const s = play(newTable(['p0', 'p1']), [start('p0'), call('p0')], false)
    expect(tableView(s, 'p0', 0).seats.map((x) => [x.button, x.position, x.bet])).toEqual([
      [true, 'BTN/SB', 10],
      [false, 'BB', 10],
    ])
    const flop = play(s, [{ from: 'p1', msg: { type: 'act', action: { type: 'check' } } }], false)
    const v = tableView(flop, 'p1', 0)
    expect(v.stageLabel).toBe('Флоп')
    expect(v.actions).toMatchObject({ myTurn: true, check: true, call: 0, raise: { label: 'Ставка', min: 10 } })
  })

  it('подписи позиций — по числу играющих, от кнопки по ходу', () => {
    expect(positionLabels(2)).toEqual(['BTN/SB', 'BB'])
    expect(positionLabels(3)).toEqual(['BTN', 'SB', 'BB'])
    expect(positionLabels(4)).toEqual(['BTN', 'SB', 'BB', 'UTG'])
    expect(positionLabels(5)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'CO'])
    expect(positionLabels(6)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'])
    expect(positionLabels(7)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO'])
    expect(positionLabels(8)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'MP', 'LJ', 'HJ', 'CO'])
    expect(positionLabels(9)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'])
  })

  it('позиции на местах: от кнопки; хедз-ап — «BTN/SB» и «BB»; не сданный — без позиции', () => {
    const ids = ['p0', 'p1', 'p2', 'p3', 'p4']
    const five = play(newTable(ids), [start('p0')], false)
    expect(tableView(five, 'p0', 0).seats.map((x) => x.position)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'CO'])
    // Следующая раздача — кнопка у P1
    const next = play(five, [fold('p3'), fold('p4'), fold('p0'), fold('p1'), award('p0', [['p2']]), start('p0')], false)
    expect(tableView(next, 'p0', 0).seats.map((x) => x.position)).toEqual(['CO', 'BTN', 'SB', 'BB', 'UTG'])

    const heads = play(newTable(['p0', 'p1']), [start('p0')], false)
    expect(tableView(heads, 'p1', 0).seats.map((x) => x.position)).toEqual(['BTN/SB', 'BB'])

    const out = play(three(), [{ from: 'p1', msg: { type: 'sitOut', sittingOut: true } }, start('p0')], false)
    expect(tableView(out, 'p0', 0).seats.map((x) => [x.name, x.position, x.sittingOut])).toEqual([
      ['P0', 'BTN/SB', false],
      ['P1', null, true],
      ['P2', 'BB', false],
    ])
    // Между раздачами позиций нет
    expect(tableView(three(), 'p0', 0).seats.map((x) => x.position)).toEqual([null, null, null])
  })

  it('между раздачами: начать может только ведущий и когда двое с фишками', () => {
    const s = three()
    expect(tableView(s, 'p0', 0)).toMatchObject({ canStart: true, isHost: true, stage: null, actions: null, hostName: 'P0' })
    expect(tableView(s, 'p1', 0)).toMatchObject({ canStart: false, isHost: false })
    expect(tableView(newTable(['p0']), 'p0', 0).canStart).toBe(false)
    const out = play(s, [{ from: 'p1', msg: { type: 'sitOut', sittingOut: true } }, { from: 'p2', msg: { type: 'sitOut', sittingOut: true } }], false)
    expect(tableView(out, 'p0', 0).canStart).toBe(false)
  })

  it('побочный банк виден во время торгов, когда кто-то олл-ин; неуравненная ставка — не банк', () => {
    const s = play(three({ p1: 100 }), [start('p0'), call('p0'), allin('p1'), call('p2'), call('p0')], false)
    expect(tableView(s, 'p0', 0)).toMatchObject({ stageLabel: 'Флоп', pot: 300, pots: [] })
    // Флоп: первым ходит P2 (P1 олл-ин)
    const bet = play(s, [raise('p2', 200)], false)
    expect(tableView(bet, 'p0', 0)).toMatchObject({ pot: 500, pots: [] })
    const turn = play(bet, [call('p0')], false)
    expect(tableView(turn, 'p0', 0).pots).toEqual([
      {
        label: 'Основной банк',
        amount: 300,
        eligible: [
          { id: 'p0', name: 'P0' },
          { id: 'p1', name: 'P1' },
          { id: 'p2', name: 'P2' },
        ],
      },
      {
        label: 'Побочный банк',
        amount: 400,
        eligible: [
          { id: 'p0', name: 'P0' },
          { id: 'p2', name: 'P2' },
        ],
      },
    ])
    expect(tableView(turn, 'p1', 0).actions).toBeNull() // олл-ин — ходить нечем
  })

  it('неполный олл-ин не открывает торги ходившему: только колл или пас', () => {
    const s = play(three({ p1: 150 }), [start('p0'), raise('p0', 100), allin('p1'), call('p2')], false)
    expect(tableView(s, 'p0', 0).actions).toEqual({ myTurn: true, check: false, call: 50, raise: null, allIn: null })
  })

  it('не хватает на минимальный рейз — только олл-ин', () => {
    const s = play(three({ p0: 15 }), [start('p0')], false)
    expect(tableView(s, 'p0', 0).actions).toMatchObject({ call: 10, raise: null, allIn: 15 })
  })

  it('торги закрыты: банк с одним претендентом отмечен сам; «Раздать» — когда отмечены все', () => {
    const s = play(three(), [start('p0'), fold('p0'), fold('p1')], false)
    const v = tableView(s, 'p0', 0)
    expect([v.stage, v.stageLabel, v.actions, v.toActName]).toEqual(['showdown', 'Торги закрыты', null, null])
    expect(v.pots).toEqual([{ label: 'Банк', amount: 10, eligible: [{ id: 'p2', name: 'P2' }] }])
    expect(defaultWinners(s)).toEqual([['p2']])
    expect(winnersReady(s, defaultWinners(s))).toBe(true)

    const many = play(three({ p1: 100 }), [start('p0'), call('p0'), allin('p1'), call('p2'), call('p0')], false)
    const down = play(many, [raise('p2', 200), call('p0'), raise('p2', 700), call('p0')], false)
    expect(down.hand?.stage).toBe('showdown')
    expect(tableView(down, 'p0', 0).pots.map((p) => [p.label, p.amount])).toEqual([
      ['Основной банк', 300],
      ['Побочный банк', 1800],
    ])
    let winners = defaultWinners(down)
    expect(winners).toEqual([[], []])
    expect(winnersReady(down, winners)).toBe(false)
    winners = toggleWinner(winners, 0, 'p1')
    winners = toggleWinner(winners, 1, 'p0')
    winners = toggleWinner(winners, 1, 'p2')
    expect(winners).toEqual([['p1'], ['p0', 'p2']])
    expect(winnersReady(down, winners)).toBe(true)
    expect(toggleWinner(winners, 1, 'p0')).toEqual([['p1'], ['p2']])
  })

  it('«Взять ведение» — у остальных, когда ведущий вне сети дольше минуты', () => {
    const s = play(three(), [{ from: 'p0', online: false, now: 1000 }], false)
    expect(tableView(s, 'p1', 1000 + HOST_TAKEOVER_MS).canTakeHost).toBe(false)
    expect(tableView(s, 'p1', 1001 + HOST_TAKEOVER_MS).canTakeHost).toBe(true)
    expect(tableView(s, 'p0', 1001 + HOST_TAKEOVER_MS).canTakeHost).toBe(false)
    expect(tableView(s, 'p1', 1001 + HOST_TAKEOVER_MS).seats[0]).toMatchObject({ online: false, isHost: true })
  })

  it('запрос докупа: ведущий видит, кто и сколько; игрок — что ждёт', () => {
    const s = play(three(), [{ from: 'p1', msg: { type: 'rebuy', amount: 500 } }], false)
    expect(tableView(s, 'p0', 0).rebuyRequests).toEqual([{ playerId: 'p1', name: 'P1', amount: 500 }])
    expect(tableView(s, 'p1', 0).myRebuy).toBe(500)
    expect(tableView(s, 'p2', 0).myRebuy).toBeNull()
  })

  it('итог прошлой раздачи и стеки на конец игры', () => {
    const s = play(three(), [start('p0'), fold('p0'), fold('p1'), award('p0', [['p2']])], false)
    // Банк 10: неуравненные 5 из большого блайнда вернулись P2 до банка
    expect(lastHandWins(s)).toEqual([{ name: 'P2', amount: 10 }])
    expect(finalStacks(s)).toEqual([
      { name: 'P0', chips: 1000, buyIn: 1000, diff: 0 },
      { name: 'P1', chips: 995, buyIn: 1000, diff: -5 },
      { name: 'P2', chips: 1005, buyIn: 1000, diff: 5 },
    ])
    // Между раздачами кнопка — у места прошлой раздачи
    expect(tableView(s, 'p0', 0).seats.map((x) => x.button)).toEqual([true, false, false])
  })
})

describe('экран стола: карты на телефонах', () => {
  const PHONES = { cards: 'phones' as const }
  // Кнопка p0, сдача с p1: p1 — Kh Qh, p2 — 2c 7d, p0 — Ah Ad
  const deck = stackedDeck([['Kh', 'Qh'], ['2c', '7d'], ['Ah', 'Ad']], ['2s', '7h', '9d', 'Jc', '3s'])

  it('в раздаче: у мест рубашки, свои — под пальцем, сбросивший — без карт; общие — по улицам', () => {
    let s = play(newTable(['p0', 'p1', 'p2'], PHONES), [start('p0', deck)], false)
    const v = tableView(viewFor(s, 'p1'), 'p1', 0)
    expect(v.phoneCards).toBe(true)
    expect(v.seats.map((x) => x.cards)).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ])
    expect(v.myCards).toEqual(['Kh', 'Qh'])
    expect(v.board).toEqual([])
    s = play(s, [call('p0'), fold('p1'), check('p2')], false)
    const flop = tableView(viewFor(s, 'p0'), 'p0', 0)
    expect(flop.board).toEqual(['2s', '7h', '9d'])
    expect(flop.seats.map((x) => x.cards)).toEqual([[null, null], null, [null, null]])
    expect(flop.myCards).toEqual(['Ah', 'Ad'])
    expect(flop.canShow).toBeNull()
  })

  it('после вскрытия: карты дошедших и что у них — у мест и в записи прошлой раздачи', () => {
    const steps = [start('p0', deck), call('p0'), fold('p1'), check('p2'), raise('p2', 20), call('p0')]
    for (let k = 0; k < 2; k++) steps.push(check('p2'), check('p0'))
    const s = play(newTable(['p0', 'p1', 'p2'], PHONES), steps, false)
    const v = tableView(viewFor(s, 'p1'), 'p1', 0)
    expect(v.stage).toBeNull()
    expect(v.board).toEqual(['2s', '7h', '9d', 'Jc', '3s'])
    expect(v.seats.map((x) => [x.cards, x.handName])).toEqual([
      [['Ah', 'Ad'], 'Пара, тузы'],
      [null, null],
      [['2c', '7d'], 'Две пары, семёрки и двойки'],
    ])
    expect(v.myCards).toBeNull()
    // Пятёрка — только у победителя; на столе подсвечены её карты
    const five = ['7d', '7h', '2c', '2s', 'Jc']
    expect(v.seats.map((x) => x.best)).toEqual([null, null, five])
    expect(v.boardWin).toEqual(['2s', '7h', 'Jc'])
    expect(lastHandRecord(viewFor(s, 'p1'))).toEqual({
      number: 1,
      board: ['2s', '7h', '9d', 'Jc', '3s'],
      players: [
        { name: 'P0', cards: ['Ah', 'Ad'], hand: 'Пара, тузы', best: null, won: 0 },
        { name: 'P1', cards: null, hand: null, best: null, won: 0 },
        { name: 'P2', cards: ['2c', '7d'], hand: 'Две пары, семёрки и двойки', best: five, won: 65 },
      ],
      rounds: [
        { label: 'Префлоп', moves: ['P0: колл до 10', 'P1: пас', 'P2: чек'] },
        { label: 'Флоп', moves: ['P2: рейз до 20', 'P0: колл до 20'] },
        { label: 'Тёрн', moves: ['P2: чек', 'P0: чек'] },
        { label: 'Ривер', moves: ['P2: чек', 'P0: чек'] },
      ],
      odds: null, // торги закрылись на ривере
    })
  })

  it('ва-банк до ривера (#116): шансы дошедших — в прошлой раздаче и в той же раздаче из истории', () => {
    const steps = [start('p0', deck), call('p0'), fold('p1'), check('p2'), allin('p2'), call('p0')]
    const s = play(newTable(['p0', 'p1', 'p2'], PHONES), steps, false)
    const odds = lastHandRecord(viewFor(s, 'p1'))?.odds
    expect(odds).toMatch(/^Шансы на ва-банке \(флоп\): P0 \d+ %, P2 \d+ %$/)
    const [p0, p2] = [...(odds ?? '').matchAll(/(\d+) %/g)].map((m) => Number(m[1]))
    expect(p0 + p2).toBe(100)
    expect(p2).toBeGreaterThan(p0) // у P2 две пары против пары тузов
    const before = play(newTable(['p0', 'p1', 'p2'], PHONES), steps.slice(0, -1), false)
    const history = keepHand([], finishedHand(before, s))
    expect(historyHandView(savedOf(handFor(history[0], 'p1'))).odds).toBe(odds)
  })

  it('побочный банк: пятёрка — у победителя каждого банка, на столе — карты обеих пятёрок', () => {
    // p0 — короткий: тройка тузов берёт основной; побочный p1 и p2 — у p1 две пары, у p2 пара королей
    const side = stackedDeck([['Tc', 'Js'], ['Kd', 'Kh'], ['Ah', 'Ad']], ['As', 'Th', 'Jd', '4c', '3s'])
    const s = play(newTable(['p0', 'p1', 'p2'], PHONES, { p0: 100, p1: 300, p2: 300 }), [start('p0', side), allin('p0'), allin('p1'), call('p2')], false)
    expect(s.lastHand?.pots.map((p) => p.winners)).toEqual([['p0'], ['p1']])
    const v = tableView(viewFor(s, 'p2'), 'p2', 0)
    expect(v.seats.map((x) => x.best)).toEqual([['Ah', 'Ad', 'As', 'Jd', 'Th'], ['Js', 'Jd', 'Tc', 'Th', 'As'], null])
    expect(v.boardWin).toEqual(['As', 'Th', 'Jd'])
  })

  it('запись раздачи до пятёрок (#96) — только подписи, без ошибки', () => {
    const steps = [start('p0', deck), call('p0'), fold('p1'), check('p2'), raise('p2', 20), call('p0')]
    for (let k = 0; k < 2; k++) steps.push(check('p2'), check('p0'))
    const s = viewFor(play(newTable(['p0', 'p1', 'p2'], PHONES), steps, false), 'p1')
    delete s.lastHand?.record?.best
    const v = tableView(s, 'p1', 0)
    expect(v.seats.map((x) => [x.handName, x.best])).toEqual([
      ['Пара, тузы', null],
      [null, null],
      ['Две пары, семёрки и двойки', null],
    ])
    expect(v.boardWin).toBeNull()
    expect(lastHandRecord(s)?.players.map((p) => [p.hand, p.best])).toEqual([
      ['Пара, тузы', null],
      [null, null],
      ['Две пары, семёрки и двойки', null],
    ])
  })

  it('банк без вскрытия: «Показать» — у взявшего и у сбросивших (#278), каждому — свои', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], PHONES), [start('p0', deck), raise('p0', 30), fold('p1'), fold('p2')], false)
    const folded = tableView(viewFor(s, 'p1'), 'p1', 0)
    expect([folded.boardWin, folded.seats.map((x) => x.best)]).toEqual([null, [null, null, null]]) // пятёрки нет
    expect(tableView(viewFor(s, 'p0'), 'p0', 0).canShow).toEqual({ cards: ['Ah', 'Ad'], shown: [false, false], won: true })
    const p1 = hiddenOf(s.lastHand?.record).p1
    expect(folded.canShow).toEqual({ cards: p1, shown: [false, false], won: false })
    const shown = play(s, [{ from: 'p0', msg: { type: 'show', cards: [1] } }], false)
    expect(tableView(viewFor(shown, 'p0'), 'p0', 0).canShow).toEqual({ cards: ['Ah', 'Ad'], shown: [false, true], won: true })
    expect(tableView(viewFor(shown, 'p1'), 'p1', 0).seats[0].cards).toEqual([null, 'Ad'])
    // Сбросивший показал обе — карточки больше нет, карты у его места видны всем
    const both = play(shown, [{ from: 'p1', msg: { type: 'show', cards: [0, 1] } }], false)
    expect(tableView(viewFor(both, 'p1'), 'p1', 0).canShow).toBeNull()
    expect(tableView(viewFor(both, 'p2'), 'p2', 0).seats[1].cards).toEqual(p1)
    expect(lastHandRecord(viewFor(both, 'p2'))?.players[1].cards).toEqual(p1)
    // Новая раздача — карточки нет
    const next = play(both, [start('p0', deck)], false)
    expect(tableView(viewFor(next, 'p2'), 'p2', 0).canShow).toBeNull()
  })

  it('моя комбинация сейчас (#105): с флопа и по улицам; префлоп, пас и чужие места — без неё', () => {
    let s = play(newTable(['p0', 'p1', 'p2'], PHONES), [start('p0', deck)], false)
    expect(tableView(viewFor(s, 'p0'), 'p0', 0).myHand).toBeNull() // префлоп
    s = play(s, [call('p0'), fold('p1'), check('p2')], false)
    const flop = tableView(viewFor(s, 'p0'), 'p0', 0)
    expect(flop.myHand).toBe('Пара, тузы')
    expect(flop.seats.every((x) => x.handName === null)).toBe(true) // у мест подписи нет
    expect(tableView(viewFor(s, 'p2'), 'p2', 0).myHand).toBe('Две пары, семёрки и двойки')
    expect(tableView(viewFor(s, 'p1'), 'p1', 0).myHand).toBeNull() // спасовал
    s = play(s, [check('p2'), check('p0')], false)
    expect(tableView(viewFor(s, 'p0'), 'p0', 0).myHand).toBe('Пара, тузы') // тёрн: Jc
    s = play(s, [check('p2'), check('p0')], false)
    expect(s.hand?.stage).toBe('river')
    expect(tableView(viewFor(s, 'p2'), 'p2', 0).myHand).toBe('Две пары, семёрки и двойки') // ривер: 3s
  })

  it('моя комбинация: тёрн меняет её; омаха — две из руки, шорт-дек — свой порядок', () => {
    // Хедз-ап: кнопка p0, сдача с p1; hole — [карты p1, карты p0]
    const omaha = stackedDeck([['Kh', 'Kc', 'Qd', 'Js'], ['9c', '9d', 'Ts', '8s']], ['Ah', '9h', '6h', '3h', '2c'])
    let s = play(newTable(['p0', 'p1'], { cards: 'phones', game: 'omaha' }), [start('p0', omaha), call('p0'), check('p1')], false)
    expect(tableView(viewFor(s, 'p0'), 'p0', 0).myHand).toBe('Тройка, девятки')
    s = play(s, [check('p1'), check('p0')], false)
    // На столе четыре черви, у p1 одна — по омахе флеша нет
    expect(tableView(viewFor(s, 'p1'), 'p1', 0).myHand).toBe('Пара, короли')

    const short = stackedDeck([['Ad', '9c'], ['Kd', 'Ks']], ['6c', '7d', '8s', 'Kh', 'Qc'], SHORT_DECK)
    s = play(newTable(['p0', 'p1'], { cards: 'phones', game: 'shortdeck' }), [start('p0', short), call('p0'), check('p1')], false)
    expect(tableView(viewFor(s, 'p1'), 'p1', 0).myHand).toBe('Стрит до девятки') // A-6-7-8-9

    const flush = stackedDeck([['Ah', 'Th'], ['Ks', '9s']], ['Kh', 'Kd', '9h', '7h', '6c'], SHORT_DECK)
    s = play(newTable(['p0', 'p1'], { cards: 'phones', game: 'shortdeck' }), [start('p0', flush), call('p0'), check('p1')], false)
    expect(tableView(viewFor(s, 'p1'), 'p1', 0).myHand).toBe('Пара, короли')
    s = play(s, [check('p1'), check('p0')], false)
    expect(tableView(viewFor(s, 'p1'), 'p1', 0).myHand).toBe('Флеш, старший туз') // тёрн: 7h
    expect(tableView(viewFor(s, 'p0'), 'p0', 0).myHand).toBe('Фулл-хаус, короли и девятки')
  })

  it('живые карты — карт на экране нет', () => {
    const s = play(three(), [start('p0')], false)
    const v = tableView(s, 'p0', 0)
    expect([v.phoneCards, v.board, v.myCards, v.canShow]).toEqual([false, [], null, null])
    const flop = tableView(play(s, [call('p0'), call('p1'), check('p2')], false), 'p1', 0)
    expect([flop.stage, flop.myHand]).toEqual(['flop', null])
    expect(v.seats.every((x) => x.cards === null && x.handName === null)).toBe(true)
    expect(lastHandRecord(s)).toBeNull()
  })

  it('карта на экране: ранг, масть значком, красные — черви и бубны', () => {
    expect(cardFace('Td')).toEqual({ rank: '10', suit: '♦', red: true })
    expect(cardFace('As')).toEqual({ rank: 'A', suit: '♠', red: false })
  })
})

describe('ход раздачи по касанию банка (#258)', () => {
  const PHONES = { cards: 'phones' as const }
  // Кнопка p0, сдача с p1: p1 — Kh Qh, p2 — 2c 7d, p0 — Ah Ad
  const hole = ['Kh', 'Qh', '2c', '7d', 'Ah', 'Ad']
  const deck = stackedDeck([['Kh', 'Qh'], ['2c', '7d'], ['Ah', 'Ad']], ['2s', '7h', '9d', 'Jc', '3s'])
  // Префлоп, флоп с ходами и тёрн с первым ходом
  const toTurn = [start('p0', deck), raise('p0', 30), fold('p1'), call('p2'), check('p2'), raise('p0', 40), call('p2'), check('p2')]
  const turnStreets = [
    { label: 'Префлоп', board: [], pot: 15, moves: ['P0: рейз до 30', 'P1: пас', 'P2: колл до 30'] },
    { label: 'Флоп', board: ['2s', '7h', '9d'], pot: 65, moves: ['P2: чек', 'P0: рейз до 40', 'P2: колл до 40'] },
    { label: 'Тёрн', board: ['2s', '7h', '9d', 'Jc'], pot: 145, moves: ['P2: чек'] },
  ]

  it('из текущей раздачи: улицы по порядку — общие карты, банк на начало, ходы; новая ставка — сразу', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], PHONES), toTurn, false)
    expect(liveHandView(viewFor(s, 'p1'))).toEqual({ number: 1, ended: false, bb: 10, streets: turnStreets, boards: null })
    const next = play(s, [raise('p0', 100)], false)
    expect(liveHandView(viewFor(next, 'p1'))?.streets.at(-1)?.moves).toEqual(['P2: чек', 'P0: рейз до 100'])
    // Префлоп, ходов ещё нет: банк — блайнды
    const pre = play(newTable(['p0', 'p1', 'p2'], PHONES), [start('p0', deck)], false)
    expect(liveHandView(viewFor(pre, 'p0'))?.streets).toEqual([{ label: 'Префлоп', board: [], pot: 15, moves: [] }])
  })

  it('только общее: ни своих, ни чужих закрытых карт — и в полном столе сервера', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], PHONES), toTurn, false)
    expect(s.hand?.cards?.hole.p2).toEqual(['2c', '7d']) // в столе сервера карты есть
    for (const table of [s, viewFor(s, 'p0'), viewFor(s, 'p2'), viewFor(s, null)]) {
      const text = JSON.stringify(liveHandView(table))
      for (const card of hole) expect(text).not.toContain(card)
    }
  })

  it('суммы в ББ раздачи; живые карты — те же ходы и банки, без общих карт', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], PHONES), toTurn, false)
    expect(liveHandView(viewFor(s, 'p1'), true)?.streets[0].moves).toEqual(['P0: рейз до 3 ББ', 'P1: пас', 'P2: колл до 3 ББ'])
    const live = play(three(), toTurn.map((x) => ({ ...x, deck: undefined })), false)
    expect(liveHandView(live)?.streets).toEqual(turnStreets.map((x) => ({ ...x, board: [] })))
  })

  it('раздача кончилась — прошлая целиком, «закончена»; у живых карт журнала прошлой нет', () => {
    const steps = [...toTurn, check('p0'), check('p2'), check('p0')]
    const s = play(newTable(['p0', 'p1', 'p2'], PHONES), steps, false)
    const v = liveHandView(viewFor(s, 'p1'))
    expect(v?.ended).toBe(true)
    expect(v?.number).toBe(1)
    expect(v?.streets.map((x) => [x.label, x.moves.length])).toEqual([
      ['Префлоп', 3],
      ['Флоп', 3],
      ['Тёрн', 2],
      ['Ривер', 2],
    ])
    expect(v?.streets[3].board).toEqual(['2s', '7h', '9d', 'Jc', '3s'])
    const live = play(three(), [...steps.map((x) => ({ ...x, deck: undefined })), award('p0', [['p0']])], false)
    expect(live.hand).toBeNull()
    expect(liveHandView(live)).toBeNull()
  })

  it('настройка стола: нет поля и вкл — панель есть; выкл — нет, а журнал ходов в столе остаётся', () => {
    const on = play(newTable(['p0', 'p1', 'p2'], { ...PHONES, liveHand: true }), toTurn, false)
    expect(liveHandView(on)?.streets).toEqual(turnStreets)
    const off = play(newTable(['p0', 'p1', 'p2'], { ...PHONES, liveHand: false }), toTurn, false)
    expect(liveHandView(off)).toBeNull()
    expect(off.hand?.log).toHaveLength(on.hand?.log.length ?? -1)
    // Ведущий меняет между раздачами
    const changed = play(three(), [{ from: 'p0', msg: { type: 'tableSettings', liveHand: false } }], true)
    expect(changed.settings.liveHand).toBe(false)
    expect(() => play(three(), [{ from: 'p0', msg: { type: 'tableSettings', liveHand: 'да' as unknown as boolean } }], false)).toThrow(
      'Ход раздачи по касанию банка — включён или выключен',
    )
  })
})

describe('экран стола: время на ход, перерыв, раздача «сама»', () => {
  const timed = () => newTable(['p0', 'p1', 'p2'], { turnSeconds: 30, autoStart: 'fast' })

  it('секунды на ход — у того, чей ход, и в центре; округление вверх, после срока — 0', () => {
    const s = play(timed(), [{ ...start('p0'), now: 1000 }], false)
    const v = tableView(s, 'p1', 1000 + 12_300)
    expect(v.turnLeft).toBe(18)
    expect(v.seats.map((x) => x.turnLeft)).toEqual([18, null, null])
    expect(tableView(s, 'p0', 1000 + 29_999).turnLeft).toBe(1)
    expect(tableView(s, 'p0', 1000 + 40_000).turnLeft).toBe(0)
    // Таймер выключен — секунд нет
    const off = tableView(play(three(), [start('p0')], false), 'p0', 0)
    expect([off.turnLeft, off.seats[0].turnLeft, off.paused, off.nextHandLeft]).toEqual([null, null, false, null])
  })

  it('запас времени (#223): пока идёт время на ход — свои секунды и свой запас; пошёл запас — «запас» у места', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], { turnSeconds: 20, timeBank: 30 }), [{ ...start('p0'), now: 1000 }], false)
    const base = tableView(s, 'p0', 1000 + 5000)
    expect([base.turnLeft, base.turnBank, base.myBank]).toEqual([15, false, 30])
    expect(base.seats.map((x) => [x.turnLeft, x.turnBank])).toEqual([
      [15, false],
      [null, false],
      [null, false],
    ])
    // Чужой запас, пока не тратится, не виден: у мест его нет, а свой — у каждого свой
    expect(tableView(s, 'p1', 1000 + 5000).myBank).toBe(30)
    const bank = onTime(s, 1000 + 20_000)!
    const v = tableView(bank, 'p1', 1000 + 20_000 + 7_200) // от времени сервера, как turnLeft
    expect([v.turnLeft, v.turnBank]).toEqual([23, true])
    expect(v.seats.map((x) => [x.turnLeft, x.turnBank])).toEqual([
      [23, true],
      [null, false],
      [null, false],
    ])
    expect(tableView(bank, 'p0', 1000 + 20_000 + 30_000).turnLeft).toBe(0)
    // Запаса за столом нет или я не за столом — моего запаса нет
    expect(tableView(play(timed(), [start('p0')], false), 'p0', 0).myBank).toBeNull()
    expect(tableView(s, 'гость', 0).myBank).toBeNull()
  })

  it('перерыв — у всех «Перерыв», таймер не идёт; раздача «сама» — секунды до неё', () => {
    let s = play(timed(), [start('p0'), fold('p0'), fold('p1'), award('p0', [['p2']], 2000)], false)
    expect(tableView(s, 'p1', 2500).nextHandLeft).toBe(3)
    s = play(s, [{ from: 'p0', msg: { type: 'pause', paused: true } }], false)
    const v = tableView(s, 'p2', 2500)
    expect([v.paused, v.stageLabel, v.nextHandLeft]).toEqual([true, 'Перерыв', null])
  })

  it('метка «ваш ход» — новая на каждый мой ход, иначе null', () => {
    let s = play(timed(), [start('p0')], false)
    expect(myTurnMark(s, 'p0')).toBe('1-0')
    expect(myTurnMark(s, 'p1')).toBeNull()
    s = play(s, [call('p0'), call('p1'), check('p2')], false)
    // Флоп: первым — p1 после кнопки
    expect(myTurnMark(s, 'p1')).toBe('1-3')
  })

  it('ход по таймеру — в «Ходах» с пометкой «время вышло»', () => {
    const deck = stackedDeck([['2c', '3d'], ['Kh', 'Kd'], ['As', 'Ah']])
    let s = play(newTable(['p0', 'p1', 'p2'], { cards: 'phones', turnSeconds: 30 }), [start('p0', deck)], false)
    s = onTime(s, 30_000)! // p0 — пас по времени
    s = play(s, [fold('p1')], false)
    expect(lastHandRecord(s)?.rounds).toEqual([{ label: 'Префлоп', moves: ['P0: пас, время вышло', 'P1: пас'] }])
  })
})

describe('история раздач (#113)', () => {
  // Прогон с историей: после каждого сообщения — запись, как у комнаты и стола на телефоне
  function playKeeping(s: TableState, steps: Step[], history: HistoryHand[]): [TableState, HistoryHand[]] {
    for (const step of steps) {
      const next = play(s, [step], false)
      history = keepHand(history, finishedHand(s, next))
      s = next
    }
    return [s, history]
  }
  const showdown = stackedDeck([['Kh', 'Qh'], ['2c', '7d'], ['Ah', 'Ad']], ['2s', '7h', '9d', 'Jc', '3s'])
  // Вторая раздача: кнопка — p1, сдача с p2; p1 взял банк без вскрытия с Kc Ks
  const quiet = stackedDeck([['5c', '5d'], ['6c', '6d'], ['Kc', 'Ks']])

  it('карты на телефонах: список — новые сверху; раздача — как прошлая, плюс стеки и банки; без вскрытия — карты только взявшему', () => {
    const steps = [start('p0', showdown), call('p0'), fold('p1'), check('p2'), raise('p2', 20), call('p0')]
    for (let k = 0; k < 2; k++) steps.push(check('p2'), check('p0'))
    let [s, history] = playKeeping(newTable(['p0', 'p1', 'p2'], { cards: 'phones' }), steps, [])
    const last = lastHandRecord(viewFor(s, 'p1'))
    ;[s, history] = playKeeping(s, [start('p0', quiet), raise('p1', 30), fold('p2'), fold('p0')], history)

    // Записи телефона P1 без стола вечера (до Р-54): «я» — чьи закрытые в записи; в первой он сбросил (#278)
    expect(historyList(history.map((h) => savedOf(handFor(h, 'p1'))))).toEqual([
      { number: 2, board: [], wins: [{ name: 'P1', amount: 25 }], mine: { cards: ['Kc', 'Ks'], position: 'BTN', net: 15, bb: 10 } },
      { number: 1, board: ['2s', '7h', '9d', 'Jc', '3s'], wins: [{ name: 'P2', amount: 65 }], mine: { cards: ['Kh', 'Qh'], position: 'SB', net: -5, bb: 10 } },
    ])
    // У своего места в истории — и свои сброшенные (#278): блок «Показали» их не берёт, они в «Вам сдано»
    expect(historyHandView(savedOf(handFor(history[0], 'p1')))).toMatchObject({
      ...last,
      players: last!.players.map((p, i) => (i === 1 ? { ...p, cards: ['Kh', 'Qh'] } : p)),
      chips: [1000, 1000, 1000],
      pots: [{ label: 'Банк', amount: 65, winners: ['P2'] }],
    })
    // Карты сбросивших (#278) и взявшего без вскрытия — каждому только свои
    for (const me of ['p0', 'p2', null]) expect(JSON.stringify(history.map((h) => handFor(h, me)))).not.toContain('"Qh"')
    expect(JSON.stringify(handFor(history[0], 'p1'))).toContain('"Qh"')
    const cardsOf = (me: string) => historyHandView(savedOf(handFor(history[1], me))).players.map((p) => p.cards)
    expect(cardsOf('p1')).toEqual([null, ['Kc', 'Ks'], null])
    expect(cardsOf('p0')).toEqual([['6c', '6d'], null, null])
    expect(JSON.stringify(handFor(history[1], 'p0'))).not.toContain('"Kc"')
    expect(JSON.stringify(handFor(history[1], 'p0'))).not.toContain('"5c"')

    // «Показать» одну — запись той же раздачи переписана, а не добавлена
    ;[s, history] = playKeeping(s, [{ from: 'p1', msg: { type: 'show', cards: [1] } }], history)
    expect(history.map((h) => h.number)).toEqual([1, 2])
    expect(cardsOf('p0')).toEqual([['6c', '6d'], [null, 'Ks'], null])
    // Сбросивший показал обе — в истории их видят все, блок «Показали»
    ;[s, history] = playKeeping(s, [{ from: 'p2', msg: { type: 'show', cards: [0, 1] } }], history)
    expect(cardsOf('p0')).toEqual([['6c', '6d'], [null, 'Ks'], ['5c', '5d']])
  })

  it('запись до #278 (один взявший без вскрытия): история, «Вам сдано» и текст читаются как раньше', () => {
    const s = play(newTable(['p0', 'p1', 'p2'], { cards: 'phones' }), [start('p0', stackedDeck([['5c', '5d'], ['6c', '6d'], ['Kc', 'Ks']])), raise('p0', 30), fold('p1'), fold('p2')], false)
    const old: HistoryHand = structuredClone(s.lastHand!)
    old.record!.hidden = { playerId: 'p0', cards: ['Kc', 'Ks'] }
    // Без стола вечера (до Р-54): «я» — взявший без вскрытия
    expect(historyList([savedOf(old)])[0].mine?.cards).toEqual(['Kc', 'Ks'])
    const view = historyHandView(savedOf(old))
    expect(view.players.map((p) => p.cards)).toEqual([['Kc', 'Ks'], null, null])
    expect(view.text).toContain('Dealt to P0 [Kc Ks]')
    // Чужому телефону — без них
    expect(JSON.stringify(handFor(old, 'p1'))).not.toContain('"Kc"')
  })

  it('живые карты: без карт — места со стеками, ходы и банки', () => {
    const steps = [start('p0'), fold('p0'), call('p1'), check('p2')]
    for (let k = 0; k < 3; k++) steps.push(check('p1'), check('p2'))
    const [s, history] = playKeeping(three({ p2: 500 }), steps, [])
    expect(history).toEqual([]) // торги закрыты, банк ведущий ещё не раздал
    const [, done] = playKeeping(s, [award('p0', [['p2']])], history)
    expect(historyList(done.map(savedOf))).toEqual([{ number: 1, board: [], wins: [{ name: 'P2', amount: 20 }], mine: null }])
    expect(historyHandView(savedOf(done[0]))).toMatchObject({
      number: 1,
      board: [],
      players: [
        { name: 'P0', cards: null, hand: null, best: null, won: 0 },
        { name: 'P1', cards: null, hand: null, best: null, won: 0 },
        { name: 'P2', cards: null, hand: null, best: null, won: 20 },
      ],
      rounds: [
        { label: 'Префлоп', moves: ['P0: пас', 'P1: колл до 10', 'P2: чек'] },
        { label: 'Флоп', moves: ['P1: чек', 'P2: чек'] },
        { label: 'Тёрн', moves: ['P1: чек', 'P2: чек'] },
        { label: 'Ривер', moves: ['P1: чек', 'P2: чек'] },
      ],
      odds: null,
      chips: [1000, 1000, 500],
      pots: [{ label: 'Банк', amount: 20, winners: ['P2'] }],
    })
  })
})
