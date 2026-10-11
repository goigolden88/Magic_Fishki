import { describe, expect, it } from 'vitest'
import { balance, playerTotals } from './totals'
import {
  addDraftPlayer,
  draftFromChat,
  duplicateNames,
  gameFromDraft,
  mergeDraftPlayers,
  parseChat,
  setCashout,
  setRebuyCount,
  type Draft,
} from './telegram'

// Формат «Копировать» из Телеграма; имена, даты и числа выдуманы
const CHAT = [
  '[05.06.2026 22:10] Аня Б: #rebuy Гоша',
  '[05.06.2026 22:10] Аня Б: #rebuy Дима',
  '[05.06.2026 23:40] Гоша М: #rebuy Гоша',
  '[06.06.2026 0:15] Гоша М: #rebuy Гоша',
  '[06.06.2026 1:30] Гоша М: #rebuy Гоша',
  '[06.06.2026 3:05] Dima: #cashout Дима 2400',
  '[06.06.2026 3:06] Ezh: #cashout 1300',
  '[06.06.2026 3:07] Аня Б: #cashout 3900',
  '[06.06.2026 3:07] U Kat: #cashout Катя 3400',
].join('\n')

const local = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).toISOString()

function ids() {
  let n = 0
  return () => `id${n++}`
}

function draftOf(text: string, buyin = 1000): Draft {
  const draft = draftFromChat(parseChat(text), buyin, ids())
  if (!draft) throw new Error('нет черновика')
  return draft
}

function check(draft: Draft) {
  const game = gameFromDraft(draft, { name: 'Игра', rate: 0.5, now: '2026-06-06T10:00:00.000Z' }, ids())
  return balance(playerTotals(game.players, game.entries, game.rate))
}

describe('разбор текста из Телеграма', () => {
  it('пример: записи, время, дата первого сообщения', () => {
    const chat = parseChat(CHAT)
    expect(chat.date).toBe('2026-06-05')
    expect(chat.unparsed).toEqual([])
    expect(chat.records).toHaveLength(9)
    expect(chat.records[0]).toEqual({ kind: 'rebuy', name: 'Гоша', at: local(2026, 6, 5, 22, 10) })
    expect(chat.records[3]).toEqual({ kind: 'rebuy', name: 'Гоша', at: local(2026, 6, 6, 0, 15) })
    expect(chat.records[5]).toEqual({ kind: 'cashout', name: 'Дима', chips: 2400, at: local(2026, 6, 6, 3, 5) })
  })

  it('тег без имени — запись отправителя', () => {
    const chat = parseChat('[06.06.2026 3:06] Ezh: #cashout 1300\n[06.06.2026 3:08] Аня Б: #rebuy')
    expect(chat.records.map((r) => r.name)).toEqual(['Ezh', 'Аня Б'])
  })

  it('«#rebuy 1000» — докуп отправителю', () => {
    expect(parseChat('[06.06.2026 1:00] Ezh: #rebuy 1000').records[0].name).toBe('Ezh')
  })

  it('выход с пробелами в числе и тег в другом регистре', () => {
    const chat = parseChat('[06.06.2026 3:06] Ezh: #Cashout Ёж 2 400')
    expect(chat.records[0]).toMatchObject({ kind: 'cashout', name: 'Ёж', chips: 2400 })
  })

  it('сообщение на несколько строк и пустые строки между сообщениями', () => {
    const text = '[05.06.2026 22:10] Аня Б: #rebuy Гоша\n#rebuy Дима\n\n\n[06.06.2026 3:07] Аня Б:\n#cashout 3900\n'
    const chat = parseChat(text)
    expect(chat.records.map((r) => [r.kind, r.name])).toEqual([
      ['rebuy', 'Гоша'],
      ['rebuy', 'Дима'],
      ['cashout', 'Аня Б'],
    ])
    expect(chat.unparsed).toEqual([])
  })

  it('строки без тегов и непонятные — в «не разобрано», а не теряются', () => {
    const text = [
      'Покер в пятницу',
      '[05.06.2026 22:00] Аня Б: начинаем',
      '[05.06.2026 22:10] Аня Б: #rebuy Гоша',
      '[06.06.2026 3:05] Dima: #cashout',
      '[06.06.2026 3:05] Dima: #cashout Дима',
      '[06.06.2026 3:06] Ezh: #cashout 1300',
      'спасибо всем',
    ].join('\n')
    const chat = parseChat(text)
    expect(chat.records).toHaveLength(2)
    expect(chat.unparsed).toEqual([
      'Покер в пятницу',
      'Аня Б: начинаем',
      'Dima: #cashout',
      'Dima: #cashout Дима',
      'Ezh: спасибо всем',
    ])
    expect(chat.date).toBe('2026-06-05')
  })

  it('нет ни одного #rebuy и #cashout — черновика нет', () => {
    const chat = parseChat('[05.06.2026 22:00] Аня Б: начинаем\nпривет')
    expect(chat.records).toEqual([])
    expect(draftFromChat(chat, 1000, ids())).toBeNull()
    expect(draftFromChat(parseChat(''), 1000, ids())).toBeNull()
  })
})

describe('сверка', () => {
  it('пример: 5 игроков из текста, каждому закуп; «Гоша М» игроком не становится', () => {
    const draft = draftOf(CHAT)
    expect(draft.date).toBe('2026-06-05')
    expect(draft.players.map((p) => [p.name, p.buyin, p.rebuys.length, p.cashouts.map((c) => c.chips)])).toEqual([
      ['Гоша', 1000, 4, []],
      ['Дима', 1000, 1, [2400]],
      ['Ezh', 1000, 0, [1300]],
      ['Аня Б', 1000, 0, [3900]],
      ['Катя', 1000, 0, [3400]],
    ])
  })

  it('пример сходится, когда добавлен шестой с выходом 0', () => {
    const draft = draftOf(CHAT)
    expect(check(draft)).toEqual({ chipsIn: 10000, chipsOut: 11000, diff: -1000, ok: false })
    const six = addDraftPlayer(draft, ' Лёша ', () => 'new')
    expect(six.players[5]).toEqual({ id: 'new', name: 'Лёша', buyin: 1000, rebuys: [], cashouts: [] })
    expect(check(six)).toEqual({ chipsIn: 11000, chipsOut: 11000, diff: 0, ok: true })
  })

  it('объединение ника и имени: докупы и выходы складываются, закуп — один', () => {
    const text = '[05.06.2026 22:10] Аня Б: #rebuy Эрик\n[06.06.2026 3:00] Erik: #cashout 2500\n[06.06.2026 3:01] Аня Б: #cashout 500'
    const draft = draftOf(text)
    const [erik, anya] = [draft.players[1], draft.players[2]]
    expect(draft.players.map((p) => p.name)).toEqual(['Эрик', 'Erik', 'Аня Б'])
    const merged = mergeDraftPlayers(draft, erik.id, draft.players[0].id)
    expect(merged.players.map((p) => p.name)).toEqual(['Эрик', 'Аня Б'])
    expect(merged.players[0]).toMatchObject({ buyin: 1000, rebuys: [draft.players[0].rebuys[0]], cashouts: [{ chips: 2500 }] })
    expect(merged.players[1]).toBe(anya)
    expect(check(merged)).toMatchObject({ chipsIn: 3000, chipsOut: 3000, ok: true })
  })

  it('объединение с собой или с несуществующим — без изменений', () => {
    const draft = draftOf(CHAT)
    const id = draft.players[0].id
    expect(mergeDraftPlayers(draft, id, id)).toBe(draft)
    expect(mergeDraftPlayers(draft, id, 'нет')).toBe(draft)
  })

  it('число докупов: меньше — уходят последние, больше — со временем конца', () => {
    const gosha = draftOf(CHAT).players[0]
    expect(setRebuyCount(gosha, 2, 'end').rebuys).toEqual(gosha.rebuys.slice(0, 2))
    expect(setRebuyCount(gosha, 6, 'end').rebuys).toEqual([...gosha.rebuys, 'end', 'end'])
    expect(setRebuyCount(gosha, -1, 'end').rebuys).toEqual([])
  })

  it('выход одним числом: 0 — без выхода, то же — без изменений, иначе одна запись', () => {
    const draft = draftOf('[06.06.2026 3:00] Erik: #cashout 2500\n[06.06.2026 3:30] Erik: #cashout 500')
    const erik = draft.players[0]
    expect(setCashout(erik, 3000, 'end')).toBe(erik)
    expect(setCashout(erik, 0, 'end').cashouts).toEqual([])
    expect(setCashout(erik, 2800, 'end').cashouts).toEqual([{ chips: 2800, at: local(2026, 6, 6, 3, 30) }])
    const noCashout = { ...erik, cashouts: [] }
    expect(setCashout(noCashout, 700, 'end').cashouts).toEqual([{ chips: 700, at: 'end' }])
  })

  it('одинаковые имена после переименования — найдены без учёта регистра', () => {
    const draft = draftOf(CHAT)
    expect(duplicateNames(draft)).toEqual([])
    const renamed = { ...draft, players: draft.players.map((p) => (p.name === 'Ezh' ? { ...p, name: 'гоша ' } : p)) }
    expect(duplicateNames(renamed)).toEqual(['Гоша'])
  })
})

describe('игра из сверки', () => {
  it('обычная игра: закупы — временем первого сообщения, записи по времени, курс и название', () => {
    const draft = draftOf(CHAT)
    const game = gameFromDraft(draft, { name: '5 июня', rate: 0.5, now: 'now' }, () => 'e')
    expect(game).toMatchObject({ name: '5 июня', date: '2026-06-05', rate: 0.5, updatedAt: 'now' })
    expect(game.players.map((p) => p.name)).toEqual(['Гоша', 'Дима', 'Ezh', 'Аня Б', 'Катя'])
    expect(game.entries).toHaveLength(5 + 5 + 4)
    const times = game.entries.map((e) => e.at)
    expect(times).toEqual([...times].sort())
    const gosha = game.players[0].id
    expect(game.entries.filter((e) => e.playerId === gosha).map((e) => [e.kind, e.chips])).toEqual([
      ['buyin', 1000],
      ['rebuy', 1000],
      ['rebuy', 1000],
      ['rebuy', 1000],
      ['rebuy', 1000],
    ])
    expect(game.entries.find((e) => e.kind === 'buyin')?.at).toBe(local(2026, 6, 5, 22, 10))
  })

  it('закуп 0 — записи закупа нет; закуп по умолчанию из настроек — и докуп той же суммой', () => {
    const draft = draftOf('[05.06.2026 22:10] Аня Б: #rebuy\n[06.06.2026 3:00] Аня Б: #cashout 3000', 1500)
    const game = gameFromDraft(draft, { name: 'И', rate: 1, now: 'now' }, ids())
    expect(game.entries.map((e) => [e.kind, e.chips])).toEqual([
      ['buyin', 1500],
      ['rebuy', 1500],
      ['cashout', 3000],
    ])
    const noBuyin = { ...draft, players: [{ ...draft.players[0], buyin: 0 }] }
    expect(gameFromDraft(noBuyin, { name: 'И', rate: 1, now: 'now' }, ids()).entries.map((e) => e.kind)).toEqual([
      'rebuy',
      'cashout',
    ])
  })

  it('один текст дважды — две разные игры', () => {
    const make = ids()
    const a = gameFromDraft(draftOf(CHAT), { name: 'И', rate: 0.5, now: 'now' }, make)
    const b = gameFromDraft(draftOf(CHAT), { name: 'И', rate: 0.5, now: 'now' }, make)
    expect(a.id).not.toBe(b.id)
  })
})
