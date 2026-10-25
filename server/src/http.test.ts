import { describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION, VERSION_ERROR } from '../../src/poker/protocol'
import { createRoom, NO_PASSWORD, STATUS_TEXT, WRONG_PASSWORD, type CreateDeps } from './http'
import { FULL } from './registry'

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
    const r = await createRoom(body('пароль компании', { settings: { bb: 20, sb: 10, junk: 1 } }), d)
    expect(r).toEqual({ status: 200, body: { v: PROTOCOL_VERSION, code: 'KQ7MZP', playerId: 'host1', token: 'secret-token' } })
    expect(calls.inits).toEqual([['KQ7MZP', 'Ведущий', { bb: 20, sb: 10 }, [], null]])
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

  it('стол не создался (нет имени) — место в реестре освобождается', async () => {
    const { d, calls } = deps('p', { init: async () => ({ ok: false, error: 'Нужно имя' }) })
    expect(await createRoom(body('p', { name: ' ' }), d)).toEqual({ status: 400, body: { v: PROTOCOL_VERSION, error: 'Нужно имя' } })
    expect(calls.released).toEqual(['KQ7MZP'])
  })
})
