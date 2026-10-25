// Сообщения клиента и сервера стола. Их берут сервер комнат и экран — версия одна на всех:
// клиент с другой версией получает отказ «обновите приложение»
import type { Settings, TableState } from './table'

// 2 — список постоянных игроков комнаты (lobby), вход под постоянным (regularId), «пересадить» (reseat)
// 3 — признак жизни (PING): без него сервер считает игрока вне сети
export const PROTOCOL_VERSION = 3

export const VERSION_ERROR = 'Другая версия приложения — обновите приложение'

// Признак жизни: клиент шлёт PING каждые PING_MS, сервер отвечает PONG, не просыпаясь.
// Молчит дольше SILENT_MS — соединение мёртвое: сервер ставит «вне сети», клиент переподключается
export const PING = 'ping'
export const PONG = 'pong'
export const PING_MS = 15_000
export const SILENT_MS = 30_000

// Отказы сервера комнат, на которые экран отвечает по-своему
export const NO_ROOM = 'Комнаты нет'
export const WRONG_PASSWORD = 'Неверный пароль'

// Причина конца комнаты, когда ведущий нажал «Закончить игру»: игроки видят «итог — у ведущего»
export const FINISHED = 'Ведущий завершил игру'

// Коды закрытия соединения сервером комнат
export const CLOSE_ENDED = 4000 // комната стёрта
export const CLOSE_VERSION = 4001 // другая версия приложения
export const CLOSE_NO_ROOM = 4004
export const CLOSE_REPLACED = 4009 // место открыто на другом устройстве
export const CLOSE_SILENT = 4010 // нет признаков жизни дольше SILENT_MS — переподключиться

// Ход игрока. raise.to — до какой ставки на этой улице поднимает (и первая ставка улицы)
export type BetAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; to: number }
  | { type: 'allin' }

// Тело сообщения; кто прислал — знает сервер по соединению
export type ClientBody =
  | { type: 'sit'; name: string; regularId?: string } // сесть за стол; regularId — постоянный игрок
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
// иначе (или токен чужой) — посадка новым игроком: с regularId — под постоянным из списка
// комнаты (имя — из списка), без него — гостем под именем name
export type RoomMessage = { v: number } & (
  | { type: 'join'; name?: string; regularId?: string; playerId?: string; token?: string }
  | { type: 'finish' } // ведущий: игра окончена — комната стирается
  | { type: 'reseat'; playerId: string } // ведущий: новый токен игроку — для другого устройства, старый больше не пускает
)

// Постоянный игрок (Р-12), отмеченный ведущим при создании комнаты
export type RosterEntry = { id: string; name: string }

// Создание комнаты: POST /rooms. Пароль компании — секрет сервера ROOM_PASSWORD.
// roster — отмеченные постоянные; regularId — кто из них ведущий (нет — гость)
export type CreateRoomRequest = {
  v: number
  password: string
  name: string
  regularId?: string
  roster?: RosterEntry[]
  settings?: Partial<Settings>
}
export type CreateRoomResponse = { v: number } & ({ code: string; playerId: string; token: string } | { error: string })

export type ServerMessage = { v: number } & (
  // Сразу после подключения: кого выбрать при входе; seated — id постоянных, уже сидящих за столом
  | { type: 'lobby'; roster: RosterEntry[]; seated: string[] }
  | { type: 'welcome'; playerId: string; token: string } // токен возврата на своё место
  | { type: 'reseated'; playerId: string; token: string } // ведущему: новый токен игрока для ссылки
  | { type: 'state'; table: TableState }
  | { type: 'ended'; table: TableState; reason: string } // комната стёрта; table — стол на момент конца
  | { type: 'error'; error: string }
)
