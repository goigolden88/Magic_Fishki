import type { Entry, Player } from '../model'

export type PlayerTotal = {
  playerId: string
  chipsIn: number // закупы + докупы
  chipsOut: number // выходы
  chips: number // out − in
  kopecks: number // chips × курс, в копейках
  hasCashout: boolean
}

export type Balance = {
  chipsIn: number
  chipsOut: number
  diff: number // in − out: > 0 — не хватает фишек, < 0 — выведено лишнее
  ok: boolean
}

// Фишки → копейки, округление до копейки (половина — от нуля, одинаково для плюса и минуса)
export function toKopecks(chips: number, rate: number): number {
  const exact = chips * rate * 100
  const rounded = Math.round(Math.abs(exact))
  return exact < 0 && rounded > 0 ? -rounded : rounded
}

export function playerTotals(players: Player[], entries: Entry[], rate: number): PlayerTotal[] {
  return players.map((p) => {
    let chipsIn = 0
    let chipsOut = 0
    let hasCashout = false
    for (const e of entries) {
      if (e.playerId !== p.id) continue
      if (e.kind === 'cashout') {
        chipsOut += e.chips
        hasCashout = true
      } else {
        chipsIn += e.chips
      }
    }
    const chips = chipsOut - chipsIn
    return { playerId: p.id, chipsIn, chipsOut, chips, kopecks: toKopecks(chips, rate), hasCashout }
  })
}

export function balance(totals: PlayerTotal[]): Balance {
  let chipsIn = 0
  let chipsOut = 0
  for (const t of totals) {
    chipsIn += t.chipsIn
    chipsOut += t.chipsOut
  }
  const diff = chipsIn - chipsOut
  return { chipsIn, chipsOut, diff, ok: diff === 0 }
}
