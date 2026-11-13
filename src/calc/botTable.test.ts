import { describe, expect, it } from 'vitest'
import { AUTO_START_MS, viewFor } from '../poker/table'
import type { RandomBytes } from '../poker/tokens'
import { botMove, seededRandom, type Random } from './bot'
import {
  autoDealBotHand,
  autoFinishNow,
  BOT_AUTO_START_DEFAULT,
  BOTS_DEFAULT,
  BOTS_MAX,
  BOTS_MIN,
  botAutoStart,
  botGameLine,
  botNextHandAt,
  botPause,
  botsPlayOn,
  canTopUpAll,
  finishBotHand,
  resumeBotTable,
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
  topUpAll,
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
    expect([bt.level, bt.open, bt.showStyles, bt.history]).toEqual(['amateur', false, true, []])
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

  it('«Стиль ботов виден» снят — подписей стиля нет ни в раздаче, ни между раздачами; остальное у мест — как было', () => {
    const mixed = (showStyles: boolean) =>
      ok(startBotTable({ ...FORM, level: 'mixed', bots: BOTS_MAX, showStyles }, 0, counter(), seededRandom(11)))
    const shown = mixed(true)
    const hidden = mixed(false)
    expect(hidden.showStyles).toBe(false)
    // Стили у ботов есть и те же — ходят как прежде
    expect(hidden.styles).toEqual(shown.styles)
    const strip = (v: ReturnType<typeof botTableView>) => v.seats.map(({ tag: _, ...s }) => s)
    const pairs: [BotTable, BotTable][] = [
      [shown, hidden],
      [ok(dealBotHand(shown, 0, bytesOf(seededRandom(4)))), ok(dealBotHand(hidden, 0, bytesOf(seededRandom(4))))],
    ]
    for (const [a, b] of pairs) {
      const v = botTableView(b, 0)
      expect(v.seats.every((s) => s.tag === undefined)).toBe(true)
      expect(botTableView(a, 0).seats.filter((s) => !s.isMe).every((s) => s.tag !== undefined)).toBe(true)
      expect(strip(v)).toEqual(strip(botTableView(a, 0)))
    }
    // Независимо от «Карты ботов открыты»: открытые карты без подписей
    const both = ok(dealBotHand(start({ open: true, showStyles: false }), 0, bytesOf(seededRandom(2))))
    const v = botTableView(both, 0)
    for (const s of v.seats.filter((x) => !x.isMe)) {
      expect(s.cards).toEqual(both.table.hand!.cards!.hole[s.id])
      expect(s.tag).toBeUndefined()
    }
    // Ход бота тот же, что со стилем на виду
    const dealtShown = ok(dealBotHand(shown, 0, bytesOf(seededRandom(6))))
    const dealtHidden = ok(dealBotHand(hidden, 0, bytesOf(seededRandom(6))))
    expect(ok(botStep(dealtHidden, 0, seededRandom(8))).table).toEqual(ok(botStep(dealtShown, 0, seededRandom(8))).table)
  })

  it('«Стиль ботов виден» — в памяти устройства; стол, сохранённый до этой галочки, — с подписями', () => {
    const hidden = start({ showStyles: false })
    const back = parseBotTable(JSON.stringify(hidden))!
    expect(back).toEqual(hidden)
    expect(botTableView(back, 0).seats.every((s) => s.tag === undefined)).toBe(true)
    expect(parseBotTable(JSON.stringify(start()))!.showStyles).toBe(true)
    const { showStyles: _, ...old } = hidden
    const was = parseBotTable(JSON.stringify(old))!
    expect(was.showStyles).toBe(true)
    expect(botTableView(was, 0).seats.filter((s) => !s.isMe).every((s) => s.tag === 'ABC')).toBe(true)
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

// «Следующая раздача сама» (#156, Р-51)
describe('стол против ботов: раздача сама', () => {
  const FAST = AUTO_START_MS.fast
  // Раздача до конца, все ходы — в момент now
  function finish(bt: BotTable, now: number, random: Random): BotTable {
    let t = bt
    for (let moves = 0; t.table.hand; moves++) {
      if (moves > 200) throw new Error('раздача не кончается')
      if (botToAct(t)) t = ok(botStep(t, now, random))
      else {
        const move = botMove(viewFor(t.table, t.meId), t.meId, 'abc', random)
        if (!move) throw new Error('нет хода')
        t = ok(myMove(t, move, now))
      }
    }
    return t
  }

  it('новый стол — с выбором из формы; по умолчанию в окне — быстро (3 с); без поля — кнопкой', () => {
    expect(BOT_AUTO_START_DEFAULT).toBe('fast')
    expect(FAST).toBe(3000)
    expect(start({ autoStart: 'fast' }).table.settings.autoStart).toBe('fast')
    expect(start({ autoStart: 'slow' }).table.settings.autoStart).toBe('slow')
    expect(start().table.settings.autoStart).toBe('off')
  })

  it('первая — кнопкой; закончилась — следующая сама через паузу, отсчёт виден; раньше срока — нет', () => {
    const random = seededRandom(21)
    let bt = start({ autoStart: 'fast' })
    expect(botNextHandAt(bt)).toBeNull()
    expect(autoDealBotHand(bt, 100_000).ok).toBe(false)
    bt = finish(ok(dealBotHand(bt, 1000, bytesOf(random))), 2000, random)
    expect(botNextHandAt(bt)).toBe(2000 + FAST)
    expect(botTableView(bt, 2000).nextHandLeft).toBe(3)
    expect(autoDealBotHand(bt, 2000 + FAST - 1)).toEqual({ ok: false, error: 'Раздача сама начнётся позже' })
    const next = ok(autoDealBotHand(bt, 2000 + FAST, bytesOf(random)))
    expect(next.table.hand?.number).toBe(2)
    expect(Object.values(next.table.hand!.cards!.hole).every((c) => c.length === 2)).toBe(true)
    expect(botNextHandAt(next)).toBeNull()
    expect(next.history).toHaveLength(1)
    // И дальше сами — десяток раздач подряд
    bt = next
    for (let k = 0, now = 10_000; k < 10; k++, now += 10_000) {
      if (iAmBroke(bt)) bt = ok(myRebuy(bt, now))
      if (!bt.table.hand) bt = ok(autoDealBotHand(bt, botNextHandAt(bt)!, bytesOf(random)))
      bt = finish(bt, now, random)
      expect(botNextHandAt(bt)).toBe(iAmBroke(bt) ? null : now + FAST)
    }
    expect(bt.history).toHaveLength(11)
  })

  it('«Нет» — как раньше: после раздачи сама не начинается, только кнопкой', () => {
    const random = seededRandom(22)
    const bt = finish(ok(dealBotHand(start(), 0, bytesOf(random))), 0, random)
    expect(bt.table.nextHandAt ?? null).toBeNull()
    expect(botTableView(bt, 0).nextHandLeft).toBeNull()
    expect(autoDealBotHand(bt, 60_000).ok).toBe(false)
    expect(ok(dealBotHand(bt, 60_000, bytesOf(random))).table.hand?.number).toBe(2)
  })

  it('«Перерыв» — сама не начинается, идущая доигрывается; «Продолжить» — снова через полную паузу', () => {
    const random = seededRandom(23)
    let bt = finish(ok(dealBotHand(start({ autoStart: 'fast' }), 0, bytesOf(random))), 0, random)
    // Между раздачами
    const paused = ok(botPause(bt, true, 1000))
    expect(botTableView(paused, 1000).paused).toBe(true)
    expect(botNextHandAt(paused)).toBeNull()
    expect(autoDealBotHand(paused, 60_000).ok).toBe(false)
    const resumed = ok(botPause(paused, false, 60_000))
    expect(botNextHandAt(resumed)).toBe(60_000 + FAST)
    // Во время раздачи: доигрывается, новая сама не взводится
    bt = ok(autoDealBotHand(resumed, 60_000 + FAST, bytesOf(random)))
    bt = finish(ok(botPause(bt, true, 64_000)), 65_000, random)
    expect(bt.table.hand).toBeNull()
    expect(bt.history).toHaveLength(2)
    expect(botNextHandAt(bt)).toBeNull()
    expect(botNextHandAt(ok(botPause(bt, false, 70_000)))).toBe(70_000 + FAST)
  })

  it('мои фишки кончились — сами не идут; докупился — снова сами через полную паузу', () => {
    let bt = start({ bots: 2, autoStart: 'fast' })
    const random = seededRandom(24)
    bt = finish(ok(dealBotHand(bt, 0, bytesOf(random))), 0, random)
    // Стол после раздачи, где я всё проиграл: у меня 0
    const [me, ...bots] = bt.table.players
    const broke = ok(botPause(ok(botPause({ ...bt, table: { ...bt.table, players: [{ ...me, chips: 0 }, ...bots] } }, true, 1000)), false, 1000))
    expect(iAmBroke(broke)).toBe(true)
    expect(broke.table.nextHandAt ?? null).toBeNull()
    expect(botNextHandAt(broke)).toBeNull()
    expect(autoDealBotHand(broke, 60_000).ok).toBe(false)
    const back = ok(myRebuy(broke, 50_000))
    expect(botNextHandAt(back)).toBe(50_000 + FAST)
    expect(ok(autoDealBotHand(back, 50_000 + FAST, bytesOf(random))).table.hand).not.toBeNull()
  })

  it('стол снова открыт посреди паузы — отсчёт заново с полной; нет паузы — стол как был', () => {
    const random = seededRandom(25)
    const bt = finish(ok(dealBotHand(start({ autoStart: 'medium' }), 0, bytesOf(random))), 0, random)
    expect(botNextHandAt(bt)).toBe(AUTO_START_MS.medium)
    const reopened = resumeBotTable(parseBotTable(JSON.stringify(bt))!, 3_600_000)
    expect(botNextHandAt(reopened)).toBe(3_600_000 + AUTO_START_MS.medium)
    expect(autoDealBotHand(reopened, 3_600_000).ok).toBe(false)
    const off = finish(ok(dealBotHand(start(), 0, bytesOf(random))), 0, random)
    expect(resumeBotTable(off, 3_600_000)).toBe(off)
    const dealing = ok(dealBotHand(bt, 0, bytesOf(random)))
    expect(resumeBotTable(dealing, 3_600_000)).toBe(dealing)
  })

  it('стол, начатый до этой задачи (без поля в настройках), — как был: кнопкой', () => {
    const random = seededRandom(26)
    const bt = start({ autoStart: 'fast' })
    const { autoStart: _, ...settings } = bt.table.settings
    const old = parseBotTable(JSON.stringify({ ...bt, table: { ...bt.table, settings } }))!
    expect(botAutoStart(old)).toBe('off')
    const played = finish(ok(dealBotHand(old, 0, bytesOf(random))), 0, random)
    expect(botNextHandAt(played)).toBeNull()
    expect(autoDealBotHand(played, 60_000).ok).toBe(false)
  })
})

// «Доиграть сразу» и «После паса — сразу доигрывать» (#194)
describe('стол против ботов: доиграть сразу', () => {
  // До моего хода — боты по очереди; мой ход — пас
  function foldMe(bt: BotTable, random: Random): BotTable {
    let t = bt
    while (t.table.hand && botToAct(t)) t = ok(botStep(t, 0, random))
    return t.table.hand ? ok(myMove(t, { type: 'fold' }, 0)) : t
  }
  // Раздача после моего паса — по одному ходу бота, как по таймеру
  function stepByStep(bt: BotTable, random: Random): BotTable {
    let t = bt
    while (t.table.hand) t = ok(botStep(t, 0, random))
    return t
  }

  it('сбросил — боты доигрывают сразу теми же ходами, что по секунде: стол, история и HUD те же', () => {
    let showdowns = 0
    let allIns = 0
    for (const level of ['novice', 'amateur', 'strong', 'mixed'] as const) {
      let a = start({ level, bots: BOTS_MAX, autoStart: 'fast' })
      let b = a
      for (let k = 0; k < 25; k++) {
        if (iAmBroke(a)) [a, b] = [ok(myRebuy(a, 0)), ok(myRebuy(b, 0))]
        const deck = bytesOf(seededRandom(1000 + k))
        a = foldMe(ok(dealBotHand(a, 0, deck)), seededRandom(k))
        b = foldMe(ok(dealBotHand(b, 0, bytesOf(seededRandom(1000 + k)))), seededRandom(k))
        expect(b).toEqual(a)
        if (!a.table.hand) continue // все сбросили до меня или ко мне — доигрывать нечего
        expect(botsPlayOn(a)).toBe(true)
        a = ok(finishBotHand(a, 0, seededRandom(500 + k)))
        b = stepByStep(b, seededRandom(500 + k))
        expect(a).toEqual(b)
        expect(a.table.hand).toBeNull()
        expect(botsPlayOn(a)).toBe(false)
        // Конец — как у обычной раздачи: следующая сама взведена, фишки сходятся, раздача — в истории
        expect(botNextHandAt(a)).toBe(iAmBroke(a) ? null : AUTO_START_MS.fast)
        expect(chipsInPlay(a)).toBe(boughtIn(a))
        const last = a.history[a.history.length - 1]
        expect(last.number).toBe(k + 1)
        if (Object.keys(last.record?.hands ?? {}).length > 1) showdowns++
        if (last.record?.log.some((e) => e.allIn && e.playerId !== a.meId)) allIns++
      }
      expect(a.history.map((h) => h.number)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
      expect(a.table.hud).toEqual(b.table.hud)
    }
    // Среди доигранных сразу — и вскрытия, и олл-ины без меня
    expect(showdowns).toBeGreaterThan(0)
    expect(allIns).toBeGreaterThan(0)
  }, 60_000)

  it('я в раздаче, мой ход или раздачи нет — доигрывать нечего, стол как был', () => {
    const bt = ok(dealBotHand(start(), 0, bytesOf(seededRandom(1))))
    // Ход бота, я не сбросил
    expect(botToAct(bt)).not.toBeNull()
    expect(botsPlayOn(bt)).toBe(false)
    expect(finishBotHand(bt, 0, seededRandom(1))).toEqual({ ok: false, error: 'Вы в раздаче — ходите сами' })
    // Мой ход
    const mine = ok(botStep(bt, 0, seededRandom(1)))
    expect(botToAct(mine)).toBeNull()
    expect(botsPlayOn(mine)).toBe(false)
    expect(finishBotHand(mine, 0, seededRandom(1)).ok).toBe(false)
    // Между раздачами
    expect(botsPlayOn(start())).toBe(false)
    expect(finishBotHand(start(), 0, seededRandom(1)).ok).toBe(false)
  })

  it('«После паса — сразу доигрывать»: по умолчанию выключен; включён — доигрывать без кнопки, только после моего паса', () => {
    expect(start().autoFinish).toBe(false)
    const on = start({ autoFinish: true, bots: BOTS_MAX })
    expect(on.autoFinish).toBe(true)
    const dealt = ok(dealBotHand(on, 0, bytesOf(seededRandom(3))))
    expect(autoFinishNow(dealt)).toBe(false)
    expect(autoFinishNow(start({ autoFinish: true }))).toBe(false)
    let folded: BotTable | null = null
    for (let seed = 0; !folded; seed++) {
      const t = foldMe(ok(dealBotHand(on, 0, bytesOf(seededRandom(seed)))), seededRandom(seed))
      if (t.table.hand) folded = t
    }
    expect(autoFinishNow(folded)).toBe(true)
    expect(autoFinishNow({ ...folded, autoFinish: false })).toBe(false)
  })

  it('флажок — в памяти устройства; стол, сохранённый до него, — выключен', () => {
    const on = start({ autoFinish: true })
    expect(parseBotTable(JSON.stringify(on))).toEqual(on)
    const { autoFinish: _, ...old } = on
    expect(parseBotTable(JSON.stringify(old))!.autoFinish).toBe(false)
  })

  it('«Перерыв» во время раздачи — доигрывается сразу, новая сама не взводится; «Продолжить» — как раньше', () => {
    let t: BotTable | null = null
    for (let seed = 0; !t; seed++) {
      const x = foldMe(ok(dealBotHand(start({ autoStart: 'fast', bots: BOTS_MAX }), 0, bytesOf(seededRandom(seed)))), seededRandom(seed))
      if (x.table.hand) t = x
    }
    const done = ok(finishBotHand(ok(botPause(t, true, 1000)), 2000, seededRandom(7)))
    expect(done.table.hand).toBeNull()
    expect(done.history).toHaveLength(1)
    expect(botTableView(done, 2000).paused).toBe(true)
    expect(botNextHandAt(done)).toBeNull()
    expect(botNextHandAt(ok(botPause(done, false, 5000)))).toBe(5000 + AUTO_START_MS.fast)
  })
})

// «Докупить всех до стартового стека» (#195)
describe('стол против ботов: докупить всех до стартового стека', () => {
  // Стол между раздачами со стеками chips по местам
  function withChips(bt: BotTable, chips: number[]): BotTable {
    return { ...bt, table: { ...bt.table, players: bt.table.players.map((p, i) => ({ ...p, chips: chips[i] })) } }
  }
  function played(form: Partial<BotForm>, seed: number): BotTable {
    let t = ok(dealBotHand(start(form), 0, bytesOf(seededRandom(seed))))
    for (let moves = 0; t.table.hand; moves++) {
      if (moves > 200) throw new Error('раздача не кончается')
      t = play(t, seededRandom(seed + moves))
    }
    return t
  }

  it('у кого меньше — ровно до стартового стека, мне тоже; у кого столько и больше — как был; докуп — обычный', () => {
    const bt = withChips(start({ bots: 3 }), [400, 1000, 1500, 0])
    expect(canTopUpAll(bt)).toBe(true)
    const before = bt.table.chipLog.length
    const done = ok(topUpAll(bt, 7000))
    expect(done.table.players.map((p) => p.chips)).toEqual([1000, 1000, 1500, 1000])
    expect(done.table.players.map((p, i) => p.buyIn - bt.table.players[i].buyIn)).toEqual([600, 0, 0, 1000])
    const [me, , , last] = bt.table.players
    expect(done.table.chipLog.slice(before)).toEqual([
      { kind: 'rebuy', playerId: me.id, by: bt.meId, from: 400, to: 1000, at: 7000 },
      { kind: 'rebuy', playerId: last.id, by: bt.meId, from: 0, to: 1000, at: 7000 },
    ])
    expect(iAmBroke(done)).toBe(false)
    // Докупать больше некого — кнопки нет
    expect(canTopUpAll(done)).toBe(false)
    expect(topUpAll(done, 8000)).toEqual({ ok: false, error: 'У всех уже стартовый стек или больше' })
  })

  it('у всех стартовый стек и больше или идёт раздача — нельзя, стол как был', () => {
    expect(canTopUpAll(start())).toBe(false)
    expect(canTopUpAll(withChips(start({ bots: 2 }), [1000, 1200, 3000]))).toBe(false)
    let dealing = ok(dealBotHand(start({ bots: 2 }), 0, bytesOf(seededRandom(9))))
    dealing = { ...dealing, table: { ...dealing.table, players: dealing.table.players.map((p, i) => (i === 1 ? { ...p, chips: 10 } : p)) } }
    expect(canTopUpAll(dealing)).toBe(false)
    expect(topUpAll(dealing, 0)).toEqual({ ok: false, error: 'Докупить всех — между раздачами' })
  })

  it('на отсчёте — отсчёт как шёл; в «Перерыве» — перерыв остаётся; мои фишки кончились — после докупа снова сами', () => {
    const FAST = AUTO_START_MS.fast
    const t = played({ bots: 2, autoStart: 'fast' }, 31)
    expect(botNextHandAt(t)).toBe(FAST)
    const short = withChips(t, [500, 2000, 300])
    const counted = ok(topUpAll(short, 1000))
    expect(counted.table.players.map((p) => p.chips)).toEqual([1000, 2000, 1000])
    expect(botNextHandAt(counted)).toBe(FAST)
    // В «Перерыве»
    const paused = ok(topUpAll(ok(botPause(short, true, 1000)), 2000))
    expect(botTableView(paused, 2000).paused).toBe(true)
    expect(botNextHandAt(paused)).toBeNull()
    expect(paused.table.players.map((p) => p.chips)).toEqual([1000, 2000, 1000])
    // У меня ноль: раздача сама снята; докуп всех — снова через полную паузу, раздача идёт
    const broke = ok(botPause(ok(botPause(withChips(t, [0, 2500, 500]), true, 3000)), false, 3000))
    expect(iAmBroke(broke)).toBe(true)
    expect(botNextHandAt(broke)).toBeNull()
    const back = ok(topUpAll(broke, 4000))
    expect(back.table.players.map((p) => p.chips)).toEqual([1000, 2500, 1000])
    expect(botNextHandAt(back)).toBe(4000 + FAST)
    expect(ok(autoDealBotHand(back, 4000 + FAST, bytesOf(seededRandom(32)))).table.hand).not.toBeNull()
  })
})
