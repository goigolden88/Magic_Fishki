// Покер за всё время (#164, Р-55): HUD постоянного игрока по раздачам всех вечеров, сохранённых на этом
// телефоне (хранилище hands, Р-37, Р-54), — тем же подсчётом, что HUD вечера за столом (addHand).
// Игрок за столом — по имени постоянного; гость с тем же именем не в счёт: с Р-55 запись помнит
// постоянных стола (EveningTable.regulars), у записей до неё — только имя
import type { Regular } from '../model'
import { addHand, type HudCounts, type HudHand } from '../poker/hud'
import type { SavedHand } from './evenings'

const EMPTY: HudCounts = { hands: 0, vpip: 0, pfr: 0, stealChances: 0, steals: 0, cbChances: 0, cbs: 0, raises: 0, calls: 0 }

const KEYS = Object.keys(EMPTY) as (keyof HudCounts)[]

// Счётчики постоянного за все сохранённые раздачи; не играл — hands: 0
export function allTimeHud(regular: Regular, saved: SavedHand[]): HudCounts {
  const total = { ...EMPTY }
  for (const s of saved) {
    const hand = hudHand(s)
    if (!hand) continue
    const id = seatOf(regular, s, hand.seats)
    if (id === null) continue
    const c = addHand({}, hand)[id]
    if (c) for (const k of KEYS) total[k] += c[k]
  }
  return total
}

// Место постоянного в раздаче: имя совпало и это не гость. Записи до Р-55 гостя не помнят —
// двое с этим именем в одной раздаче там не различить, такая раздача не в счёт
function seatOf(regular: Regular, s: SavedHand, seats: { id: string; name?: string }[]): string | null {
  const regulars = s.table?.regulars
  const mine = seats.filter((seat) => seat.name === regular.name && (!regulars || regulars[seat.id] !== undefined))
  return mine.length === 1 ? mine[0].id : null
}

// Раздача для addHand из записи: с картами — из её записи (record); живые карты — из live, блайнды —
// стола вечера (в турнире — стартовые: точнее записи нет). Ни того, ни другого — не в счёт
function hudHand(s: SavedHand): (HudHand & { seats: { id: string; name: string }[] }) | null {
  const record = s.hand.record
  if (record && Array.isArray(record.seats) && Array.isArray(record.log)) {
    const rounds = record.game?.rounds
    return {
      seats: record.seats,
      button: record.button,
      bb: record.bb,
      log: record.log,
      ...(Array.isArray(rounds) ? { cards: { game: { rounds } } } : {}),
    }
  }
  const live = s.hand.live
  if (live && Array.isArray(live.seats) && Array.isArray(live.log)) {
    return { seats: live.seats, button: live.button, bb: s.table?.bb ?? 0, log: live.log }
  }
  return null
}
