// Единственный вход в IndexedDB. База magic_fishki: хранилища games (ключ id), settings (одна запись)
// и hands — раздачи прошлых вечеров покера (ключ [evening, number], #114), charts — свои чарты тренажёра (ключ id, #215).
// С версии 5 (#264) — под синхронизацию между устройствами: удаление — пометкой deleted (чтения её пропускают),
// у каждой записи — время правки, dirty — что изменилось и ещё не отправлено, syncMeta — память синхронизации.
// dirty и syncMeta — этого устройства: не синхронизируются и в копию не входят
import { eveningSummaries, isBotsEvening, type EveningCounts, type EveningSummary, type SavedHand } from '../calc/evenings'
import { byName, type OwnChart } from '../calc/ownCharts'
import { linkRegulars, regularsFromNames, settingsWithDefaults, type Game, type Regular, type Settings } from '../model'
import type { HistoryHand } from '../poker/history'
import { ulid } from '../ulid'

const DB_NAME = 'magic_fishki'
const DB_VERSION = 5
const SETTINGS_KEY = 'settings'
const HANDS = 'hands'
const CHARTS = 'charts'
const DIRTY = 'dirty'
const SYNC_META = 'syncMeta'
const BY_EVENING = 'evening'

type StoreName = 'games' | 'settings' | typeof HANDS | typeof CHARTS | typeof DIRTY | typeof SYNC_META

// Отметка «изменилось, не отправлено» (#264): хранилище и ключ записи; local — ключ памяти браузера
// (fishki.poker.notes и прочие из копии, pokerStorage.ts). Одна отметка на запись: вторая правка её не множит
export type DirtyStore = 'games' | 'settings' | typeof HANDS | typeof CHARTS | 'local'
export type DirtyMark = { store: DirtyStore; key: string | [string, number] }

let opening: Promise<IDBDatabase> | null = null

// Миграции — по шагам от старой версии к новой; записи прежних версий не теряются
function migrate(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('games', { keyPath: 'id' })
    db.createObjectStore('settings')
  }
  if (oldVersion < 2) toRegularIds(tx)
  // Версия 3 (Р-37): только новое хранилище раздач; игры и настройки не трогаются
  if (oldVersion < 3) {
    const hands = db.createObjectStore(HANDS, { keyPath: ['evening', 'number'] })
    hands.createIndex(BY_EVENING, 'evening')
  }
  // Версия 4 (Р-77): только новое хранилище своих чартов; прежние записи не трогаются
  if (oldVersion < 4) db.createObjectStore(CHARTS, { keyPath: 'id' })
  // Версия 5 (#264): хранилища dirty и syncMeta; у раздач — время правки из начала вечера. Игры, настройки
  // и чарты не трогаются: у игр и чартов время правки уже есть, у настроек — с первой записи после миграции
  if (oldVersion < 5) {
    db.createObjectStore(DIRTY, { keyPath: ['store', 'key'] })
    db.createObjectStore(SYNC_META)
    stampHands(tx)
  }
}

// Версия 2 (Р-12): постоянные игроки — из строк в { id, name } с новыми id в прежнем порядке;
// участникам сохранённых игр с точно тем же именем — regularId. Остальное в играх не меняется
function toRegularIds(tx: IDBTransaction): void {
  const settings = tx.objectStore('settings')
  const read = settings.get(SETTINGS_KEY)
  read.onsuccess = () => {
    const stored: unknown = read.result
    let regulars: Regular[] = []
    if (typeof stored === 'object' && stored !== null && 'players' in stored && Array.isArray(stored.players)) {
      const names = stored.players.filter((p): p is string => typeof p === 'string')
      regulars = regularsFromNames(names, () => ulid())
      settings.put({ ...stored, players: regulars }, SETTINGS_KEY)
    }
    const cursor = tx.objectStore('games').openCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) return
      const game = c.value as Game
      const players = linkRegulars(game.players, regulars)
      if (players.some((p, i) => p !== game.players[i])) c.update({ ...game, players })
      c.continue()
    }
  }
}

// Миллисекунды → ISO; не число — начало отсчёта: запись не теряется из-за кривого времени
function isoAt(ms: number): string {
  return new Date(Number.isFinite(ms) ? ms : 0).toISOString()
}

// Версия 5: раздачам без времени правки — начало их вечера (startedAt); остальное в записи не меняется
function stampHands(tx: IDBTransaction): void {
  const cursor = tx.objectStore(HANDS).openCursor()
  cursor.onsuccess = () => {
    const c = cursor.result
    if (!c) return
    const hand = c.value as SavedHand
    if (typeof hand.updatedAt !== 'string') c.update({ ...hand, updatedAt: isoAt(hand.startedAt) })
    c.continue()
  }
}

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => migrate(req.result, req.transaction!, e.oldVersion)
    req.onsuccess = () => {
      const db = req.result
      // Открылась новая версия в другой вкладке — уступаем ей базу
      db.onversionchange = () => {
        db.close()
        opening = null
      }
      resolve(db)
    }
    req.onerror = () => {
      opening = null
      reject(req.error)
    }
  })
  return opening
}

async function run<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const req = fn(tx.objectStore(storeName))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

// Запись в несколько хранилищ одной транзакцией: либо всё, либо ничего. Итог body — в замыкании вызывающего
async function inTx(stores: StoreName[], body: (tx: IDBTransaction) => void): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(stores, 'readwrite')
    body(tx)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function markDirty(tx: IDBTransaction, mark: DirtyMark): void {
  tx.objectStore(DIRTY).put(mark)
}

const now = () => new Date().toISOString()

// Помеченные удалёнными — мимо: для человека их нет
function live<T extends { deleted?: true }>(records: T[]): T[] {
  return records.filter((r) => r.deleted !== true)
}

// Пометка удаления снимается: запись снова живая (сохранение, восстановление из копии)
function alive<T extends { deleted?: true }>(record: T): T {
  if (record.deleted === undefined) return record
  const { deleted: _deleted, ...rest } = record
  return rest as T
}

const handKey = (h: SavedHand): [string, number] => [h.evening, h.number]

// Новые сверху: по дню игры, в один день — по времени создания (ULID растёт со временем)
export async function listGames(): Promise<Game[]> {
  const games = live(await run<Game[]>('games', 'readonly', (s) => s.getAll()))
  return games.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

export async function getGame(id: string): Promise<Game | undefined> {
  const game = await run<Game | undefined>('games', 'readonly', (s) => s.get(id))
  return game?.deleted ? undefined : game
}

// Демо-игры (Р-04) не синхронизируются никогда — отметки «не отправлено» у них нет
export async function saveGame(game: Game): Promise<Game> {
  const saved = { ...alive(game), updatedAt: now() }
  await inTx(['games', DIRTY], (tx) => {
    tx.objectStore('games').put(saved)
    if (!saved.demo) markDirty(tx, { store: 'games', key: saved.id })
  })
  return saved
}

// Восстановление из файла-копии (Р-11) и демо-игры (Р-04): игры пишутся как есть, со своим updatedAt;
// одной транзакцией — либо все, либо ни одной. Живые игры с тем же id уже отсеяны (calc/backup.ts, planRestore).
// Помеченная удалённой (#264) — встаёт обратно, время правки — сейчас: копия спасает после случайного удаления
export async function restoreGames(games: Game[]): Promise<void> {
  if (games.length === 0) return
  const at = now()
  await inTx(['games', DIRTY], (tx) => {
    const store = tx.objectStore('games')
    for (const game of games) {
      const old = store.get(game.id)
      old.onsuccess = () => {
        const back = (old.result as Game | undefined)?.deleted === true
        store.put(back ? { ...alive(game), updatedAt: at } : alive(game))
        if (!game.demo) markDirty(tx, { store: 'games', key: game.id })
      }
    }
  })
}

// Для человека — окончательно, с тем же вопросом (Р-09); в базе — пометка deleted и время правки (#264):
// удаление дойдёт до других устройств. Демо-игра стирается совсем — она не синхронизируется
export async function deleteGame(id: string): Promise<void> {
  await inTx(['games', DIRTY], (tx) => {
    const store = tx.objectStore('games')
    const old = store.get(id)
    old.onsuccess = () => {
      const game = old.result as Game | undefined
      if (!game || game.deleted) return
      if (game.demo) {
        store.delete(id)
        return
      }
      store.put({ ...game, deleted: true, updatedAt: now() })
      markDirty(tx, { store: 'games', key: id })
    }
  })
}

// «Удалить демо-данные» (Р-04): одной транзакцией — все игры с demo: true и только они, стираются совсем.
// Вернёт, сколько удалено
export async function deleteDemoGames(): Promise<number> {
  const db = await open()
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction('games', 'readwrite')
    let deleted = 0
    const cursor = tx.objectStore('games').openCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) return
      if ((c.value as Game).demo === true) {
        c.delete()
        deleted += 1
      }
      c.continue()
    }
    tx.oncomplete = () => resolve(deleted)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function getSettings(): Promise<Settings> {
  const stored = await run<Partial<Settings> | undefined>('settings', 'readonly', (s) => s.get(SETTINGS_KEY))
  return settingsWithDefaults(stored)
}

// В записи — ещё время правки (#264); экранам его не видно: getSettings берёт только поля настроек
export async function saveSettings(settings: Settings): Promise<void> {
  await inTx(['settings', DIRTY], (tx) => {
    tx.objectStore('settings').put({ ...settings, updatedAt: now() }, SETTINGS_KEY)
    markDirty(tx, { store: 'settings', key: SETTINGS_KEY })
  })
}

// Запись раздачи без времени правки — для сравнения «изменилась ли»
function sameHand(a: SavedHand, b: SavedHand): boolean {
  const { updatedAt: _a, ...restA } = a
  const { updatedAt: _b, ...restB } = b
  return JSON.stringify(restA) === JSON.stringify(restB)
}

// Раздачи вечера (#114) — одной транзакцией. Ключ — вечер и номер: та же раздача второй раз
// заменяет запись (после «Показать» — с показанными картами), дублей нет. Свои карты (mine, Р-54)
// у прежней записи остаются, если в новой их нет: телефон, вернувшийся к столу, их уже не видел.
// Изменённая или новая — с новым временем правки и отметкой «не отправлено» (#264); та же самая — не переписывается.
// Раздача удалённого вечера (стол с ботами ещё идёт) пишется заново, без карт прежней записи
export async function saveHands(hands: SavedHand[]): Promise<void> {
  if (hands.length === 0) return
  const at = now()
  await inTx([HANDS, DIRTY], (tx) => {
    const store = tx.objectStore(HANDS)
    for (const hand of hands) {
      const old = store.get(handKey(hand))
      old.onsuccess = () => {
        const prev = old.result as SavedHand | undefined
        const kept = prev && !prev.deleted ? prev : undefined
        const fresh = alive(!hand.mine && kept?.mine ? { ...hand, mine: kept.mine } : hand)
        if (kept && sameHand(kept, fresh)) return
        store.put({ ...fresh, updatedAt: at })
        markDirty(tx, { store: HANDS, key: handKey(hand) })
      }
    }
  })
}

// Все записи раздач — для «Выгрузить все» и копии данных (Р-54)
export async function allHands(): Promise<SavedHand[]> {
  return live(await run<SavedHand[]>(HANDS, 'readonly', (s) => s.getAll()))
}

// Записи вечера целиком (со столом и своими картами) — для «Выгрузить», по номерам
export async function eveningRecords(id: string): Promise<SavedHand[]> {
  const saved = live(await run<SavedHand[]>(HANDS, 'readonly', (s) => s.index(BY_EVENING).getAll(id)))
  return saved.sort((a, b) => a.number - b.number)
}

// Ключи записанных раздач «вечер + номер» — восстановлению из копии: что уже есть. Удалённые — мимо:
// их копия возвращает
export async function handKeys(): Promise<[string, number][]> {
  return (await allHands()).map(handKey)
}

// Восстановление раздач из копии (Р-54): записи как есть, одной транзакцией. Живые записанные отсеяны (planRestore).
// Время правки — своё, у копий до #264 его нет — начало вечера; помеченная удалённой — встаёт обратно, время — сейчас
export async function restoreHands(hands: SavedHand[]): Promise<void> {
  if (hands.length === 0) return
  const at = now()
  await inTx([HANDS, DIRTY], (tx) => {
    const store = tx.objectStore(HANDS)
    for (const hand of hands) {
      const old = store.get(handKey(hand))
      old.onsuccess = () => {
        const back = (old.result as SavedHand | undefined)?.deleted === true
        const updatedAt = back ? at : typeof hand.updatedAt === 'string' ? hand.updatedAt : isoAt(hand.startedAt)
        store.put({ ...alive(hand), updatedAt })
        markDirty(tx, { store: HANDS, key: handKey(hand) })
      }
    }
  })
}

// «Прошлые вечера», новые сверху: по первой записи каждого вечера, число его раздач и мой итог за вечер (#242) —
// итог суммой по раздачам, поэтому записи читаются целиком
export async function listEvenings(): Promise<EveningSummary[]> {
  return eveningSummaries(await allHands())
}

// Раздачу — пометкой удаления (#264): время правки — сейчас, отметка «не отправлено»
function deleteHand(tx: IDBTransaction, c: IDBCursorWithValue, at: string): void {
  const hand = c.value as SavedHand
  c.update({ ...hand, deleted: true, updatedAt: at })
  markDirty(tx, { store: HANDS, key: handKey(hand) })
}

// «Удалить» пачкой в «Настройках» (#242): все раздачи вечеров против ботов (onlyBots) или всех прошлых вечеров —
// одной транзакцией. Игры учёта и чарты не трогаются. Вернёт, сколько вечеров и раздач удалено
export async function deleteEvenings(onlyBots: boolean): Promise<EveningCounts> {
  const evenings = new Set<string>()
  let hands = 0
  const at = now()
  await inTx([HANDS, DIRTY], (tx) => {
    const cursor = tx.objectStore(HANDS).openCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) return
      const hand = c.value as SavedHand
      if (!hand.deleted && (!onlyBots || isBotsEvening({ id: hand.evening }))) {
        deleteHand(tx, c, at)
        evenings.add(hand.evening)
        hands += 1
      }
      c.continue()
    }
  })
  return { evenings: evenings.size, hands }
}

// Раздачи вечера по номерам
export async function eveningHands(id: string): Promise<HistoryHand[]> {
  return (await eveningRecords(id)).map((h) => h.hand)
}

// «Мои чарты» (#215, Р-77) — по имени
export async function listCharts(): Promise<OwnChart[]> {
  return byName(live(await run<OwnChart[]>(CHARTS, 'readonly', (s) => s.getAll())))
}

// Свой чарт: тот же id — заменяет запись (правка, переименование); время правки ставится само
export async function saveChart(chart: OwnChart): Promise<OwnChart> {
  const saved = { ...alive(chart), updatedAt: now() }
  await inTx([CHARTS, DIRTY], (tx) => {
    tx.objectStore(CHARTS).put(saved)
    markDirty(tx, { store: CHARTS, key: saved.id })
  })
  return saved
}

// Для человека — окончательно, как удаление игры; в базе — пометка (#264)
export async function deleteChart(id: string): Promise<void> {
  await inTx([CHARTS, DIRTY], (tx) => {
    const store = tx.objectStore(CHARTS)
    const old = store.get(id)
    old.onsuccess = () => {
      const chart = old.result as OwnChart | undefined
      if (!chart || chart.deleted) return
      store.put({ ...chart, deleted: true, updatedAt: now() })
      markDirty(tx, { store: CHARTS, key: id })
    }
  })
}

// id своих чартов — восстановлению из копии: что уже есть. Удалённые — мимо: их копия возвращает
export async function chartIds(): Promise<string[]> {
  return (await listCharts()).map((c) => c.id)
}

// Восстановление чартов из копии (Р-77): записи как есть, одной транзакцией. Живые с тем же id отсеяны (planRestore).
// Помеченный удалённым (#264) — встаёт обратно, время правки — сейчас
export async function restoreCharts(charts: OwnChart[]): Promise<void> {
  if (charts.length === 0) return
  const at = now()
  await inTx([CHARTS, DIRTY], (tx) => {
    const store = tx.objectStore(CHARTS)
    for (const chart of charts) {
      const old = store.get(chart.id)
      old.onsuccess = () => {
        const back = (old.result as OwnChart | undefined)?.deleted === true
        store.put(back ? { ...alive(chart), updatedAt: at } : alive(chart))
        markDirty(tx, { store: CHARTS, key: chart.id })
      }
    }
  })
}

// «Удалить» у вечера: все его раздачи одной транзакцией. Для человека — окончательно, как удаление игры;
// в базе — пометки (#264)
export async function deleteEvening(id: string): Promise<void> {
  const at = now()
  await inTx([HANDS, DIRTY], (tx) => {
    const cursor = tx.objectStore(HANDS).index(BY_EVENING).openCursor(id)
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) return
      if (!(c.value as SavedHand).deleted) deleteHand(tx, c, at)
      c.continue()
    }
  })
}

// Ключ памяти браузера, что входит в копию, изменился (#264, pokerStorage.ts) — отметка «не отправлено»
export async function markLocalDirty(key: string): Promise<void> {
  await inTx([DIRTY], (tx) => markDirty(tx, { store: 'local', key }))
}

// Что изменилось и ещё не отправлено — для синхронизации (шаг 2)
export async function listDirty(): Promise<DirtyMark[]> {
  return run<DirtyMark[]>(DIRTY, 'readonly', (s) => s.getAll())
}

// Отправленное — отметки снимаются одной транзакцией
export async function clearDirty(marks: DirtyMark[]): Promise<void> {
  if (marks.length === 0) return
  await inTx([DIRTY], (tx) => {
    const store = tx.objectStore(DIRTY)
    for (const m of marks) store.delete([m.store, m.key])
  })
}

// Память синхронизации (шаг 2): отпечатки файлов, последний коммит — по имени; нет — undefined
export async function loadSyncMeta(key: string): Promise<unknown> {
  return run<unknown>(SYNC_META, 'readonly', (s) => s.get(key))
}

export async function saveSyncMeta(key: string, value: unknown): Promise<void> {
  await run(SYNC_META, 'readwrite', (s) => s.put(value, key))
}
