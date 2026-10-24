// Сообщения клиента и сервера стола. Их берут сервер комнат и экран — версия одна на всех:
// клиент с другой версией получает отказ «обновите приложение»
import type { Settings, TableState } from './table'

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

// Сообщения комнаты — их разбирает сервер комнат, не стол.
// join — первое сообщение после подключения: с playerId и token — возврат на своё место,
// иначе (или токен чужой) — посадка новым игроком под именем name
export type RoomMessage = { v: number } & (
  | { type: 'join'; name?: string; playerId?: string; token?: string }
  | { type: 'finish' } // ведущий: игра окончена — комната стирается
)

// Создание комнаты: POST /rooms. Пароль компании — секрет сервера ROOM_PASSWORD
export type CreateRoomRequest = { v: number; password: string; name: string; settings?: Partial<Settings> }
export type CreateRoomResponse = { v: number } & ({ code: string; playerId: string; token: string } | { error: string })

export type ServerMessage = { v: number } & (
  | { type: 'welcome'; playerId: string; token: string } // токен возврата на своё место
  | { type: 'state'; table: TableState }
  | { type: 'ended'; table: TableState; reason: string } // комната стёрта; table — стол на момент конца
  | { type: 'error'; error: string }
)
