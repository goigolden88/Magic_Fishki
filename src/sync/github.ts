/**
 * Копия из FamilyCore@d9e5ec6 (core/github.ts), правится здесь.
 * Отступление от ядра: коммит умеет удалять файлы (`deletes`) — раздачи вечера,
 * у которого не осталось ни одной записи, уходят из репозитория данных (#265).
 *
 * Тонкий клиент GitHub API.
 *
 * Знает про HTTP и формат ответов, не знает ни про раскладку файлов, ни про
 * слияние, ни про базу. Всё, что выше уровнем, живёт в `sync.ts`.
 *
 * Почему Git Data API, а не простой Contents API: Contents пишет по одному
 * файлу за запрос и делает на каждый отдельный коммит. Здесь дерево
 * собирается целиком и коммит получается один, а столкновение двух устройств
 * ловится на сдвиге ветки, а не на версии отдельного файла.
 *
 * Секретов в этом файле нет и быть не может: токен приходит параметром из
 * настроек, введённых руками на устройстве.
 */

const API = 'https://api.github.com'

/**
 * Заголовок, в котором GitHub сообщает, когда истекает токен. Браузер отдаёт
 * скрипту только разрешённые через CORS заголовки — не отдаст, вернём null,
 * и дату придётся вписать руками в настройках.
 */
const EXPIRY_HEADER = 'github-authentication-token-expiration'

/** Файл в дереве. Обычный блоб, ничего исполняемого. */
const BLOB_MODE = '100644'

export type RepoRef = {
  owner: string
  name: string
  branch: string
}

export type RepoInfo = {
  fullName: string
  private: boolean
  /**
   * Может ли писать **аккаунт**, выпустивший токен: `permissions.push` ответа
   * GitHub. Права fine-grained токена GitHub здесь не сообщает: у владельца
   * репозитория — всегда true, и у токена Read-only тоже. false — не пишет
   * точно; true о токене не говорит ничего.
   */
  canWrite: boolean
  defaultBranch: string
}

/** Запись дерева в том виде, в каком её отдаёт GitHub. */
export type TreeEntry = {
  path: string
  /** Отпечаток содержимого. Совпал — файл не менялся, скачивать незачем. */
  sha: string
  type: 'blob' | 'tree' | 'commit'
}

/** Файл на отправку. Содержимое — обычный текст, base64 не нужен. */
export type FileToWrite = {
  path: string
  content: string
}

/**
 * Ошибка обращения к GitHub с человеческим текстом. Текст пишется здесь, а не
 * на экране: только тут известно, что именно ответил сервер.
 */
export class GitHubError extends Error {
  /** HTTP-код. 0 — до сервера не дошли вовсе. */
  readonly status: number
  /** Ветка ушла вперёд: кто-то отправил раньше нас. Повод перечитать и слить заново. */
  readonly conflict: boolean
  /** Токен не принят. Самая вероятная причина — вышел срок, выбранный при выпуске. */
  readonly badToken: boolean

  constructor(message: string, options: { status?: number; conflict?: boolean; badToken?: boolean } = {}) {
    super(message)
    this.name = 'GitHubError'
    this.status = options.status ?? 0
    this.conflict = options.conflict ?? false
    this.badToken = options.badToken ?? false
  }
}

// ─── Разбор адреса репозитория ─────────────────────────────────────────────

/** Принимает и `owner/name`, и ссылку из адресной строки браузера. */
export function parseRepo(input: string): { owner: string; name: string } {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  if (!trimmed) throw new GitHubError('Репозиторий не указан')

  const fromUrl = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)/i)
  const pair = fromUrl ? [fromUrl[1], fromUrl[2]] : trimmed.split('/')

  const [owner, name] = pair
  if (pair.length !== 2 || !owner || !name || /[^\w.-]/.test(owner) || /[^\w.-]/.test(name)) {
    throw new GitHubError(`Не разобрал «${input}». Ожидается «владелец/репозиторий»`)
  }
  return { owner, name }
}

// ─── Кодировки ─────────────────────────────────────────────────────────────

/**
 * Base64 из ответа GitHub → текст. Через `TextDecoder`: `atob` отдаёт байты
 * по символам, и кириллица превратилась бы в мусор. Переводы строк внутри
 * base64 GitHub ставит сам, их надо убрать.
 */
function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new TextDecoder().decode(bytes)
}

/** Текст → base64. Нужен Contents API: он принимает содержимое только так. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// ─── Клиент ────────────────────────────────────────────────────────────────

export type Client = ReturnType<typeof createClient>

export type ClientOptions = {
  repo: RepoRef
  token: string
  /** Подменяется в тестах. В приложении — обычный `fetch`. */
  fetch?: typeof globalThis.fetch
}

export function createClient({ repo, token, fetch = globalThis.fetch }: ClientOptions) {
  const base = `${API}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
  let tokenExpiry: string | null = null

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${token}`,
          ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...init.headers,
        },
      })
    } catch {
      // Сюда попадает только обрыв связи: HTTP-ошибка приходит обычным ответом
      throw new GitHubError('Нет связи с GitHub. Отправка отложена до сети')
    }

    const expiry = response.headers.get(EXPIRY_HEADER)
    if (expiry) tokenExpiry = expiry

    if (!response.ok) throw await explain(response)

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  /** Ответ сервера → ошибка с текстом, по которому понятно, что делать. */
  async function explain(response: Response): Promise<GitHubError> {
    let detail = ''
    try {
      const body = (await response.json()) as { message?: string }
      detail = typeof body.message === 'string' ? body.message : ''
    } catch {
      detail = ''
    }

    const status = response.status

    if (status === 401) {
      return new GitHubError(
        'Токен не принят: истёк срок, токен отозвали или вставили не целиком. ' +
          'Перевыпусти токен в GitHub и вставь новый здесь.',
        { status, badToken: true },
      )
    }
    if (status === 403) {
      const limited = response.headers.get('x-ratelimit-remaining') === '0'
      return new GitHubError(
        limited
          ? 'GitHub временно отказывает: исчерпан лимит запросов. Попробую позже'
          : 'Токену не хватает прав. Нужен доступ «Contents: Read and write» к этому репозиторию.',
        { status, badToken: !limited },
      )
    }
    if (status === 404) {
      return new GitHubError(
        `Репозиторий ${repo.owner}/${repo.name} не найден. Либо в имени опечатка, либо токен выдан не на него.`,
        { status },
      )
    }
    if (status === 409 || status === 422) {
      // «Git Repository is empty» тоже приходит как 409, но это не гонка, а репозиторий без единого коммита
      const empty = detail.toLowerCase().includes('empty')
      return new GitHubError(
        empty ? 'В репозитории данных нет ни одного коммита' : 'Другое устройство или окно отправляло в то же время',
        { status, conflict: !empty },
      )
    }
    return new GitHubError(`GitHub ответил ${status}${detail ? `: ${detail}` : ''}`, { status })
  }

  return {
    /** Дата истечения токена, как её назвал GitHub. null — заголовок не пришёл или запросов ещё не было. */
    tokenExpiry: () => tokenExpiry,

    /** Проверка доступа: репозиторий существует, токен его видит; может ли писать аккаунт. */
    async info(): Promise<RepoInfo> {
      const raw = await call<{
        full_name: string
        private: boolean
        default_branch: string
        permissions?: { push?: boolean }
      }>('')
      return {
        fullName: raw.full_name,
        private: raw.private,
        canWrite: raw.permissions?.push === true,
        defaultBranch: raw.default_branch,
      }
    },

    /**
     * Голова ветки. null — ветки нет: репозиторий только что создан и пуст.
     * Пустой репозиторий отвечает 404 (нет ветки) или 409 «Git Repository is
     * empty» (нет ни одного коммита) — здесь оба означают одно.
     */
    async head(): Promise<string | null> {
      try {
        const raw = await call<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(repo.branch)}`)
        return raw.object.sha
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error
        if (error.status === 404 || error.status === 409) return null
        throw error
      }
    },

    /** Всё дерево коммита одним запросом. Каталоги отброшены, нужны только файлы. */
    async tree(commitSha: string): Promise<TreeEntry[]> {
      const raw = await call<{ tree: TreeEntry[]; truncated?: boolean }>(`/git/trees/${commitSha}?recursive=1`)
      if (raw.truncated) {
        throw new GitHubError(
          'Дерево репозитория не поместилось в один ответ. Такого объёма данных здесь быть не должно — разберись руками.',
        )
      }
      return raw.tree.filter((entry) => entry.type === 'blob')
    },

    /** Содержимое файла по отпечатку. */
    async blob(sha: string): Promise<string> {
      const raw = await call<{ content: string; encoding: string }>(`/git/blobs/${sha}`)
      if (raw.encoding !== 'base64') throw new GitHubError(`Неизвестная кодировка файла: ${raw.encoding}`)
      return decodeBase64(raw.content)
    },

    /**
     * Первый файл в репозитории, где нет ни одного коммита. Git Data API на
     * пустом репозитории не работает вовсе — кладём файл через Contents API,
     * он создаст и коммит, и ветку. Дальше всё идёт общим путём.
     */
    async createFirst(file: FileToWrite, message: string): Promise<string> {
      const raw = await call<{ commit: { sha: string } }>(`/contents/${file.path}`, {
        method: 'PUT',
        body: JSON.stringify({ message, content: toBase64(file.content), branch: repo.branch }),
      })
      return raw.commit.sha
    },

    /**
     * Один коммит на все файлы. Содержимое кладётся прямо в дерево; `base_tree`
     * оставляет нетронутым всё, чего нет в списке. Удаляемый файл — запись
     * дерева с `sha: null` (так GitHub убирает путь из `base_tree`).
     */
    async commit(options: {
      parent: string | null
      files: readonly FileToWrite[]
      deletes?: readonly string[]
      message: string
    }): Promise<string> {
      const tree = await call<{ sha: string }>('/git/trees', {
        method: 'POST',
        body: JSON.stringify({
          ...(options.parent ? { base_tree: options.parent } : {}),
          tree: [
            ...options.files.map((file) => ({ path: file.path, mode: BLOB_MODE, type: 'blob', content: file.content })),
            ...(options.deletes ?? []).map((path) => ({ path, mode: BLOB_MODE, type: 'blob', sha: null })),
          ],
        }),
      })

      const created = await call<{ sha: string }>('/git/commits', {
        method: 'POST',
        body: JSON.stringify({
          message: options.message,
          tree: tree.sha,
          parents: options.parent ? [options.parent] : [],
        }),
      })

      return created.sha
    },

    /**
     * Двигает ветку на новый коммит. Без `force`: если второе устройство успело
     * отправить раньше, GitHub откажет — ровно то, что нужно: перечитать и слить заново.
     */
    async moveBranch(commitSha: string, options: { create: boolean }): Promise<void> {
      if (options.create) {
        await call('/git/refs', {
          method: 'POST',
          body: JSON.stringify({ ref: `refs/heads/${repo.branch}`, sha: commitSha }),
        })
        return
      }
      await call(`/git/refs/heads/${encodeURIComponent(repo.branch)}`, {
        method: 'PATCH',
        body: JSON.stringify({ sha: commitSha, force: false }),
      })
    },
  }
}

// ─── Отпечаток файла ───────────────────────────────────────────────────────

/**
 * Тот же отпечаток, которым git называет содержимое файла: sha1 от
 * `blob <длина в байтах>\0<содержимое>`. Нужен, чтобы не отправлять
 * неизменившееся. Длина именно в байтах: на кириллице байты и символы расходятся.
 */
export async function blobSha(content: string): Promise<string> {
  const body = new TextEncoder().encode(content)
  const header = new TextEncoder().encode(`blob ${body.length}\0`)

  const buffer = new Uint8Array(header.length + body.length)
  buffer.set(header)
  buffer.set(body, header.length)

  const digest = await crypto.subtle.digest('SHA-1', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
