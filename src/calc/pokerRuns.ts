// «Прогнать несколько раз» на экране стола (#167, Р-58): выбор дошедших с отсчётом и борды прошлой раздачи.
// Правила выбора — в src/poker/table.ts, деление банков — awardRuns (src/poker/hand.ts)
import type { Card } from '../poker/cards'
import type { HandRecord, TableState } from '../poker/table'

// Идёт выбор. canChoose — я в олл-ине и выбираю: кнопки 1…max; answer — мой выбор (null — нет);
// waiting — кто ещё не ответил, по именам
export type RunView = {
  line: string
  left: number
  canChoose: boolean
  choices: number[]
  answer: number | null
  waiting: string[]
}

// null — выбора нет
export function runView(table: TableState, me: string, now: number): RunView | null {
  const vote = table.runVote
  if (!vote || !table.hand || table.hand.number !== vote.hand) return null
  const nameOf = (id: string) => table.players.find((p) => p.id === id)?.name ?? 'Ушёл'
  const canChoose = vote.players.includes(me)
  return {
    line: canChoose ? 'Сколько раз прогнать?' : `${vote.players.map(nameOf).join(', ')} выбирают, сколько раз прогнать`,
    left: Math.max(0, Math.ceil((vote.deadline - now) / 1000)),
    canChoose,
    choices: Array.from({ length: vote.max }, (_, k) => k + 1),
    answer: canChoose && Object.hasOwn(vote.answers, me) ? vote.answers[me] : null,
    waiting: vote.players.filter((id) => !Object.hasOwn(vote.answers, id)).map(nameOf),
  }
}

// Борд прошлой раздачи: карты, подсветка пятёрок взявших и кто что взял — «Аня — Две пары, тузы и короли»;
// банков несколько — по банкам: «Основной: Аня; побочный: Боря»
export type RunBoardView = { label: string; cards: Card[]; win: Card[]; winners: string }

// Прогнали несколько раз — борды по порядку; прогон один — null
export function runBoards(record: HandRecord | undefined, potLabels: string[]): RunBoardView[] | null {
  const runs = record?.runs
  if (!record || !runs || runs.length < 2) return null
  const names = new Map(record.seats.map((s) => [s.id, s.name]))
  const nameOf = (id: string) => names.get(id) ?? 'Ушёл'
  return runs.map((run, b) => {
    const ids = [...new Set(run.winners.flat())]
    const who = (list: string[]) => list.map((id) => `${nameOf(id)} — ${run.hands[id] ?? ''}`.replace(/ — $/, '')).join(', ')
    const same = run.winners.every((w) => w.join() === run.winners[0].join())
    const winners = same
      ? who(run.winners[0] ?? [])
      : run.winners.map((w, k) => `${potLabels[k] ?? `Банк ${k + 1}`}: ${w.map(nameOf).join(', ')}`).join('; ')
    return {
      label: `Борд ${b + 1}`,
      cards: run.board,
      win: run.board.filter((c) => ids.some((id) => run.best[id]?.includes(c))),
      winners,
    }
  })
}
