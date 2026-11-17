import { afterEach, describe, expect, it, vi } from 'vitest'

// Ключи памяти браузера в синхронизации (#265, prefs.json): только ключи копии, слияние по ключу целиком

function fakeStorage() {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  }
}

async function load() {
  vi.resetModules()
  return import('./pokerStorage')
}

afterEach(() => vi.unstubAllGlobals())

describe('ключи браузера в синхронизации', () => {
  it('едут только ключи копии: токена, репозитория, пароля и своей рубашки нет', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    storage.setItem('fishki.sync.token', 'github_pat_секрет')
    storage.setItem('fishki.sync.repo', 'vasya-test/fishki-data')
    storage.setItem('fishki.poker.password', 'пароль')
    storage.setItem('fishki.poker.ownBack', 'data:image/webp;base64,AAAA')
    storage.setItem('fishki.theme', 'day')
    storage.setItem('fishki.sync.stamps', JSON.stringify({ 'fishki.poker.look': '2026-11-10T00:00:00.000Z' }))
    const { syncedPrefs } = await load()
    expect(syncedPrefs()).toEqual([
      { key: 'fishki.poker.look', value: null, updatedAt: '2026-11-10T00:00:00.000Z' },
      { key: 'fishki.theme', value: 'day', updatedAt: '1970-01-01T00:00:00.000Z' },
    ])
  })

  it('поздний побеждает, время правки — пришедшее, копия в памяти страницы сброшена', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    storage.setItem('fishki.poker.notes', JSON.stringify({ Петя: { color: 'red', text: 'старое' } }))
    storage.setItem('fishki.sync.stamps', JSON.stringify({ 'fishki.poker.notes': '2026-11-10T00:00:00.000Z' }))
    const { applySyncedPrefs, loadNotes, loadSyncStamps } = await load()
    expect(loadNotes().notes['Петя']?.text).toBe('старое')

    const fresh = JSON.stringify({ Петя: { color: 'blue', text: 'новое' } })
    expect(applySyncedPrefs([{ key: 'fishki.poker.notes', value: fresh, updatedAt: '2026-11-09T00:00:00.000Z' }])).toEqual([])
    expect(
      applySyncedPrefs([
        { key: 'fishki.poker.notes', value: fresh, updatedAt: '2026-11-11T00:00:00.000Z' },
        { key: 'fishki.sync.token', value: 'чужой', updatedAt: '2030-01-01T00:00:00.000Z' },
        { key: 'fishki.poker.look', value: null, updatedAt: '2026-11-11T00:00:00.000Z' },
      ]),
    ).toEqual(['fishki.poker.notes', 'fishki.poker.look'])
    expect(loadNotes().notes['Петя']?.text).toBe('новое')
    expect(storage.data.has('fishki.sync.token')).toBe(false)
    expect(loadSyncStamps()['fishki.poker.notes']).toBe('2026-11-11T00:00:00.000Z')
  })
})
