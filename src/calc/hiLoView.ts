// Хай/лоу своей игры на экране (#227): рука с лоу и делёж каждого банка строкой. Сам делёж — awardRuns
// (src/poker/hand.ts), запись — settle (src/poker/table.ts): lows, lowBest, split
import type { Card } from '../poker/cards'
import type { PotSplit } from '../poker/table'

// Старшая рука и лоу: «Флеш, старший туз · лоу 7-5-3-2-A»; лоу нет — только старшая
export function withLow(hand: string | null, low: string | null | undefined): string | null {
  if (!hand || !low) return hand
  return `${hand} · ${low[0].toLowerCase()}${low.slice(1)}`
}

type SplitSource = { split?: PotSplit[]; hands: Record<string, string>; lows?: Record<string, string> }

// Делёж одного банка: «Хай — Аня (Тройка, короли), лоу — Боря (Лоу 8-6-4-3-A)»; лоу нет — «Лоу нет — весь банк хаю»;
// оба у одних и тех же — «Аня — весь банк: хай и лоу»
export function splitText(split: PotSplit, hands: Record<string, string>, lows: Record<string, string>, nameOf: (id: string) => string): string {
  if (split.lo.length === 0) return 'Лоу нет — весь банк хаю'
  const names = (ids: string[]) => ids.map(nameOf).join(', ')
  if (split.hi.length === split.lo.length && split.hi.every((id) => split.lo.includes(id))) {
    return `${names(split.hi)} — весь банк: хай и лоу`
  }
  const what = (ids: string[], of: Record<string, string>) => (of[ids[0]] ? ` (${of[ids[0]]})` : '')
  return `Хай — ${names(split.hi)}${what(split.hi, hands)}, лоу — ${names(split.lo)}${what(split.lo, lows)}`
}

// Делёж всех банков записи или борда строками: банк один — без подписи, несколько — «Основной: …», «Побочный 1: …».
// Не хай/лоу — null
export function splitLines(source: SplitSource | undefined, nameOf: (id: string) => string, potLabels: string[]): string[] | null {
  const split = source?.split
  if (!source || !Array.isArray(split)) return null
  const lines = split.map((s) => splitText(s, source.hands ?? {}, source.lows ?? {}, nameOf))
  return lines.length === 1 ? lines : lines.map((line, k) => `${potLabels[k] ?? `Банк ${k + 1}`}: ${line}`)
}

// Пятёрки взявших банк: старшей половины — их старшая пятёрка, взявшего только лоу — пятёрка лоу
export function splitFives(source: SplitSource & { best?: Record<string, Card[]>; lowBest?: Record<string, Card[]> }): Map<string, Card[]> {
  const out = new Map<string, Card[]>()
  for (const s of source.split ?? []) {
    for (const id of s.hi) if (source.best?.[id]) out.set(id, source.best[id])
  }
  for (const s of source.split ?? []) {
    for (const id of s.lo) if (!out.has(id) && source.lowBest?.[id]) out.set(id, source.lowBest[id])
  }
  return out
}
