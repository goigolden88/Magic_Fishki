// «Прогнать несколько раз» (#167, Р-58): все оставшиеся в раздаче олл-ин до ривера, а стол разрешает
// (настройка maxRuns) — каждый из них выбирает, сколько раз прогнать: 1, 2 или 3 до срока; не ответил — 1.
// Прогоняется наименьшее из выбранного. Только карты на телефонах: живые борд раздаёт человек.
// Правила хода выбора и раздача банков — в table.ts, деление по бордам — awardRuns (hand.ts); здесь — типы и счёт

// До скольких раз стол разрешает прогнать: 1 — нет (и нет поля у столов до #167), 2 — до двух, 3 — до трёх
export type MaxRuns = 1 | 2 | 3

export const MAX_RUNS: readonly MaxRuns[] = [1, 2, 3]

// Сколько идёт выбор, мс
export const RUN_VOTE_MS = 10_000

// Идёт выбор. hand — номер раздачи; max — сколько можно выбрать (стол и колода); players — дошедшие до вскрытия
// по местам; answers — их выбор
export type RunVote = {
  hand: number
  max: number
  deadline: number
  players: string[]
  answers: Record<string, number>
}

export function isMaxRuns(x: unknown): x is MaxRuns {
  return (MAX_RUNS as readonly unknown[]).includes(x)
}

// Выбор окончен: ответили все, кто-то выбрал 1 (меньше уже не будет) или вышел срок
export function runVoteDone(vote: RunVote, now: number): boolean {
  const picks = vote.players.map((id) => vote.answers[id])
  return now >= vote.deadline || picks.includes(1) || picks.every((x) => x !== undefined)
}

// Сколько раз прогнать: наименьшее из выбранного, не ответил — 1
export function runCount(vote: RunVote): number {
  return Math.min(...vote.players.map((id) => vote.answers[id] ?? 1))
}
