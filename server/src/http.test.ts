import { describe, expect, it } from 'vitest'
import { ownGamesError, type OwnGame } from '../../src/poker/ownGame'
import { PROTOCOL_VERSION, VERSION_ERROR } from '../../src/poker/protocol'
import { createRoom, NO_PASSWORD, STATUS_TEXT, WRONG_PASSWORD, type CreateDeps } from './http'
import { FULL } from './registry'
import { initRoom, type RoomRecord } from './room'
import { fakeRoom } from './testing'

function deps(password: string | undefined, over: Partial<CreateDeps> = {}) {
  const calls = { reserved: 0, inits: [] as unknown[][], released: [] as string[] }
  const d: CreateDeps = {
    password,
    reserve: async () => {
      calls.reserved++
      return { ok: true, code: 'KQ7MZP' }
    },
    init: async (...args) => {
      calls.inits.push(args)
      return { ok: true, playerId: 'host1', token: 'secret-token' }
    },
    release: async (code) => {
      calls.released.push(code)
    },
    ...over,
  }
  return { d, calls }
}

const body = (password: string, extra: Record<string, unknown> = {}) => ({ v: PROTOCOL_VERSION, password, name: 'Ведущий', ...extra })

describe('создание комнаты', () => {
  it('строка «работает» называет версию протокола', () => {
    expect(STATUS_TEXT).toBe(`Сервер покера «Фишек» работает, протокол ${PROTOCOL_VERSION}`)
  })

  it('верный пароль — код комнаты и токен ведущего', async () => {
    const { d, calls } = deps('пароль компании')
    // Вид стола (#77), турнир и анте (#78), игра и лимит (#80), «Микс» (#166), «Прогнать несколько раз» (#167),
    // запас времени (#223) — тоже настройки стола
    const look = {
      ...{ felt: 'blue', cardBack: 'geo', format: 'tournament', ante: 0, tournament: { buyIn: 500 }, game: 'omaha', limit: 'pot' },
      ...{ mix: true, mixAgainst: 'third', maxRuns: 2, timeBank: 30, games: [] },
    }
    const settings = { bb: 20, sb: 10, cards: 'phones', turnSeconds: 30, autoStart: 'fast', ...look, junk: 1 }
    const r = await createRoom(body('пароль компании', { settings }), d)
    expect(r).toEqual({ status: 200, body: { v: PROTOCOL_VERSION, code: 'KQ7MZP', playerId: 'host1', token: 'secret-token' } })
    expect(calls.inits).toEqual([
      ['KQ7MZP', 'Ведущий', { bb: 20, sb: 10, cards: 'phones', turnSeconds: 30, autoStart: 'fast', ...look }, [], null],
    ])
  })

  it('список постоянных: только верные строки без повторов; ведущий — из списка или гость', async () => {
    const { d, calls } = deps('p')
    const roster = [
      { id: 'r1', name: ' Анна ' },
      { id: 'r1', name: 'Анна ещё раз' },
      { id: 'r2', name: '' },
      { id: 3, name: 'Число' },
      'Борис',
      { id: 'r4', name: 'Борис' },
    ]
    await createRoom(body('p', { roster, regularId: 'r4' }), d)
    await createRoom(body('p', { roster, regularId: 'r2' }), d)
    await createRoom(body('p', { roster: 'не список' }), d)
    const anna = { id: 'r1', name: 'Анна' }
    const boris = { id: 'r4', name: 'Борис' }
    expect(calls.inits.map((args) => args.slice(3))).toEqual([
      [[anna, boris], 'r4'],
      [[anna, boris], null],
      [[], null],
    ])
  })

  it('неверный пароль — «неверный пароль», комната не создаётся', async () => {
    const { d, calls } = deps('пароль компании')
    for (const password of ['пароль', 'пароль компании!', '', 42]) {
      expect(await createRoom(body('', { password }), d)).toEqual({
        status: 403,
        body: { v: PROTOCOL_VERSION, error: WRONG_PASSWORD },
      })
    }
    expect(calls.reserved).toBe(0)
  })

  it('пароль на сервере не задан — комната не создаётся ни с каким паролем', async () => {
    for (const secret of [undefined, '']) {
      const { d, calls } = deps(secret)
      expect(await createRoom(body(''), d)).toEqual({ status: 503, body: { v: PROTOCOL_VERSION, error: NO_PASSWORD } })
      expect(calls.reserved).toBe(0)
    }
    expect(NO_PASSWORD).toBe('На сервере не задан пароль')
  })

  it('старая версия приложения — «обновите»', async () => {
    const { d, calls } = deps('p')
    expect(await createRoom({ ...body('p'), v: PROTOCOL_VERSION - 1 }, d)).toEqual({
      status: 400,
      body: { v: PROTOCOL_VERSION, error: VERSION_ERROR },
    })
    expect(await createRoom(null, d)).toMatchObject({ status: 400 })
    expect(calls.reserved).toBe(0)
  })

  it('комнат уже 10 — отказ реестра', async () => {
    const { d } = deps('p', { reserve: async () => ({ ok: false, error: FULL }) })
    expect(await createRoom(body('p'), d)).toEqual({ status: 409, body: { v: PROTOCOL_VERSION, error: FULL } })
  })

  it('свои игры (#224): описание доходит до стола; неверное — отказ 400 строкой проверки, комнаты нет', async () => {
    const omaha7: OwnGame = { id: 'own-o7', name: 'Омаха-7', hole: 7, fromHand: 2, deck: 52, order: 'standard', board: [3, 1, 1], limit: 'pot' }
    const withRoom = () => {
      const room = fakeRoom()
      const { d, calls } = deps('p', { init: (code, name, settings, roster, regularId) => initRoom(room.env, code, name, settings, 0, roster, regularId) })
      return { room, d, calls }
    }
    const good = withRoom()
    const settings = { cards: 'phones', games: [omaha7], game: omaha7.id, maxSeats: 6 }
    expect(await createRoom(body('p', { settings }), good.d)).toMatchObject({ status: 200, body: { code: 'KQ7MZP' } })
    const table = (await good.room.storage.get<RoomRecord>('room'))?.table
    expect(table?.settings).toMatchObject(settings)

    const many = Array.from({ length: 9 }, (_, i) => ({ ...omaha7, id: `own-g${i}`, hole: 2 }))
    for (const [games, maxSeats, error] of [
      [[{ ...omaha7, hole: 8 }], 6, '„Омаха-7“: карт на руках — от 2 до 7'],
      [[omaha7], 10, '„Омаха-7“: за столом не больше 6 — карт на всех не хватит'],
      [many, 6, 'Своих игр за столом — не больше 8'],
      [[{ ...omaha7, name: 'О'.repeat(200) }], 6, 'Название своей игры — не длиннее 24 знаков'],
    ] as [unknown[], number, string][]) {
      expect(ownGamesError(games, maxSeats)).toBe(error)
      const bad = withRoom()
      expect(await createRoom(body('p', { settings: { cards: 'phones', games, maxSeats } }), bad.d)).toEqual({
        status: 400,
        body: { v: PROTOCOL_VERSION, error },
      })
      expect(await bad.room.storage.get<RoomRecord>('room')).toBeUndefined()
      expect(bad.calls.released).toEqual(['KQ7MZP'])
    }
  })

  it('страддл (#222): галочка доходит до стола; не «да» и не «нет» — отказ 400, комнаты нет', async () => {
    const room = fakeRoom()
    const { d } = deps('p', { init: (code, name, settings, roster, regularId) => initRoom(room.env, code, name, settings, 0, roster, regularId) })
    expect(await createRoom(body('p', { settings: { straddle: true, ante: 2 } }), d)).toMatchObject({ status: 200, body: { code: 'KQ7MZP' } })
    expect((await room.storage.get<RoomRecord>('room'))?.table.settings).toMatchObject({ straddle: true, ante: 2 })

    const badRoom = fakeRoom()
    const bad = deps('p', { init: (code, name, settings, roster, regularId) => initRoom(badRoom.env, code, name, settings, 0, roster, regularId) })
    expect(await createRoom(body('p', { settings: { straddle: 'да' } }), bad.d)).toEqual({
      status: 400,
      body: { v: PROTOCOL_VERSION, error: 'Страддл — включён или выключен' },
    })
    expect(await badRoom.storage.get<RoomRecord>('room')).toBeUndefined()
    expect(bad.calls.released).toEqual(['KQ7MZP'])
  })

  it('стол не создался (нет имени) — место в реестре освобождается', async () => {
    const { d, calls } = deps('p', { init: async () => ({ ok: false, error: 'Нужно имя' }) })
    expect(await createRoom(body('p', { name: ' ' }), d)).toEqual({ status: 400, body: { v: PROTOCOL_VERSION, error: 'Нужно имя' } })
    expect(calls.released).toEqual(['KQ7MZP'])
  })
})
