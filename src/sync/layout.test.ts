import { describe, expect, it } from 'vitest'
import { buildFiles, parseFile, pathOf, storeOf, type SyncData } from './layout'

const NOW = Date.parse('2026-11-17T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const iso = (ms: number) => new Date(ms).toISOString()

function data(over: Partial<SyncData> = {}): SyncData {
  return { games: [], settings: null, hands: [], charts: [], prefs: [], ...over }
}

describe('раскладка репозитория данных', () => {
  it('игры — по году дня игры, метка — по году удаления; раздачи — вечер одним файлом', () => {
    expect(pathOf('games', { id: 'g', date: '2025-12-31', updatedAt: iso(NOW) })).toBe('games/2025.json')
    expect(pathOf('games', { id: 'g', deleted: true, updatedAt: '2026-01-02T00:00:00.000Z' })).toBe('games/2026.json')
    expect(pathOf('hands', { evening: 'ABCD-1731', number: 3, updatedAt: iso(NOW) })).toBe('hands/ABCD-1731.json')
    expect(storeOf('games/2026.json')).toBe('games')
    expect(storeOf('hands/local-1.json')).toBe('hands')
    expect(storeOf('prefs.json')).toBe('prefs')
    expect(storeOf('README.md')).toBeNull()
    expect(storeOf('games/черновик.json')).toBeNull()
  })

  it('файл разбирается обратно в те же записи, порядок — по ключу', () => {
    const hands = [
      { evening: 'local-1', number: 2, updatedAt: iso(NOW) },
      { evening: 'local-1', number: 1, updatedAt: iso(NOW) },
    ]
    const [file] = buildFiles(data({ hands }), NOW).filter((f) => f.path.startsWith('hands/'))
    expect(parseFile(file.path, file.content)).toEqual({ store: 'hands', records: [hands[1], hands[0]] })
  })

  it('демо-игры не уходят никогда', () => {
    const files = buildFiles(
      data({
        games: [
          { id: 'demo1', date: '2026-10-01', demo: true, updatedAt: iso(NOW) },
          { id: 'g1', date: '2026-10-02', updatedAt: iso(NOW) },
        ],
      }),
      NOW,
    )
    const text = files.map((f) => f.content).join('\n')
    expect(text).toContain('g1')
    expect(text).not.toContain('demo1')
  })

  it('метка старше 30 дней в файлы не идёт; вечер без записей файла не даёт', () => {
    const files = buildFiles(
      data({
        hands: [{ evening: 'local-old', number: 1, deleted: true, updatedAt: iso(NOW - 31 * DAY) }],
        games: [{ id: 'g1', deleted: true, updatedAt: iso(NOW - 29 * DAY) }],
      }),
      NOW,
    )
    expect(files.map((f) => f.path)).toEqual(['charts.json', 'games/2026.json', 'prefs.json'])
  })

  it('токена и адреса репозитория в файлах нет: ключи браузера — только из копии', () => {
    const files = buildFiles(
      data({ prefs: [{ key: 'fishki.poker.notes', value: '{}', updatedAt: iso(NOW) }], settings: { defaultRate: 0.5, updatedAt: iso(NOW) } }),
      NOW,
    )
    const text = files.map((f) => f.content).join('\n')
    expect(text).not.toMatch(/fishki\.sync|github_pat|token/i)
  })

  it('чужой, битый или новее формата файл — ошибка словами', () => {
    expect(() => parseFile('charts.json', 'не json')).toThrow(/не JSON/)
    expect(() => parseFile('charts.json', JSON.stringify({ app: 'other', kind: 'charts', format: 1, records: [] }))).toThrow(
      /не «Фишек»/,
    )
    expect(() => parseFile('charts.json', JSON.stringify({ app: 'magic_fishki', kind: 'charts', format: 2, records: [] }))).toThrow(
      /Обнови приложение/,
    )
  })

  it('запись без ключа или времени правки — мимо', () => {
    const text = JSON.stringify({
      app: 'magic_fishki',
      kind: 'charts',
      format: 1,
      records: [{ id: 'c1', updatedAt: iso(NOW) }, { id: 'c2' }, { updatedAt: iso(NOW) }, null],
    })
    expect(parseFile('charts.json', text).records).toEqual([{ id: 'c1', updatedAt: iso(NOW) }])
  })
})
