// Шансы казино-стола (#137) считаются в фоне — в отдельном потоке (casinoOdds.worker.ts): выборка досдач
// на омахе — доли секунды на слабом телефоне, а переворот карт и кнопки ждать не должны.
// Считается одно состояние за раз; пришло новое, пока идёт счёт, — после него только самое свежее.
// Ответ один на раздачу и открытые карты (зерно из раздачи) — хранится в памяти экрана
import { useEffect, useState } from 'react'
import { BOARD_CARDS, type Deal } from '../calc/casinoDeal'
import { casinoOdds, type CasinoOdds } from '../calc/casinoOdds'

export type OddsRequest = { key: string; deal: Deal; stake: number; visible: number[] }
export type OddsReply = { key: string; odds: CasinoOdds | null }

const CACHE_SIZE = 64
const cache = new Map<string, CasinoOdds | null>()
// Последние посчитанные у раздачи: пока свежие считаются, у стола — прошлые, строки не мигают
const latest = new WeakMap<Deal, CasinoOdds>()
const listeners = new Set<() => void>()

let worker: Worker | null | undefined // undefined — ещё не заводили; null — нет, считаем здесь же
let current: OddsRequest | null = null
let queued: OddsRequest | null = null

function remember(req: OddsRequest, odds: CasinoOdds | null) {
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  cache.set(req.key, odds)
  if (odds) latest.set(req.deal, odds)
}

function finish(reply: OddsReply) {
  if (current && current.key === reply.key) remember(current, reply.odds)
  current = null
  const next = queued
  queued = null
  if (next && !cache.has(next.key)) start(next)
  listeners.forEach((wake) => wake())
}

// Без потока (не завёлся или упал) — тот же счёт здесь, следующим шагом экрана
function local(req: OddsRequest) {
  setTimeout(() => finish({ key: req.key, odds: casinoOdds(req.deal, req.stake, req.visible) }), 0)
}

function background(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./casinoOdds.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<OddsReply>) => finish(e.data)
    worker.onerror = () => {
      worker?.terminate()
      worker = null
      if (current) local(current)
    }
  } catch {
    worker = null
  }
  return worker
}

function start(req: OddsRequest) {
  current = req
  const w = background()
  if (w) w.postMessage(req)
  else local(req)
}

function request(req: OddsRequest) {
  if (cache.has(req.key) || current?.key === req.key) return
  if (current) queued = req
  else start(req)
}

// Шансы раздачи при видимых картах столов (visible — по столу, 0…5). deal null — шансы выключены.
// Все столы открыты — сразу, без фона: там только победители; иначе — посчитанные или прошлые этой раздачи
export function useCasinoOdds(deal: Deal | null, stake: number, visible: number[]): CasinoOdds | null {
  const [, setTick] = useState(0)
  const key = deal ? JSON.stringify([deal, stake, visible]) : null
  const open = visible.every((v) => v >= BOARD_CARDS)

  useEffect(() => {
    const wake = () => setTick((t) => t + 1)
    listeners.add(wake)
    return () => {
      listeners.delete(wake)
    }
  }, [])

  useEffect(() => {
    if (deal && key && !open) request({ key, deal, stake, visible })
  }, [key]) // раздача, ставка и видимые карты — в key

  if (!deal || !key) return null
  if (open) {
    if (!cache.has(key)) remember({ key, deal, stake, visible }, casinoOdds(deal, stake, visible))
    return cache.get(key) ?? null
  }
  return cache.has(key) ? (cache.get(key) ?? null) : (latest.get(deal) ?? null)
}
