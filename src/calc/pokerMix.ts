// «Микс» на экране стола (#166, Р-57): что видит игрок между раздачами — кнопку «Предложить игру»
// (он батон), голосование с отсчётом или итог. Правила голосования — в src/poker/table.ts
import type { GameId } from '../poker/game'
import { mixProposeError, mixProposer, type TableState } from '../poker/table'
import { GAME_CHOICES } from './quickRoom'

// Название игры в нужном падеже: «предлагает омаху», «остаёмся в омахе», «раздача — омаха»
const GAME_WORDS: Record<GameId, { nom: string; acc: string; loc: string }> = {
  holdem: { nom: 'холдем', acc: 'холдем', loc: 'холдем' },
  omaha: { nom: 'омаха', acc: 'омаху', loc: 'омахе' },
  shortdeck: { nom: 'шорт-дек', acc: 'шорт-дек', loc: 'шорт-деке' },
}

export type MixView =
  // Я — батон: выбрать игру, кроме идущей
  | { kind: 'propose'; choices: [GameId, string][] }
  // Батон может предложить игру — ждём его (или ведущий начнёт раздачу)
  | { kind: 'idle'; line: string }
  // Идёт голосование. canVote — я голосую; answer — мой ответ (null — нет); canCancel — ведущему «Без смены»
  | {
      kind: 'vote'
      line: string
      left: number
      canVote: boolean
      answer: boolean | null
      canCancel: boolean
      tally: string
    }
  // Итог голосования между этими раздачами
  | { kind: 'result'; line: string }

// null — «Микс» выключен, идёт раздача или сказать нечего
export function mixView(table: TableState, me: string, now: number): MixView | null {
  if (!table.settings.mix || table.hand) return null
  const nameOf = (id: string) => table.players.find((p) => p.id === id)?.name ?? 'Батон'
  const vote = table.mixVote
  if (vote) {
    const words = GAME_WORDS[vote.game]
    const seated = vote.voters.filter((id) => table.players.some((p) => p.id === id))
    const yes = seated.filter((id) => vote.answers[id] === true).length + 1 // предложивший — «За»
    const no = seated.filter((id) => vote.answers[id] === false).length
    const waiting = seated.length + 1 - yes - no
    const mine = vote.by === me
    return {
      kind: 'vote',
      line: mine ? `Вы предложили ${words.acc}` : `${nameOf(vote.by)} (батон) предлагает ${words.acc}`,
      left: Math.max(0, Math.ceil((vote.deadline - now) / 1000)),
      canVote: vote.voters.includes(me),
      answer: Object.hasOwn(vote.answers, me) ? vote.answers[me] : null,
      canCancel: me === table.hostId,
      tally: `За ${yes} · Против ${no}${waiting > 0 ? ` · не ответили ${waiting}` : ''}`,
    }
  }
  if (mixProposeError(table, me) === null) {
    const current = table.settings.game ?? 'holdem'
    return { kind: 'propose', choices: GAME_CHOICES.filter(([id]) => id !== current) }
  }
  const result = table.mixResult
  if (result && result.after === table.handCount) {
    if (result.changed) return { kind: 'result', line: `Следующая раздача — ${GAME_WORDS[result.game].nom}` }
    const why = result.cancelled ? 'ведущий оставил игру' : `против ${result.against} из ${result.total}`
    return { kind: 'result', line: `Остаёмся в ${GAME_WORDS[result.from].loc} — ${why}` }
  }
  const proposer = mixProposer(table)
  if (proposer && typeof table.tournament?.endedAt !== 'number') {
    return { kind: 'idle', line: `Игру может сменить батон — ${nameOf(proposer)}` }
  }
  return null
}
