// Фоновый поток шансов казино-стола (#137): считает casinoOdds и отвечает тем же ключом
import { casinoOdds } from '../calc/casinoOdds'
import type { OddsReply, OddsRequest } from './casinoOddsClient'

self.onmessage = (e: MessageEvent<OddsRequest>) => {
  const { key, deal, stake, visible } = e.data
  const reply: OddsReply = { key, odds: casinoOdds(deal, stake, visible) }
  self.postMessage(reply)
}
