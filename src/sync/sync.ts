/**
 * Копия из FamilyCore@d9e5ec6 (core/sync.ts), правится здесь. Исправления синхронизации ядра сами сюда
 * не приходят — сверка с ядром при его крупных правках.
 *
 * Синхронизация через приватный репозиторий данных (#265).
 *
 * Принцип — local-first: запись уже лежит в базе и уже на экране, когда синхронизация только начинается.
 * Она может отставать, падать и ждать сети, не ломая работу: сеть в критическом пути записи не стоит нигде.
 *
 * Один проход:
 *
 *   1. Голова ветки и дерево файлов — два запроса
 *   2. Скачиваем только те наши файлы, чей отпечаток разошёлся с запомненным
 *   3. Вливаем их в базу: по ключу побеждает поздний `updatedAt`
 *   4. Пересобираем дерево из базы целиком (раскладка — `layout.ts`)
 *   5. Отправляем одним коммитом только разошедшиеся файлы
 *   6. Ветка ушла вперёд — перечитываем и сливаемся заново: три попытки с паузой, потом повтор через минуту
 *
 * Тихий проход, когда ничего не менялось, — два запроса и ни одного коммита.
 *
 * Порядок «сначала влить чужое, потом отправить своё» обязателен: дерево собирается из базы целиком,
 * и отправка до слияния затёрла бы на сервере всё, чего у нас ещё нет. Поэтому любая ошибка чтения
 * обрывает проход до записи.
 *
 * Отступления от ядра:
 * - нет среза итогов `summary.json`, общей базы `family`, демо-базы и `AppConfig`: база — порт `Ports`
 *   поверх `src/store/db.ts`, токен и имя репозитория — в памяти «Фишек» (`config.ts`);
 * - нет `meta.json`: версия формата — в каждом файле (`layout.ts`, SYNC_FORMAT);
 * - «нет в репо — значит удалено» (#265, после #301): ядро меток не стирает, здесь метка живёт 30 дней.
 *   Запись есть в базе, её нет в файлах репозитория (ни живой, ни метки), и она не в `dirty` — её удалили
 *   на другом устройстве, а метка уже истекла: стираем здесь и в репозиторий не возвращаем. Первое
 *   подключение (запомненного дерева этого репозитория нет) — правило не действует, ничего не стирается;
 * - файлы, которых база больше не даёт (вечер без единой записи), удаляются из репозитория тем же коммитом.
 */

import { GitHubError, blobSha, createClient, parseRepo, type Client, type RepoInfo } from './github'
import {
  README_PATH,
  buildFiles,
  parseFile,
  pathOf,
  readmeFile,
  recordKey,
  storeOf,
  type RecordStore,
  type RepoFile,
  type SyncData,
  type SyncRecord,
  type SyncStore,
} from './layout'
import type { DirtyMark } from '../store/db'

// ─── Настройки ─────────────────────────────────────────────────────────────

export const DEFAULT_BRANCH = 'main'

export type SyncConfig = {
  /** `владелец/репозиторий`. Пусто — синхронизация не настроена. */
  repo: string
  token: string
  branch: string
  tokenExpires: string | null
}

export function configured(config: SyncConfig): boolean {
  return config.repo.trim() !== '' && config.token !== ''
}

/** Где лежат репозиторий и токен: в «Фишках» — память браузера (`config.ts`), в тестах — объект. */
export type ConfigStore = {
  read: () => SyncConfig
  save: (patch: Partial<SyncConfig>) => void
  forgetToken: () => void
}

// ─── Проверка доступа ──────────────────────────────────────────────────────

export type AccessCheck = RepoInfo & {
  /** Срок жизни токена, как его назвал GitHub. null — заголовок не пришёл. */
  tokenExpiry: string | null
}

/**
 * Кнопка «Проверить доступ»: репозиторий найден, токен его видит, может ли писать аккаунт.
 * Читающий токен иначе вскрылся бы только при первой отправке.
 */
export async function checkAccess(config: SyncConfig, fetchImpl?: typeof globalThis.fetch): Promise<AccessCheck> {
  const api = client(config, fetchImpl)
  const info = await api.info()
  return { ...info, tokenExpiry: api.tokenExpiry() }
}

function client(config: SyncConfig, fetchImpl?: typeof globalThis.fetch): Client {
  const { owner, name } = parseRepo(config.repo)
  return createClient({
    repo: { owner, name, branch: config.branch || DEFAULT_BRANCH },
    token: config.token,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  })
}

// Чьё запомненное дерево: другой репозиторий или ветка — первое подключение, а не «всё удалили»
export function repoKey(config: SyncConfig): string {
  const { owner, name } = parseRepo(config.repo)
  return `${owner}/${name}#${config.branch || DEFAULT_BRANCH}`.toLowerCase()
}

// ─── Планирование прохода ──────────────────────────────────────────────────

export type ShaByPath = Record<string, string>

/** Что отправлять: файлы, чей отпечаток разошёлся с деревом на сервере. */
export async function planUpload(
  files: readonly RepoFile[],
  tree: ShaByPath,
): Promise<{ files: RepoFile[]; shas: ShaByPath }> {
  const changed: RepoFile[] = []
  const shas: ShaByPath = {}
  for (const file of files) {
    const sha = await blobSha(file.content)
    shas[file.path] = sha
    if (tree[file.path] !== sha) changed.push(file)
  }
  return { files: changed, shas }
}

/**
 * Что скачивать: наш файл, чей отпечаток совпал с запомненным, уже влит — читать его незачем.
 * Чужие файлы (README и положенное руками) не наши и не трогаются вовсе. Первое подключение — всё наше.
 */
export function planDownload(tree: ShaByPath, remembered: ShaByPath | null): string[] {
  return Object.entries(tree)
    .filter(([path, sha]) => storeOf(path) !== null && remembered?.[path] !== sha)
    .map(([path]) => path)
    .sort()
}

// ─── Проход ────────────────────────────────────────────────────────────────

export type SyncResult = {
  /** Записей влито с сервера и стёрто правилом «нет в репо». */
  pulled: number
  /** Файлов отправлено и удалено. Ноль — коммита не было. */
  pushed: number
  commit: string | null
}

/** Запомненное после успешного прохода: чей репозиторий и отпечатки его файлов. */
export type Memory = { repo: string; tree: ShaByPath; commit: string | null }

/** Запись, которую стирает правило «нет в репо»: хранилище и ключ строкой (`recordKey`). */
export type ForgetRef = { store: RecordStore; key: string }

/**
 * Порт к хранилищу. Заведён ради тестов: IndexedDB и памяти браузера в node нет, а проверять
 * проход целиком надо — это самый опасный код в приложении.
 */
export type Ports = {
  /** Всё, что синхронизируется, с метками удаления; без демо-игр. */
  readAll: () => Promise<SyncData>
  /** Влить пришедшее: по ключу побеждает поздний updatedAt. Вернёт, сколько записей изменилось. */
  merge: (store: SyncStore, records: readonly SyncRecord[]) => Promise<number>
  /** Стереть записи совсем — кроме тех, что сейчас в dirty (их правили здесь). Вернёт, сколько стёрто. */
  forget: (refs: readonly ForgetRef[]) => Promise<number>
  listDirty: () => Promise<DirtyMark[]>
  clearDirty: (marks: readonly DirtyMark[]) => Promise<void>
  remembered: () => Promise<Memory | null>
  remember: (memory: Memory) => Promise<void>
}

/** Ключ отметки dirty строкой — как `recordKey` записи того же хранилища. */
export function dirtyKey(mark: DirtyMark): string {
  const store = mark.store === 'local' ? 'prefs' : mark.store
  return `${store}:${typeof mark.key === 'string' ? mark.key : JSON.stringify(mark.key)}`
}

/** Сколько раз перечитываем и сливаемся заново, проиграв гонку. */
const ATTEMPTS = 3

/**
 * Пауза перед повтором: секунда, потом две. Сразу повторять бесполезно: соседняя отправка ещё
 * не закончилась, и повтор строится на том же устаревшем родителе.
 */
function backoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 1000))
}

export type RunOptions = {
  /** Чей репозиторий (`repoKey`): запомненное дерево другого — первое подключение. */
  repo: string
  pause?: (attempt: number) => Promise<void>
  /** Сейчас, мс — для меток старше 30 дней. */
  now?: () => number
}

export async function runSync(api: Client, ports: Ports, options: RunOptions): Promise<SyncResult> {
  const pause = options.pause ?? backoff
  // Снято до начала: правки, сделанные во время прохода, останутся грязными и уедут следующим
  const dirtyAtStart = await ports.listDirty()

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await onePass(api, ports, dirtyAtStart, options)
    } catch (error) {
      const race = error instanceof GitHubError && error.conflict
      if (!race || attempt >= ATTEMPTS) throw error
      // Второе устройство отправило раньше. Читаем заново — его записи войдут в слияние, и наши поверх них
      await pause(attempt)
    }
  }
}

const RECORD_STORES: readonly RecordStore[] = ['games', 'hands', 'charts']

async function onePass(
  api: Client,
  ports: Ports,
  dirtyAtStart: readonly DirtyMark[],
  options: RunOptions,
): Promise<SyncResult> {
  const now = options.now ?? Date.now
  // Пустой репозиторий Git Data API не обслуживает: ему нужен хотя бы один коммит
  const head = (await api.head()) ?? (await bootstrap(api))
  const entries = await api.tree(head)

  const tree: ShaByPath = {}
  for (const entry of entries) tree[entry.path] = entry.sha

  const memory = await ports.remembered()
  const remembered = memory && memory.repo === options.repo ? memory.tree : null
  const first = remembered === null
  const download = planDownload(tree, remembered)

  // ── Чужое к себе ── сначала всё скачать и разобрать: битый файл обрывает проход до первой записи
  const parsed = []
  for (const path of download) parsed.push({ path, ...parseFile(path, await api.blob(tree[path] as string)) })

  let pulled = 0
  // Ключи записей в скачанных файлах — для правила «нет в репо»
  const remoteKeys = new Set<string>()
  for (const file of parsed) {
    for (const record of file.records) remoteKeys.add(`${file.store}:${recordKey(file.store, record)}`)
    pulled += await ports.merge(file.store, file.records)
  }

  // ── Нет в репо — значит удалено ── (не при первом подключении)
  let data = await ports.readAll()
  if (!first) {
    const downloaded = new Set(download)
    const dirty = new Set([...dirtyAtStart, ...(await ports.listDirty())].map(dirtyKey))
    const gone: ForgetRef[] = []
    for (const store of RECORD_STORES) {
      for (const record of data[store]) {
        const key = recordKey(store, record)
        if (key === null || dirty.has(`${store}:${key}`) || remoteKeys.has(`${store}:${key}`)) continue
        const path = pathOf(store, record)
        // Файл не скачан, потому что не менялся с прошлого прохода, — запись в нём, как и была
        if (tree[path] !== undefined && !downloaded.has(path)) continue
        gone.push({ store, key })
      }
    }
    if (gone.length > 0) {
      pulled += await ports.forget(gone)
      data = await ports.readAll()
    }
  }

  // ── Своё наружу ──
  const files = buildFiles(data, now())
  // README — только если его нет: есть — он человека
  if (tree[README_PATH] === undefined) files.push(readmeFile())
  const built = new Set(files.map((file) => file.path))
  // Наш файл, которого база больше не даёт (вечер без записей, год без игр), — из репозитория
  const deletes = Object.keys(tree)
    .filter((path) => storeOf(path) !== null && !built.has(path))
    .sort()
  const upload = await planUpload(files, tree)

  const after: ShaByPath = { ...tree, ...upload.shas }
  for (const path of deletes) delete after[path]

  if (upload.files.length === 0 && deletes.length === 0) {
    // Отправлять нечего: на сервере уже ровно то же. Пометки снимаются — их содержимое доехало
    await ports.remember({ repo: options.repo, tree: after, commit: head })
    await ports.clearDirty(dirtyAtStart)
    return { pulled, pushed: 0, commit: head }
  }

  const commit = await api.commit({ parent: head, files: upload.files, deletes, message: message(upload.files, deletes) })
  await api.moveBranch(commit, { create: false })

  await ports.remember({ repo: options.repo, tree: after, commit })
  await ports.clearDirty(dirtyAtStart)

  return { pulled, pushed: upload.files.length + deletes.length, commit }
}

/**
 * Заводит репозиторий, в котором ещё ничего нет: кладётся README. 404 здесь — репозиторий не пуст,
 * а не виден токену: совет про README увёл бы не туда.
 */
async function bootstrap(api: Client): Promise<string> {
  try {
    return await api.createFirst(readmeFile(), 'Фишки: заведение репозитория данных')
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) throw error
    const text = error instanceof Error ? error.message : 'Неизвестная ошибка'
    throw new Error(
      `Не вышло положить первый файл в пустой репозиторий: ${text}. ` +
        'Обходной путь — создать в нём любой файл через сайт GitHub, например README, и синхронизировать снова.',
    )
  }
}

function message(files: readonly RepoFile[], deletes: readonly string[]): string {
  const paths = [...files.map((file) => file.path), ...deletes.map((path) => `${path} (удалён)`)].sort()
  const head = `Фишки: ${paths.length === 1 ? paths[0] : `обновлено файлов ${paths.length}`}`
  return paths.length === 1 ? head : `${head}\n\n${paths.join('\n')}`
}

// ─── Состояние для экрана ──────────────────────────────────────────────────

export type SyncState = 'off' | 'idle' | 'syncing' | 'error'

export type SyncStatus = {
  state: SyncState
  /** Сколько записей ждёт отправки. */
  pending: number
  lastAt: string | null
  /** Пусто, когда всё в порядке. */
  error: string
  /** Ошибка именно в токене: он не принят или истёк. */
  badToken: boolean
  /** Проход проиграл гонку до конца и сам повторится через минуту. */
  deferred: boolean
}

/** Через сколько повторить проход, проигравший гонку до конца. Есть в справке. */
export const RETRY_MS = 60_000

/** Сколько ждать тишины после последней правки, прежде чем отправлять. Есть в справке. */
export const QUIET_MS = 5000

/**
 * Реже этого автоматический проход не запускается: вкладка уходит в фон и возвращается по десять раз
 * за минуту, и каждый возврат — не повод лезть в сеть. Правка этим порогом не ограничена: она идёт по тишине.
 */
export const MIN_GAP_MS = 60_000

// ─── Синхронизация приложения ──────────────────────────────────────────────

export type SyncDeps = {
  config: ConfigStore
  ports: Ports
  /** Правка в базе: origin 'remote' — влитое синхронизацией, отправлять его обратно незачем. */
  onChange: (listener: (origin: 'local' | 'remote') => void) => () => void
  /** Когда был последний успешный обмен. */
  lastAt: () => Promise<string | null>
  fetch?: typeof globalThis.fetch
}

/** Синхронизация приложения. Зовётся один раз (`instance.ts`): состояние прохода и таймеры живут в экземпляре. */
export function createSync(deps: SyncDeps) {
  let status: SyncStatus = { state: 'off', pending: 0, lastAt: null, error: '', badToken: false, deferred: false }
  const listeners = new Set<(value: SyncStatus) => void>()

  function publish(patch: Partial<SyncStatus>): void {
    status = { ...status, ...patch }
    for (const listener of listeners) listener(status)
  }

  const getStatus = (): SyncStatus => status

  function subscribe(listener: (value: SyncStatus) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  const readConfig = (): SyncConfig => deps.config.read()

  function saveConfig(patch: Partial<SyncConfig>): void {
    deps.config.save(patch)
    void refreshStatus()
  }

  function forgetToken(): void {
    deps.config.forgetToken()
    publish({ error: '', badToken: false, deferred: false })
    void refreshStatus()
  }

  /** Пересчитывает видимое состояние, ничего не отправляя. */
  async function refreshStatus(): Promise<SyncStatus> {
    const current = readConfig()
    let pending = status.pending
    let lastAt = status.lastAt
    try {
      pending = (await deps.ports.listDirty()).length
      lastAt = await deps.lastAt()
    } catch {
      // база не открылась — состояние прежнее
    }
    if (!configured(current)) publish({ state: 'off', pending, lastAt, error: '', badToken: false, deferred: false })
    else if (status.state !== 'syncing') publish({ state: status.error ? 'error' : 'idle', pending, lastAt })
    else publish({ pending, lastAt })
    return status
  }

  /** Идущий проход. Второй вызов подхватывает первый, а не запускает второй. */
  let running: Promise<SyncResult | null> | null = null

  /**
   * Синхронизировать сейчас. null — не настроена, проход упал или отложен: это видно в состоянии.
   * Ошибки не пробрасываются, а оседают в состоянии: проход запускается сам по таймеру, и некому их ловить.
   */
  function syncNow(): Promise<SyncResult | null> {
    if (running) return running

    running = (async () => {
      const current = readConfig()
      if (!configured(current)) {
        await refreshStatus()
        return null
      }

      publish({ state: 'syncing', error: '', badToken: false })
      try {
        const api = client(current, deps.fetch)
        const result = await runSync(api, deps.ports, { repo: repoKey(current) })

        // Срок жизни токена приезжает заголовком ответа; не приехал — остаётся вписанный руками
        const expiry = api.tokenExpiry()
        if (expiry && expiry !== current.tokenExpires) deps.config.save({ tokenExpires: expiry })

        publish({ state: 'idle', error: '', badToken: false, deferred: false })
        await refreshStatus()
        return result
      } catch (error) {
        // Проигранная до конца гонка — не поломка: очередь цела. Второй раз подряд — уже повод показать
        const race = error instanceof GitHubError && error.conflict
        if (race && !status.deferred) {
          publish({ state: 'idle', error: '', badToken: false, deferred: true })
          await refreshStatus()
          later(RETRY_MS)
          return null
        }
        const text = error instanceof Error ? error.message : 'Неизвестная ошибка'
        publish({ state: 'error', error: text, badToken: error instanceof GitHubError && error.badToken, deferred: false })
        await refreshStatus()
        return null
      }
    })().finally(() => {
      running = null
    })

    return running
  }

  // ─── Когда запускать ─────────────────────────────────────────────────────

  let timer: ReturnType<typeof setTimeout> | null = null
  let lastAuto = 0

  function later(delay: number): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      lastAuto = Date.now()
      void syncNow()
    }, delay)
  }

  /**
   * Подписывает синхронизацию на всё, после чего она может понадобиться: правка в базе (через 5 с
   * тишины), возврат сети и вкладки из фона (не чаще раза в минуту), запуск приложения.
   * Возвращает отписку — она нужна тестам.
   */
  function startAutoSync(): () => void {
    const unsubscribe = deps.onChange((origin) => {
      if (origin === 'remote') return
      void refreshStatus()
      if (configured(readConfig())) later(QUIET_MS)
    })

    function wake(): void {
      if (!configured(readConfig()) || Date.now() - lastAuto < MIN_GAP_MS) return
      later(0)
    }

    function onVisible(): void {
      if (document.visibilityState === 'visible') wake()
    }

    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', onVisible)

    // Старт приложения: на другом устройстве могло накопиться за ночь
    void refreshStatus()
    if (configured(readConfig())) later(0)

    return () => {
      unsubscribe()
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', onVisible)
      if (timer) clearTimeout(timer)
      timer = null
    }
  }

  return { readConfig, saveConfig, forgetToken, getStatus, subscribe, refreshStatus, syncNow, startAutoSync }
}

export type Sync = ReturnType<typeof createSync>
