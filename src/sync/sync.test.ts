// Копия из FamilyCore@d9e5ec6 (core/sync.test.ts), правится здесь: тесты прохода под свой порт —
// подставной GitHub в памяти и «устройства» с базой в памяти по правилам src/store/db.ts (их — store/syncMerge.test.ts)
import { describe, expect, it } from 'vitest'
import type { DirtyMark } from '../store/db'
import { GitHubError, blobSha, type Client, type FileToWrite } from './github'
import { buildFiles, expiredMark, parseFile, recordKey, type PrefRecord, type SyncData, type SyncRecord, type SyncStore } from './layout'
import { dirtyKey, planDownload, planUpload, runSync, type Memory, type Ports } from './sync'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.parse('2026-11-01T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const REPO = 'vasya-test/fishki-data#main'

// ─── Подставной GitHub ─────────────────────────────────────────────────────

function fakeRepo(initial: Record<string, string> = {}) {
  let files: Record<string, string> = { ...initial }
  let head: string | null = Object.keys(initial).length > 0 ? 'commit0' : null
  let counter = 0
  let staged: { files: readonly FileToWrite[]; deletes: readonly string[] } | null = null
  const calls: string[] = []
  let raceOnce: (() => void) | null = null

  const api: Client = {
    tokenExpiry: () => null,
    info: () => Promise.resolve({ fullName: 'vasya-test/fishki-data', private: true, canWrite: true, defaultBranch: 'main' }),
    head: () => {
      calls.push('head')
      return Promise.resolve(head)
    },
    tree: async () => {
      calls.push('tree')
      const entries = []
      for (const [path, content] of Object.entries(files)) entries.push({ path, sha: await blobSha(content), type: 'blob' as const })
      return entries
    },
    blob: async (sha) => {
      calls.push('blob')
      for (const content of Object.values(files)) if ((await blobSha(content)) === sha) return content
      throw new Error(`Нет блоба ${sha}`)
    },
    createFirst: (file) => {
      calls.push('createFirst')
      files[file.path] = file.content
      counter += 1
      head = `commit${counter}`
      return Promise.resolve(head)
    },
    commit: ({ files: toWrite, deletes }) => {
      calls.push('commit')
      staged = { files: toWrite, deletes: deletes ?? [] }
      counter += 1
      return Promise.resolve(`commit${counter}`)
    },
    moveBranch: (sha) => {
      calls.push('moveBranch')
      if (raceOnce) {
        raceOnce()
        raceOnce = null
        staged = null
        return Promise.reject(new GitHubError('is at abc but expected def', { conflict: true }))
      }
      if (staged) {
        for (const file of staged.files) files[file.path] = file.content
        for (const path of staged.deletes) delete files[path]
        staged = null
      }
      head = sha
      return Promise.resolve()
    },
  }

  return {
    api,
    calls,
    files: () => files,
    // Кто-то отправил раньше нас: правит файлы и двигает голову
    raceNextPush(change: Record<string, string>) {
      raceOnce = () => {
        files = { ...files, ...change }
        head = 'other'
      }
    },
  }
}

// ─── «Устройство»: база в памяти по правилам store/db.ts ───────────────────

type Stores = { games: Map<string, SyncRecord>; hands: Map<string, SyncRecord>; charts: Map<string, SyncRecord> }

function device(clock: { now: number }) {
  const stores: Stores = { games: new Map(), hands: new Map(), charts: new Map() }
  let settings: SyncRecord | null = null
  const prefs = new Map<string, PrefRecord>()
  const dirty = new Map<string, DirtyMark>()
  let memory: Memory | null = null

  const keyOf = (store: keyof Stores, r: SyncRecord) => recordKey(store, r) as string
  const markOf = (store: keyof Stores, key: string): DirtyMark => ({
    store,
    key: store === 'hands' ? (JSON.parse(key) as [string, number]) : key,
  })

  function mergeOne(store: keyof Stores, r: SyncRecord): boolean {
    const key = keyOf(store, r)
    const local = stores[store].get(key)
    if (local?.demo === true || r.demo === true) return false
    if (local && local.updatedAt >= r.updatedAt) return false
    if (r.deleted && expiredMark(r, clock.now)) {
      if (!local) return false
      stores[store].delete(key)
      dirty.delete(dirtyKey(markOf(store, key)))
      return true
    }
    stores[store].set(key, r)
    return true
  }

  const ports: Ports = {
    readAll: () =>
      Promise.resolve<SyncData>({
        games: [...stores.games.values()].filter((g) => g.demo !== true),
        hands: [...stores.hands.values()],
        charts: [...stores.charts.values()],
        settings,
        prefs: [...prefs.values()],
      }),
    merge: (store: SyncStore, records) => {
      let n = 0
      for (const r of records) {
        if (store === 'settings') {
          if (!settings || settings.updatedAt < r.updatedAt) {
            settings = r
            n += 1
          }
        } else if (store === 'prefs') {
          const p = r as unknown as PrefRecord
          const local = prefs.get(p.key)
          if (!local || local.updatedAt < p.updatedAt) {
            prefs.set(p.key, p)
            n += 1
          }
        } else if (mergeOne(store, r)) n += 1
      }
      return Promise.resolve(n)
    },
    forget: (refs) => {
      let n = 0
      for (const ref of refs) {
        if (dirty.has(dirtyKey(markOf(ref.store, ref.key)))) continue
        if (stores[ref.store].delete(ref.key)) n += 1
      }
      return Promise.resolve(n)
    },
    listDirty: () => Promise.resolve([...dirty.values()]),
    clearDirty: (marks) => {
      for (const m of marks) dirty.delete(dirtyKey(m))
      return Promise.resolve()
    },
    remembered: () => Promise.resolve(memory),
    remember: (m) => {
      memory = m
      return Promise.resolve()
    },
  }

  return {
    ports,
    stores,
    dirty,
    prefs,
    getSettings: () => settings,
    forgetMemory: () => {
      memory = null
    },
    // Правка здесь: запись с временем правки «сейчас» и отметкой «не отправлено»
    put(store: keyof Stores, r: Omit<SyncRecord, 'updatedAt'>) {
      const record = { ...r, updatedAt: iso(clock.now) } as SyncRecord
      const key = keyOf(store, record)
      stores[store].set(key, record)
      if (record.demo !== true) dirty.set(dirtyKey(markOf(store, key)), markOf(store, key))
    },
    putPref(key: string, value: string | null) {
      prefs.set(key, { key, value, updatedAt: iso(clock.now) })
      dirty.set(dirtyKey({ store: 'local', key }), { store: 'local', key })
    },
    putSettings(fields: Record<string, unknown>) {
      settings = { ...fields, updatedAt: iso(clock.now) }
      dirty.set(dirtyKey({ store: 'settings', key: 'settings' }), { store: 'settings', key: 'settings' })
    },
    // Удаление вечера: метки вместо раздач
    deleteEvening(evening: string) {
      for (const [key, h] of stores.hands) {
        if (h.evening !== evening || h.deleted) continue
        const mark = { evening, number: h.number, deleted: true as const, updatedAt: iso(clock.now) }
        stores.hands.set(key, mark)
        dirty.set(dirtyKey(markOf('hands', key)), markOf('hands', key))
      }
    },
    // Чистка меток при открытии базы (purgeTombstones): синхронизация подключалась — только отправленные
    purge() {
      for (const store of ['games', 'hands', 'charts'] as const) {
        for (const [key, r] of stores[store]) {
          if (r.deleted && expiredMark(r, clock.now) && !dirty.has(dirtyKey(markOf(store, key)))) stores[store].delete(key)
        }
      }
    },
    evenings: () => new Set([...stores.hands.values()].filter((h) => !h.deleted).map((h) => h.evening as string)),
  }
}

function hand(evening: string, number: number) {
  return { evening, number, code: null, startedAt: T0, hand: { number, log: [] } }
}

function game(id: string, date: string, over: Record<string, unknown> = {}) {
  return { id, name: date, date, rate: 0.5, players: [], entries: [], ...over }
}

const run = (repo: ReturnType<typeof fakeRepo>, d: ReturnType<typeof device>, clock: { now: number }) =>
  runSync(repo.api, d.ports, { repo: REPO, pause: () => Promise.resolve(), now: () => clock.now })

// Вечера и записи в файлах репозитория
function repoRecords(repo: ReturnType<typeof fakeRepo>): Map<string, SyncRecord[]> {
  const out = new Map<string, SyncRecord[]>()
  for (const [path, text] of Object.entries(repo.files())) {
    if (path === 'README.md') continue
    const { store, records } = parseFile(path, text)
    out.set(store, [...(out.get(store) ?? []), ...records])
  }
  return out
}

const repoEvenings = (repo: ReturnType<typeof fakeRepo>) =>
  new Set((repoRecords(repo).get('hands') ?? []).filter((h) => !h.deleted).map((h) => h.evening as string))

// ─── Планирование ──────────────────────────────────────────────────────────

describe('планирование прохода', () => {
  it('отправляет только разошедшиеся файлы', async () => {
    const files = [
      { path: 'charts.json', content: 'a' },
      { path: 'prefs.json', content: 'b' },
    ]
    const tree = { 'charts.json': await blobSha('a'), 'prefs.json': 'старый' }
    const plan = await planUpload(files, tree)
    expect(plan.files.map((f) => f.path)).toEqual(['prefs.json'])
    expect(Object.keys(plan.shas)).toEqual(['charts.json', 'prefs.json'])
  })

  it('скачивает только свои разошедшиеся файлы; первое подключение — все свои', () => {
    const tree = { 'README.md': 'r', 'charts.json': 'c1', 'games/2026.json': 'g2', 'hands/local-1.json': 'h1', 'чужое.txt': 'x' }
    expect(planDownload(tree, { 'charts.json': 'c1', 'games/2026.json': 'g1' })).toEqual(['games/2026.json', 'hands/local-1.json'])
    expect(planDownload(tree, null)).toEqual(['charts.json', 'games/2026.json', 'hands/local-1.json'])
  })
})

// ─── Проход ────────────────────────────────────────────────────────────────

describe('проход', () => {
  it('пустой репозиторий: README первым коммитом, данные — вторым', async () => {
    const clock = { now: T0 }
    const repo = fakeRepo()
    const a = device(clock)
    a.put('games', game('g1', '2026-10-30'))
    const result = await run(repo, a, clock)
    expect(repo.calls).toContain('createFirst')
    expect(Object.keys(repo.files()).sort()).toEqual(['README.md', 'charts.json', 'games/2026.json', 'prefs.json'])
    expect(result.pushed).toBe(3)
    expect(a.dirty.size).toBe(0)
  })

  it('тихий проход — два запроса и ни одного коммита', async () => {
    const clock = { now: T0 }
    const repo = fakeRepo()
    const a = device(clock)
    a.put('games', game('g1', '2026-10-30'))
    await run(repo, a, clock)
    repo.calls.length = 0
    const result = await run(repo, a, clock)
    expect(repo.calls).toEqual(['head', 'tree'])
    expect(result).toEqual({ pulled: 0, pushed: 0, commit: expect.any(String) })
  })

  it('README человека не переписывается', async () => {
    const clock = { now: T0 }
    const repo = fakeRepo({ 'README.md': 'моё' })
    const a = device(clock)
    await run(repo, a, clock)
    expect(repo.files()['README.md']).toBe('моё')
  })

  it('первое подключение второго устройства: сначала влить, потом отправить — у обоих ничего не теряется', async () => {
    const clock = { now: T0 }
    const repo = fakeRepo()
    const a = device(clock)
    const b = device(clock)
    a.put('hands', hand('local-A', 1))
    a.put('hands', hand('local-A', 2))
    a.put('games', game('gA', '2026-10-30'))
    b.put('hands', hand('local-B', 1))
    b.put('games', game('gB', '2025-12-31'))
    b.put('charts', { id: 'c1', name: 'Мой чарт' })

    await run(repo, a, clock)
    clock.now += 1000
    const fromB = await run(repo, b, clock)
    clock.now += 1000
    await run(repo, a, clock)

    expect(fromB.pulled).toBe(3)
    for (const d of [a, b]) {
      expect(d.evenings()).toEqual(new Set(['local-A', 'local-B']))
      expect([...d.stores.games.keys()].sort()).toEqual(['gA', 'gB'])
      expect([...d.stores.charts.keys()]).toEqual(['c1'])
    }
    expect(repoEvenings(repo)).toEqual(new Set(['local-A', 'local-B']))
    expect(Object.keys(repo.files()).sort()).toEqual([
      'README.md',
      'charts.json',
      'games/2025.json',
      'games/2026.json',
      'hands/local-A.json',
      'hands/local-B.json',
      'prefs.json',
    ])
  })

  it('слияние по ключу: поздний updatedAt побеждает — раздачи по [evening, number], ключи браузера целиком', async () => {
    const clock = { now: T0 }
    const repo = fakeRepo()
    const a = device(clock)
    const b = device(clock)
    a.put('hands', { ...hand('local-1', 1), mine: ['As', 'Kd'] })
    a.putPref('fishki.poker.notes', '{"Петя":{"color":"red","text":"блефует"}}')
    a.putSettings({ defaultRate: 0.5 })
    await run(repo, a, clock)
    await run(repo, b, clock)

    clock.now += 60_000
    b.put('hands', { ...hand('local-1', 1), mine: ['Qs', 'Qd'] })
    b.putPref('fishki.poker.notes', '{"Петя":{"color":"blue","text":"тайтовый"}}')
    b.putSettings({ defaultRate: 1 })
    clock.now += 60_000
    a.putPref('fishki.theme', 'day')
    await run(repo, b, clock)
    await run(repo, a, clock)

    expect(a.stores.hands.get('["local-1",1]')?.mine).toEqual(['Qs', 'Qd'])
    expect(a.prefs.get('fishki.poker.notes')?.value).toContain('тайтовый')
    expect(a.getSettings()?.defaultRate).toBe(1)
    await run(repo, b, clock)
    expect(b.prefs.get('fishki.theme')?.value).toBe('day')
  })

  it('удаление меткой доезжает до другого устройства', async () => {
    const clock = { now: T0 }
    const repo = fakeRepo()
    const a = device(clock)
    const b = device(clock)
    a.put('hands', hand('local-1', 1))
    a.put('games', game('g1', '2026-10-30'))
    await run(repo, a, clock)
    await run(repo, b, clock)
    expect(b.evenings()).toEqual(new Set(['local-1']))

    clock.now += DAY
    a.deleteEvening('local-1')
    a.put('games', { id: 'g1', deleted: true })
    await run(repo, a, clock)
    // Метки едут в файлы: без содержимого
    const marks = repoRecords(repo).get('hands') ?? []
    expect(marks).toEqual([{ evening: 'local-1', number: 1, deleted: true, updatedAt: iso(clock.now) }])

    await run(repo, b, clock)
    expect(b.evenings().size).toBe(0)
    expect(b.stores.games.get('g1')?.deleted).toBe(true)
  })

  it('гонка: чужая отправка успела раньше — перечитываем, сливаемся, отправляем поверх', async () => {
    const clock = { now: T0 }
    const repo = fakeRepo()
    const a = device(clock)
    const other = device(clock)
    other.put('charts', { id: 'c-other', name: 'Чужой' })
    const otherFiles: Record<string, string> = {}
    for (const f of buildFiles(await other.ports.readAll(), clock.now)) otherFiles[f.path] = f.content
    await run(repo, a, clock)

    a.put('charts', { id: 'c-mine', name: 'Мой' })
    repo.raceNextPush(otherFiles)
    await run(repo, a, clock)
    const charts = (repoRecords(repo).get('charts') ?? []).map((c) => c.id)
    expect(charts.sort()).toEqual(['c-mine', 'c-other'])
    expect([...a.stores.charts.keys()].sort()).toEqual(['c-mine', 'c-other'])
  })

  it('файл новее формата — проход обрывается до записи', async () => {
    const clock = { now: T0 }
    const newer = JSON.stringify({ app: 'magic_fishki', kind: 'charts', format: 99, records: [] })
    const repo = fakeRepo({ 'README.md': 'r', 'charts.json': newer })
    const a = device(clock)
    a.put('games', game('g1', '2026-10-30'))
    await expect(run(repo, a, clock)).rejects.toThrow(/Обнови приложение/)
    expect(repo.calls).not.toContain('commit')
    expect(a.dirty.size).toBe(1)
  })

  it('правка во время прохода остаётся «не отправлено» и уедет следующим', async () => {
    const clock = { now: T0 }
    const repo = fakeRepo()
    const a = device(clock)
    a.put('games', game('g1', '2026-10-30'))
    const listDirty = a.ports.listDirty
    let first = true
    a.ports.listDirty = async () => {
      const marks = await listDirty()
      if (first) {
        first = false
        a.put('games', game('g2', '2026-10-31'))
      }
      return marks
    }
    await run(repo, a, clock)
    expect([...a.dirty.keys()]).toEqual(['games:g2'])
  })
})

// ─── Нет в репо — значит удалено (#265, после #301) ────────────────────────

describe('устройство, не открывавшееся дольше жизни метки', () => {
  // A и B синхронизированы с вечером local-1. B засыпает; A удаляет вечер и отправляет метки
  async function setup() {
    const clock = { now: T0 }
    const repo = fakeRepo()
    const a = device(clock)
    const b = device(clock)
    a.put('hands', hand('local-1', 1))
    a.put('hands', hand('local-1', 2))
    a.put('hands', hand('local-2', 1))
    await run(repo, a, clock)
    await run(repo, b, clock)
    expect(b.evenings()).toEqual(new Set(['local-1', 'local-2']))

    a.deleteEvening('local-1')
    await run(repo, a, clock)
    // Через 31 день метки стёрты из базы A при открытии и тем же проходом — из файлов: файл вечера удалён
    clock.now += 31 * DAY
    a.purge()
    await run(repo, a, clock)
    expect(repo.files()['hands/local-1.json']).toBeUndefined()
    return { clock, repo, a, b }
  }

  it('B вечер не правил — после прохода его нет и в репо он не вернулся', async () => {
    const { clock, repo, b } = await setup()
    clock.now = T0 + 40 * DAY
    const result = await run(repo, b, clock)
    expect(b.evenings()).toEqual(new Set(['local-2']))
    expect(repoEvenings(repo)).toEqual(new Set(['local-2']))
    expect(result.pulled).toBe(2)
  })

  it('B правил этот вечер — вечер возвращается: поздняя правка побеждает', async () => {
    const { clock, repo, a, b } = await setup()
    clock.now = T0 + 40 * DAY
    b.put('hands', { ...hand('local-1', 1), mine: ['Ah', 'Ad'] })
    await run(repo, b, clock)
    expect(b.evenings()).toEqual(new Set(['local-1', 'local-2']))
    expect(repoEvenings(repo)).toEqual(new Set(['local-1', 'local-2']))
    await run(repo, a, clock)
    expect(a.evenings()).toEqual(new Set(['local-1', 'local-2']))
  })

  it('первое подключение C с вечером, которого нет в репо, — вечер уходит в репо', async () => {
    const { clock, repo } = await setup()
    const c = device(clock)
    c.put('hands', hand('local-C', 1))
    // Записи C, пришедшие не правкой (как из копии до подключения), — тоже не стираются: правило не действует
    c.dirty.clear()
    await run(repo, c, clock)
    expect(c.evenings()).toEqual(new Set(['local-C', 'local-2']))
    expect(repoEvenings(repo)).toEqual(new Set(['local-C', 'local-2']))
  })

  it('другой репозиторий — тоже первое подключение: ничего не стирается', async () => {
    const { clock, b } = await setup()
    const other = fakeRepo()
    const result = await runSync(other.api, b.ports, { repo: 'vasya-test/другой#main', now: () => clock.now })
    expect(result.pulled).toBe(0)
    expect(b.evenings()).toEqual(new Set(['local-1', 'local-2']))
  })
})
