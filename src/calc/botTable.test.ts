import { describe, expect, it } from 'vitest'
import { viewFor } from '../poker/table'
import type { RandomBytes } from '../poker/tokens'
import { botMove, seededRandom, type Random } from './bot'
import {
  BOTS_DEFAULT,
  BOTS_MAX,
  BOTS_MIN,
  botGameLine,
  botGameOf,
  botStep,
  botTableView,
  botToAct,
  dealBotHand,
  iAmBroke,
  ME_NAME,
  myMove,
  myRebuy,
  parseBotTable,
  startBotTable,
  type BotForm,
  type BotStep,
  type BotTable,
} from './botTable'

const counter = () => {
  let n = 0
  return () => `id${++n}`
}

const FORM: BotForm = { bots: BOTS_DEFAULT, level: 'amateur', open: false, sb: 5, bb: 10, startingStack: 1000 }

function ok(r: BotStep): BotTable {
  if (!r.ok) throw new Error(r.error)
  return r.bots
}

function bytesOf(random: Random): RandomBytes {
  return (b) => {
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(random() * 256)
    return b
  }
}

const start = (form: Partial<BotForm> = {}) => ok(startBotTable({ ...FORM, ...form }, 0, counter()))

// Мой ход — тоже решением бота «Любитель», по моему виду стола
function play(bt: BotTable, random: Random): BotTable {
  if (botToAct(bt)) return ok(botStep(bt, 0, random))
  const move = botMove(viewFor(bt.table, bt.meId), bt.meId, 'abc', random)
  if (!move) throw new Error('нет хода')
  return ok(myMove(bt, move, 0))
}

const chipsInPlay = (bt: BotTable) => bt.table.players.reduce((sum, p) => sum + p.chips, 0)
const boughtIn = (bt: BotTable) => bt.table.players.reduce((sum, p) => sum + p.buyIn, 0)

describe('стол против ботов', () => {
  it('новый стол: я первым и веду стол, боты по порядку, холдем, карты раздаёт программа', () => {
    const bt = start()
    const t = bt.table
    expect(t.players.map((p) => [p.name, p.seat, p.chips])).toEqual([
      [ME_NAME, 0, 1000],
      ['Бот Север', 1, 1000],
      ['Бот Юг', 2, 1000],
      ['Бот Запад', 3, 1000],
    ])
    expect(t.hostId).toBe(bt.meId)
    expect(t.settings).toMatchObject({ sb: 5, bb: 10, startingStack: 1000, maxSeats: 4, cards: 'phones', game: 'holdem' })
    expect(t.settings.format ?? 'cash').toBe('cash')
    expect([bt.level, bt.open, bt.history]).toEqual(['amateur', false, []])
    expect(bt.id).not.toBe(bt.meId)
    expect(Object.values(bt.styles)).toEqual(['abc', 'abc', 'abc'])
  })

  it('стиль у каждого бота — по уровню, «Вперемешку» — без повтора; виден подписью под именем', () => {
    const counts = { novice: ['maniac', 'station', 'nit'], strong: ['tag', 'lag'], mixed: ['maniac', 'station', 'nit', 'abc', 'tag', 'lag'] }
    for (const [level, allowed] of Object.entries(counts)) {
      const bt = ok(startBotTable({ ...FORM, level: level as BotForm['level'], bots: BOTS_MAX }, 0, counter(), seededRandom(7)))
      const bots = bt.table.players.filter((p) => p.id !== bt.meId)
      const styles = bots.map((p) => bt.styles[p.id])
      expect(styles.every((s) => allowed.includes(s))).toBe(true)
      // Без повтора, пока стилей хватает
      expect(new Set(styles).size).toBe(Math.min(allowed.length, BOTS_MAX))
    }
    const bt = ok(startBotTable({ ...FORM, level: 'strong', bots: 2 }, 0, counter(), seededRandom(1)))
    const v = botTableView(bt, 0)
    expect(v.seats.find((s) => s.isMe)?.tag).toBeUndefined()
    expect(v.seats.filter((s) => !s.isMe).map((s) => s.tag).sort()).toEqual(['ЛАГ', 'ТАГ'])
    expect(v.seats[1].name).toBe('Бот Север')
  })

  it('старый стол против ботов, сохранённый до стилей, открывается: стили — по его уровню, всякий раз те же', () => {
    const bt = ok(dealBotHand(start({ level: 'novice', bots: BOTS_MAX }), 0, bytesOf(seededRandom(5))))
    const { styles: _, ...old } = bt
    const text = JSON.stringify(old)
    const a = parseBotTable(text)!
    expect(a).not.toBeNull()
    expect(a.table).toEqual(bt.table)
    const styles = bt.table.players.filter((p) => p.id !== bt.meId).map((p) => a.styles[p.id])
    expect(styles.every((s) => ['maniac', 'station', 'nit'].includes(s))).toBe(true)
    expect(new Set(styles.slice(0, 3)).size).toBe(3)
    expect(parseBotTable(text)!.styles).toEqual(a.styles)
    // Стиль не из списка — тоже по уровню
    const odd = parseBotTable(JSON.stringify({ ...bt, styles: { [bt.table.players[1].id]: 'гуру' } }))!
    expect(Object.keys(odd.styles)).toHaveLength(BOTS_MAX)
    // И играет дальше
    let t = a
    while (t.table.hand) t = play(t, seededRandom(9))
    expect(t.history).toHaveLength(1)
  })

  it(`ботов — от ${BOTS_MIN} до ${BOTS_MAX}`, () => {
    expect(startBotTable({ ...FORM, bots: 0 }, 0, counter())).toEqual({ ok: false, error: 'Ботов — от 1 до 5' })
    expect(startBotTable({ ...FORM, bots: 6 }, 0, counter()).ok).toBe(false)
    expect(start({ bots: 1 }).table.players).toHaveLength(2)
    expect(start({ bots: 5 }).table.players).toHaveLength(6)
  })

  it('раздача: карты у всех, мой вид — без карт ботов; ход бота — только когда его очередь', () => {
    const bt = ok(dealBotHand(start(), 0, bytesOf(seededRandom(1))))
    const hole = bt.table.hand!.cards!.hole
    expect(Object.values(hole).every((c) => c.length === 2 && c.every((x) => x !== null))).toBe(true)
    const v = botTableView(bt, 0)
    expect(v.myCards).toEqual(hole[bt.meId])
    for (const s of v.seats.filter((x) => !x.isMe)) expect(s.cards).toEqual([null, null])
    // Четверо: кнопка — я, первым ходит место после большого блайнда — бот, за ним я
    expect(botToAct(bt)).toBe(bt.table.players[3].id)
    expect(myMove(bt, { type: 'call' }, 0)).toEqual({ ok: false, error: 'Сейчас не ваш ход' })
    const next = ok(botStep(bt, 0, seededRandom(1)))
    expect(botToAct(next)).toBeNull()
    expect(botStep(next, 0, seededRandom(1))).toEqual({ ok: false, error: 'Сейчас не ход бота' })
    expect(ok(myMove(next, { type: 'fold' }, 0)).table.hand!.seats[0].folded).toBe(true)
  })

  it('«Карты ботов открыты» — у ботов в раздаче лицом на моём экране; в столе ничего не меняется', () => {
    const bt = ok(dealBotHand(start({ open: true }), 0, bytesOf(seededRandom(2))))
    const hole = bt.table.hand!.cards!.hole
    const v = botTableView(bt, 0)
    for (const s of v.seats.filter((x) => !x.isMe)) expect(s.cards).toEqual(hole[s.id])
    expect(v.myCards).toEqual(hole[bt.meId])
    expect(botTableView({ ...bt, open: false }, 0).seats[1].cards).toEqual([null, null])
    // Бот всё равно видит только свои
    const botId = bt.table.players[1].id
    expect(viewFor(bt.table, botId).hand!.cards!.hole[bt.meId]).toEqual([null, null])
  })

  it('кончились фишки у бота — докупается сам на стартовый стек; у меня — «Докупиться» или «Закончить»', () => {
    let bt = start({ bots: 1 })
    const [me, bot] = bt.table.players
    // Бот без фишек между раздачами — докуп в следующем же шаге стола
    // HUD вечера у бота после докупа — тот же (#146): соперники читают его дальше
    const hud = { hands: 40, vpip: 10, pfr: 8, stealChances: 12, steals: 4, cbChances: 6, cbs: 4, raises: 20, calls: 10 }
    bt = { ...bt, table: { ...bt.table, players: [me, { ...bot, chips: 0 }], hud: { [bot.id]: hud } } }
    bt = ok(myRebuy(bt, 0))
    expect(bt.table.players.map((p) => p.chips)).toEqual([2000, 1000])
    expect(bt.table.hud?.[bot.id]).toEqual(hud)

    const broke = { ...bt, table: { ...bt.table, players: [{ ...bt.table.players[0], chips: 0 }, bt.table.players[1]] } }
    expect(iAmBroke(broke)).toBe(true)
    expect(dealBotHand(broke, 0)).toEqual({ ok: false, error: 'Фишки кончились — докупитесь или закончите игру' })
    const back = ok(myRebuy(broke, 0))
    expect(iAmBroke(back)).toBe(false)
    expect(back.table.players[0]).toMatchObject({ chips: 1000, buyIn: 3000 })
  })

  it('сотня раздач до конца без ошибок: фишки сходятся, история — каждая раздача', () => {
    const random = seededRandom(117)
    for (const level of ['novice', 'amateur', 'strong', 'mixed'] as const) {
      let bt = start({ level, bots: BOTS_MAX })
      for (let k = 0; k < 100; k++) {
        if (iAmBroke(bt)) bt = ok(myRebuy(bt, 0))
        bt = ok(dealBotHand(bt, 0, bytesOf(random)))
        let moves = 0
        while (bt.table.hand) {
          bt = play(bt, random)
          if (++moves > 200) throw new Error('раздача не кончается')
        }
        expect(chipsInPlay(bt)).toBe(boughtIn(bt))
        // Боты без фишек уже докупились
        expect(bt.table.players.filter((p) => p.id !== bt.meId && p.chips === 0)).toEqual([])
      }
      expect(bt.history.map((h) => h.number)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1))
    }
  }, 30_000)

  it('из памяти устройства — тот же стол; чужое — null', () => {
    const bt = ok(dealBotHand(start({ level: 'strong', open: true }), 0, bytesOf(seededRandom(3))))
    expect(parseBotTable(JSON.stringify(bt))).toEqual(bt)
    expect(parseBotTable('не json')).toBeNull()
    expect(parseBotTable(JSON.stringify({ ...bt, level: 'гроссмейстер' }))).toBeNull()
    expect(parseBotTable(JSON.stringify({ ...bt, meId: 'нет такого' }))).toBeNull()
    expect(parseBotTable(JSON.stringify({ id: bt.id, table: bt.table, gameId: null, history: [] }))).toBeNull()
  })

  // Омаха (#147, Р-46)
  it('омаха: пот-лимит, кэш; по четыре карты у всех; строка игры стола', () => {
    const bt = start({ game: 'omaha' })
    expect(bt.table.settings).toMatchObject({ cards: 'phones', game: 'omaha', limit: 'pot' })
    expect(botGameOf(bt)).toBe('omaha')
    expect(botGameLine(botGameOf(bt))).toBe('Омаха, пот-лимит, кэш')
    expect(botGameOf(start())).toBe('holdem')
    expect(botGameLine(botGameOf(start()))).toBe('Холдем, кэш')
    const dealt = ok(dealBotHand(bt, 0, bytesOf(seededRandom(4))))
    const hole = dealt.table.hand!.cards!.hole
    expect(Object.values(hole).every((c) => c.length === 4 && c.every((x) => x !== null))).toBe(true)
    expect(dealt.table.hand!.limit).toBe('pot')
    // Мой вид — четыре рубашки у ботов
    for (const s of botTableView(dealt, 0).seats.filter((x) => !x.isMe)) expect(s.cards).toEqual([null, null, null, null])
  })

  it('омаха: полсотни раздач до конца без ошибок — рейз не больше банка, фишки сходятся, вскрытие по омахе', () => {
    const random = seededRandom(147)
    for (const level of ['novice', 'amateur', 'strong', 'mixed'] as const) {
      let bt = start({ level, bots: BOTS_MAX, game: 'omaha' })
      for (let k = 0; k < 50; k++) {
        if (iAmBroke(bt)) bt = ok(myRebuy(bt, 0))
        bt = ok(dealBotHand(bt, 0, bytesOf(random)))
        let moves = 0
        while (bt.table.hand) {
          bt = play(bt, random)
          if (++moves > 200) throw new Error('раздача не кончается')
        }
        expect(chipsInPlay(bt)).toBe(boughtIn(bt))
      }
      expect(bt.history).toHaveLength(50)
      expect(bt.history.every((h) => h.record?.game.id === 'omaha')).toBe(true)
    }
  }, 60_000)

  it('стол с омахой сохраняется и читается; стол до омахи (без поля игры) — холдем', () => {
    const bt = ok(dealBotHand(start({ level: 'strong', game: 'omaha' }), 0, bytesOf(seededRandom(6))))
    const back = parseBotTable(JSON.stringify(bt))!
    expect(back).toEqual(bt)
    expect(botGameOf(back)).toBe('omaha')
    // Стол, сохранённый до #147: в настройках нет игры — холдем, играет дальше
    const holdem = start({ level: 'amateur' })
    const { game: _, ...settings } = holdem.table.settings
    const old = parseBotTable(JSON.stringify({ ...holdem, table: { ...holdem.table, settings } }))!
    expect(old).not.toBeNull()
    expect(botGameOf(old)).toBe('holdem')
    const dealt = ok(dealBotHand(old, 0, bytesOf(seededRandom(8))))
    expect(Object.values(dealt.table.hand!.cards!.hole).every((c) => c.length === 2)).toBe(true)
    // Игра, которой боты не играют, — не стол с ботами
    const short = { ...holdem, table: { ...holdem.table, settings: { ...holdem.table.settings, game: 'shortdeck' } } }
    expect(parseBotTable(JSON.stringify(short))).toBeNull()
    const noLimit = { ...bt, table: { ...bt.table, settings: { ...bt.table.settings, limit: 'nolimit' } } }
    expect(parseBotTable(JSON.stringify(noLimit))).toBeNull()
  })
})
