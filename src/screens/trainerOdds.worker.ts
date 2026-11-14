// Фоновый поток эквити тренажёра (#212): считает rangeEquity и отвечает тем же ключом
import { rangeEquity } from '../calc/rangeEquity'
import type { TrainerReply, TrainerRequest } from './trainerOddsClient'

self.onmessage = (e: MessageEvent<TrainerRequest>) => {
  const { key, sides, board } = e.data
  const reply: TrainerReply = { key, result: rangeEquity(sides, board) }
  self.postMessage(reply)
}
