// Эквити тренажёра (#212, Р-73) считается в фоне — в отдельном потоке (trainerOdds.worker.ts): выборка
// диапазонов — доли секунды на слабом телефоне, а сетка 13 × 13 и поля ждать не должны. По образцу
// шансов казино-стола (casinoOddsClient): одно состояние за раз; пришло новое, пока идёт счёт, — после
// него только самое свежее. Ответ один на входы (зерно из входа) — хранится в памяти экрана
import { useEffect, useState } from 'react'
import type { Card } from '../poker/cards'
import { rangeEquity, type EquitySide, type RangeEquity } from '../calc/rangeEquity'

export type TrainerRequest = { key: string; sides: EquitySide[]; board: Card[] }
export type TrainerReply = { key: string; result: RangeEquity }
// result — ответ на эти входы или, пока они считаются, последний посчитанный (null — ещё ни одного);
// counting — эти входы ещё считаются
export type TrainerOdds = { result: RangeEquity | null; counting: boolean }

const CACHE_SIZE = 32
const cache = new Map<string, RangeEquity>()
let latest: RangeEquity | null = null
const listeners = new Set<() => void>()

let worker: Worker | null | undefined // undefined — ещё не заводили; null — нет, считаем здесь же
let current: TrainerRequest | null = null
let queued: TrainerRequest | null = null

function remember(key: string, result: RangeEquity) {
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  cache.set(key, result)
  latest = result
}

function finish(reply: TrainerReply) {
  if (current && current.key === reply.key) remember(reply.key, reply.result)
  current = null
  const next = queued
  queued = null
  if (next && !cache.has(next.key)) start(next)
  listeners.forEach((wake) => wake())
}

// Без потока (не завёлся или упал) — тот же счёт здесь, следующим шагом экрана
function local(req: TrainerRequest) {
  setTimeout(() => finish({ key: req.key, result: rangeEquity(req.sides, req.board) }), 0)
}

function background(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./trainerOdds.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<TrainerReply>) => finish(e.data)
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

function start(req: TrainerRequest) {
  current = req
  const w = background()
  if (w) w.postMessage(req)
  else local(req)
}

function request(req: TrainerRequest) {
  if (cache.has(req.key) || current?.key === req.key) return
  if (current) queued = req
  else start(req)
}

// Эквити сторон на борде; sides null — считать нечего (поля не заполнены)
export function useTrainerOdds(sides: EquitySide[] | null, board: Card[]): TrainerOdds {
  const [, setTick] = useState(0)
  const key = sides ? JSON.stringify([sides, board]) : null

  useEffect(() => {
    const wake = () => setTick((t) => t + 1)
    listeners.add(wake)
    return () => {
      listeners.delete(wake)
    }
  }, [])

  useEffect(() => {
    if (sides && key) request({ key, sides, board })
  }, [key]) // стороны и борд — в key

  if (!key) return { result: null, counting: false }
  const done = cache.get(key)
  return done ? { result: done, counting: false } : { result: latest, counting: true }
}
