import { useEffect, useRef, type RefObject } from 'react'
import type { Flight } from '../calc/dealAnimation'

// Полёт карт раздачи (#133) на экране: CSS-анимация card-fly (styles.css) на уже стоящих картах.
// Карта помечена data-fly — ключом из плана (dealAnimation); откуда летят — элемент с data-fly-origin
// (центр стола). Раскладку не трогает: карта стоит на своём месте, сдвинута только transform на время полёта.
// Полёт ничего не ждёт и не блокирует — кнопки и ход работают как без него

const cards = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-fly]')]

function land(el: HTMLElement) {
  el.style.animation = ''
  el.style.removeProperty('--fly-x')
  el.style.removeProperty('--fly-y')
}

// Все карты стола — сразу на места: старая раздача не доигрывается поверх новой, вернулись на вкладку — карты лежат
export function landAll(root: HTMLElement) {
  for (const el of cards(root)) land(el)
}

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })

// Проиграть план: карты из плана — с начала, из центра стола к своим местам
export function playFlights(root: HTMLElement, flights: Flight[]) {
  const plan = new Map(flights.map((f) => [f.key, f]))
  const els = cards(root).filter((el) => plan.has(el.dataset.fly ?? ''))
  // Сначала — на места (и замер после этого: карта в полёте сдвинута), потом — новый полёт
  els.forEach(land)
  const origin = root.querySelector<HTMLElement>('[data-fly-origin]')
  if (!origin) return
  const from = center(origin.getBoundingClientRect())
  const jobs = els.map((el) => {
    const to = center(el.getBoundingClientRect())
    return { el, f: plan.get(el.dataset.fly ?? '') as Flight, dx: from.x - to.x, dy: from.y - to.y }
  })
  for (const { el, f, dx, dy } of jobs) {
    el.style.setProperty('--fly-x', `${Math.round(dx)}px`)
    el.style.setProperty('--fly-y', `${Math.round(dy)}px`)
    // backwards: до вылета — в центре и не видна; после посадки — снова свои стили (приглушённая — приглушена)
    el.style.animation = `card-fly ${f.ms}ms ease-out ${f.delay}ms backwards`
  }
}

// Ушли с вкладки или вернулись — полёт не доигрывать: карты уже лежат; onLand — что ещё сделать экрану
export function useLandOnHide(ref: RefObject<HTMLElement | null>, onLand?: () => void) {
  const after = useRef(onLand)
  after.current = onLand
  useEffect(() => {
    const onVisibility = () => {
      if (ref.current) landAll(ref.current)
      after.current?.()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [ref])
}
