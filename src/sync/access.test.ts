// Копия из FamilyCore@d9e5ec6 (ui/access.test.ts), правится здесь; своё — публичный репозиторий — ошибка
import { describe, expect, it } from 'vitest'
import { accessWords } from './access'
import type { RepoInfo } from './github'

const info: RepoInfo = { fullName: 'vasya-test/fishki-data', private: true, canWrite: true, defaultBranch: 'main' }

describe('accessWords — «Проверить доступ»', () => {
  it('полное имя и приватность — первыми', () => {
    expect(accessWords(info, 'main').note).toMatch(/^Репозиторий vasya-test\/fishki-data найден, приватный/)
  })

  it('право аккаунта не выдаётся за право токена', () => {
    const { note, error } = accessWords(info, 'main')
    expect(note).not.toContain('запись разрешена')
    expect(note).toMatch(/права токена GitHub не сообщает/i)
    expect(note).toContain('Contents: Read and write')
    expect(error).toBe('')
  })

  it('аккаунту писать нельзя — ошибка, и это правда', () => {
    const { note, error } = accessWords({ ...info, canWrite: false }, 'main')
    expect(note).not.toMatch(/права токена GitHub не сообщает/i)
    expect(error).toContain('писать в этот репозиторий нельзя')
  })

  it('публичный репозиторий — крупно и ошибкой', () => {
    const { note, error } = accessWords({ ...info, private: false }, 'main')
    expect(note).toContain('ПУБЛИЧНЫЙ')
    expect(error).toContain('приватным')
  })

  it('ветка по умолчанию названа, только если она не та', () => {
    expect(accessWords(info, 'main').note).not.toContain('ветка по умолчанию')
    expect(accessWords(info, 'data').note).toContain('ветка по умолчанию — main')
  })
})
