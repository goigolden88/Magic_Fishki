import { describe, expect, it } from 'vitest'
import { CLOSE_ENDED, CLOSE_NO_ROOM, CLOSE_REPLACED, CLOSE_VERSION, NO_ROOM, VERSION_ERROR, WRONG_PASSWORD } from '../poker/protocol'
import {
  closeKind,
  createFailure,
  DEFAULT_SERVER,
  errorKind,
  parseRoomLink,
  retryDelay,
  roomHash,
  roomLink,
  roomsUrl,
  serverBase,
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
