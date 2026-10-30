import { describe, expect, it } from 'vitest'
import { CLOSE_ENDED, CLOSE_NO_ROOM, CLOSE_REPLACED, CLOSE_VERSION, NO_ROOM, VERSION_ERROR, WRONG_PASSWORD } from '../poker/protocol'
import {
  BAD_SERVER,
  closeKind,
  createFailure,
  DEFAULT_SERVER,
  errorKind,
  parseRoomLink,
  retryDelay,
  roomHash,
  roomLink,
  roomServer,
  roomsUrl,
  serverBase,
  serverHost,
  socketUrl,
} from './pokerLink'

describe('покер онлайн: адреса и ссылки', () => {
  it('адрес сервера: пусто — постоянный, свой — без косой черты в конце, не адрес — null', () => {
    expect(serverBase('')).toBe(DEFAULT_SERVER)
    expect(serverBase('   ')).toBe(DEFAULT_SERVER)
    expect(serverBase(' https://reserve.example.dev/ ')).toBe('https://reserve.example.dev')
    expect(serverBase('http://localhost:8787')).toBe('http://localhost:8787')
    expect(serverBase('reserve.example.dev')).toBeNull()
    expect(serverBase('https://с пробелом')).toBeNull()
  })

  it('запросы и WebSocket — на тот же сервер', () => {
    expect(roomsUrl(DEFAULT_SERVER)).toBe('https://fishki-poker.goigolden88.workers.dev/rooms')
    expect(socketUrl(DEFAULT_SERVER, 'KQ7MZP')).toBe('wss://fishki-poker.goigolden88.workers.dev/rooms/KQ7MZP')
    expect(socketUrl('http://localhost:8787', 'KQ7MZP')).toBe('ws://localhost:8787/rooms/KQ7MZP')
  })

  it('ссылка на комнату — адрес сайта без ?app и с кодом; «пересадить» — ещё и место', () => {
    const site = 'https://goigolden88.github.io/Magic_Fishki/?app=fishki#/poker'
    expect(roomLink(site, 'KQ7MZP')).toBe('https://goigolden88.github.io/Magic_Fishki/#/poker/KQ7MZP')
    expect(roomLink(site, 'KQ7MZP', { playerId: 'id1', token: 'tok' })).toBe(
      'https://goigolden88.github.io/Magic_Fishki/#/poker/KQ7MZP/id1/tok',
    )
    expect(roomHash('KQ7MZP')).toBe('#/poker/KQ7MZP')
  })

  it('вставленная ссылка или код → комната и место', () => {
    expect(parseRoomLink('https://goigolden88.github.io/Magic_Fishki/#/poker/KQ7MZP')).toEqual({ code: 'KQ7MZP' })
    expect(parseRoomLink(' kq7mzp ')).toEqual({ code: 'KQ7MZP' })
    expect(parseRoomLink('Заходите: https://x.io/Magic_Fishki/#/poker/KQ7MZP/id1/tok')).toEqual({
      code: 'KQ7MZP',
      seat: { playerId: 'id1', token: 'tok' },
    })
    expect(parseRoomLink('https://x.io/#/game/abc')).toBeNull()
    expect(parseRoomLink('KQ7')).toBeNull()
    expect(parseRoomLink('')).toBeNull()
  })
})

describe('покер онлайн: свой сервер в ссылке (#83)', () => {
  const site = 'https://goigolden88.github.io/Magic_Fishki/?app=fishki#/poker'
  const own = 'https://poker.example.dev'
  const ownParam = '?server=https%3A%2F%2Fpoker.example.dev'
  const seat = { playerId: 'id1', token: 'tok' }

  it('ссылка своего сервера несёт его адрес, постоянного — как была', () => {
    expect(roomLink(site, 'KQ7MZP', undefined, own)).toBe(`https://goigolden88.github.io/Magic_Fishki/#/poker/KQ7MZP${ownParam}`)
    expect(roomLink(site, 'KQ7MZP', seat, own)).toBe(`https://goigolden88.github.io/Magic_Fishki/#/poker/KQ7MZP/id1/tok${ownParam}`)
    expect(roomLink(site, 'KQ7MZP', seat, DEFAULT_SERVER)).toBe('https://goigolden88.github.io/Magic_Fishki/#/poker/KQ7MZP/id1/tok')
    expect(roomHash('KQ7MZP', undefined, DEFAULT_SERVER)).toBe('#/poker/KQ7MZP')
  })

  it('разбор ссылки с адресом: комната, место и сервер; со страницы «Домой» (?app) — тоже', () => {
    expect(parseRoomLink(roomLink(site, 'KQ7MZP', undefined, own))).toEqual({ code: 'KQ7MZP', server: own })
    expect(parseRoomLink(`Заходите: https://x.io/?app=fishki#/poker/kq7mzp/id1/tok${ownParam}`)).toEqual({
      code: 'KQ7MZP',
      seat,
      server: own,
    })
    expect(parseRoomLink(`#/poker/KQ7MZP?server=${encodeURIComponent('http://localhost:8787/')}`)).toEqual({
      code: 'KQ7MZP',
      server: 'http://localhost:8787',
    })
    // Постоянный сервер, вписанный в ссылку руками, — как ссылка без адреса
    expect(parseRoomLink(`#/poker/KQ7MZP?server=${encodeURIComponent(DEFAULT_SERVER)}`)).toEqual({ code: 'KQ7MZP' })
  })

  it('кривой адрес в ссылке — ошибка, а не запрос куда попало', () => {
    for (const bad of ['', 'poker.example.dev', 'ftp%3A%2F%2Fx.dev', 'https%3A%2F%2F%D1%81%20%D0%BF', '%E0%A4%A']) {
      expect(parseRoomLink(`https://x.io/#/poker/KQ7MZP?server=${bad}`), bad).toEqual({ error: BAD_SERVER })
    }
    expect(parseRoomLink('https://x.io/#/poker/KQ7MZP?other=1')).toBeNull()
  })

  it('сервер комнаты: из ссылки, иначе из места, иначе из «Настроек»; место — только для своего сервера', () => {
    const old = { playerId: 'id1', token: 'tok' } // место, запомненное до #83, — без сервера
    expect(roomServer(undefined, null, '')).toEqual({ base: DEFAULT_SERVER, seat: null })
    expect(roomServer(undefined, old, own)).toEqual({ base: own, seat })
    expect(roomServer(undefined, old, 'не адрес')).toEqual({ base: DEFAULT_SERVER, seat })
    expect(roomServer(own, null, '')).toEqual({ base: own, seat: null })
    expect(roomServer(undefined, { ...seat, server: own }, '')).toEqual({ base: own, seat })
    expect(roomServer(own, { ...seat, server: own }, 'https://other.dev')).toEqual({ base: own, seat })
    // Токен места с другого сервера не уходит на сервер из ссылки
    expect(roomServer(own, old, '')).toEqual({ base: own, seat: null })
    expect(roomServer(own, { ...seat, server: 'https://other.dev' }, own)).toEqual({ base: own, seat: null })
  })

  it('строка «Сервер: …» — имя хоста, у постоянного сервера её нет', () => {
    expect(serverHost(own)).toBe('poker.example.dev')
    expect(serverHost('http://localhost:8787')).toBe('localhost:8787')
    expect(serverHost(DEFAULT_SERVER)).toBeNull()
  })
})

describe('покер онлайн: что сказать при отказе', () => {
  it('создание комнаты: неверный пароль — ввести снова; старая версия — обновить', () => {
    expect(createFailure(WRONG_PASSWORD).kind).toBe('password')
    expect(createFailure(VERSION_ERROR).kind).toBe('update')
    expect(createFailure('Комнат уже 10')).toEqual({ kind: 'other', text: 'Комнат уже 10' })
  })

  it('соединение закрыто сервером: конец комнаты, версия, другое устройство; остальное — переподключаться', () => {
    expect([CLOSE_ENDED, CLOSE_NO_ROOM, CLOSE_VERSION, CLOSE_REPLACED, 1006, 1000].map(closeKind)).toEqual([
      'closed',
      'closed',
      'update',
      'replaced',
      'retry',
      'retry',
    ])
    expect([NO_ROOM, VERSION_ERROR, 'Сейчас не ваш ход'].map(errorKind)).toEqual(['closed', 'update', 'message'])
  })

  it('пауза между попытками растёт до 10 секунд', () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 10_000, 10_000])
  })
})
