// «Микс» (#166, Р-57): игра стола меняется между раздачами голосованием. Батон прошлой раздачи
// предлагает другую игру, остальные за столом — «За» или «Против» до срока; не ответил — «За».
// Смена — если «против» не больше доли, заданной ведущим (mixAgainst); новая игра держится до
// следующего предложения. Правила хода голосования — в table.ts, здесь — типы и счёт
import type { GameId } from './game'

// Доля «против», при которой смена ещё проходит: не больше трети, половины или двух третей голосовавших
export type MixShare = 'third' | 'half' | 'twothirds'

export const MIX_SHARES: Record<MixShare, { num: number; den: number }> = {
  third: { num: 1, den: 3 },
  half: { num: 1, den: 2 },
  twothirds: { num: 2, den: 3 },
}

// Нет поля — половина
export const MIX_SHARE_DEFAULT: MixShare = 'half'

// Сколько идёт голосование, мс
export const MIX_VOTE_MS = 15_000

// Идёт голосование. after — номер прошлой раздачи (handCount): одно предложение между раздачами;
// voters — кто голосует (играют следующую раздачу, кроме предложившего); answers — их ответы, true — «За»
export type MixVote = {
  after: number
  by: string
  from: GameId
  game: GameId
  deadline: number
  voters: string[]
  answers: Record<string, boolean>
}

// Итог голосования — видят все до конца следующей раздачи. cancelled — ведущий нажал «Без смены»
export type MixResult = {
  after: number
  from: GameId
  game: GameId
  changed: boolean
  against: number
  total: number
  cancelled?: boolean
}

// Смена проходит, если против ≤ доля × всех голосовавших (предложивший — тоже «За»)
export function mixPasses(against: number, total: number, share: MixShare = MIX_SHARE_DEFAULT): boolean {
  const { num, den } = MIX_SHARES[share]
  return against * den <= num * total
}

export function isMixShare(x: unknown): x is MixShare {
  return typeof x === 'string' && Object.hasOwn(MIX_SHARES, x)
}
