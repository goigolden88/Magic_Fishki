// Сообщения клиента и сервера стола. Их берут сервер комнат и экран — версия одна на всех:
// клиент с другой версией получает отказ «обновите приложение»
import type { TableState } from './table'

export const PROTOCOL_VERSION = 1

export const VERSION_ERROR = 'Другая версия приложения — обновите приложение'

// Ход игрока. raise.to — до какой ставки на этой улице поднимает (и первая ставка улицы)
export type BetAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }
  | { type: 'allin' }

// Тело сообщения; кто прислал — знает сервер по соединению
export type ClientBody =
  | { type: 'sit'; name: string } // сесть за стол
  | { type: 'start' } // ведущий: новая раздача
  | { type: 'act'; action: BetAction }
  | { type: 'skip' } // ведущий: ход за отошедшего — чек, если можно, иначе сброс
  | { type: 'award'; winners: string[][] } // ведущий: победители каждого банка, по порядку банков
  | { type: 'rebuy'; amount: number } // игрок просит докуп
  | { type: 'rebuyAnswer'; playerId: string; approve: boolean } // ведущий: «да» или «нет»
  | { type: 'setStack'; playerId: string; chips: number } // ведущий: правка стека между раздачами
  | { type: 'sitOut'; sittingOut: boolean; playerId?: string } // пропуск раздач; за другого — ведущий
  | { type: 'remove'; playerId: string } // ведущий: убрать игрока со стола
  | { type: 'passHost'; to: string } // ведущий: передать ведение
  | { type: 'takeHost' } // взять ведение, если ведущий вне сети дольше минуты

export type ClientMessage = ClientBody & { v: number }

export type ServerMessage = { v: number } & (
  | { type: 'welcome'; playerId: string; token: string } // токен возврата на своё место
  | { type: 'state'; table: TableState }
  | { type: 'error'; error: string }
)
