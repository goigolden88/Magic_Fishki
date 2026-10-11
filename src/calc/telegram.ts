// Вставка из Телеграма (Р-10): текст «Копировать» → записи #rebuy / #cashout → черновик игры на сверке
import type { Entry, Game, Player } from '../model'

export type ChatRecord =
  | { kind: 'rebuy'; name: string; at: string } // name — кому докуп
  | { kind: 'cashout'; name: string; chips: number; at: string }

export type Chat = {
  date: string | null // YYYY-MM-DD — день первого сообщения
  records: ChatRecord[]
  unparsed: string[] // строки без тегов и непонятные — показываются на сверке
}

// [05.06.2026 22:10] Аня Б: #rebuy Гоша — час бывает без ведущего нуля, секунды — необязательны
const HEADER = /^\[(\d{1,2})\.(\d{1,2})\.(\d{4}),? (\d{1,2}):(\d{2})(?::\d{2})?\]\s*([^:]+?):\s*(.*)$/
const REBUY = /^#rebuy(?:\s+(.+))?$/i
// Число в конце, можно с пробелами между разрядами: «2400», «2 400»
const CASHOUT = /^#cashout(?:\s+(.*?))?\s+(\d{1,3}(?:[  ]\d{3})+|\d+)$/i

const pad = (n: number) => String(n).padStart(2, '0')

type Message = { at: string; date: string; sender: string; lines: string[] }

// Строки чата → сообщения: строка без заголовка продолжает предыдущее сообщение
function messages(text: string): { list: Message[]; orphans: string[] } {
  const list: Message[] = []
  const orphans: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(HEADER)
    if (m) {
      const [, d, mo, y, h, mi, sender, body] = m
      const local = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi))
      list.push({
        at: local.toISOString(),
        date: `${y}-${pad(Number(mo))}-${pad(Number(d))}`,
        sender: sender.trim(),
        lines: body.trim() ? [body.trim()] : [],
      })
    } else if (list.length > 0) {
      list[list.length - 1].lines.push(line)
    } else {
      orphans.push(line)
    }
  }
  return { list, orphans }
}

// Тег без имени — запись того, кто написал
export function parseChat(text: string): Chat {
  const { list, orphans } = messages(text)
  const records: ChatRecord[] = []
  const unparsed = [...orphans]
  for (const msg of list) {
    if (msg.lines.length === 0) unparsed.push(`${msg.sender}:`)
    for (const line of msg.lines) {
      const rebuy = line.match(REBUY)
      const cashout = line.match(CASHOUT)
      const chips = cashout ? Number(cashout[2].replace(/\D/g, '')) : 0
      // «#rebuy 1000» — не имя, а сумма: докуп всегда по умолчанию, значит отправителю
      const rebuyName = rebuy?.[1]?.trim() ?? ''
      if (rebuy) {
        records.push({ kind: 'rebuy', name: /^[\d\s]+$/.test(rebuyName) ? msg.sender : rebuyName || msg.sender, at: msg.at })
      } else if (cashout && chips > 0) {
        records.push({ kind: 'cashout', name: cashout[1]?.trim() || msg.sender, chips, at: msg.at })
      } else {
        unparsed.push(`${msg.sender}: ${line}`)
      }
    }
  }
  return { date: list[0]?.date ?? null, records, unparsed }
}

export type DraftCashout = { chips: number; at: string }

export type DraftPlayer = {
  id: string
  name: string
  buyin: number // фишек закупа; 0 — без закупа
  rebuys: string[] // время каждого докупа
  cashouts: DraftCashout[]
}

export type Draft = {
  date: string // YYYY-MM-DD
  start: string // время первого сообщения — время закупов
  end: string // время последнего — для докупов и выходов, добавленных на сверке
  rebuy: number // фишек в докупе — закуп по умолчанию (Р-09)
  players: DraftPlayer[]
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// Каждый игрок из текста — один закуп на сумму по умолчанию; игроки — в порядке появления.
// Записей нет — черновика нет
export function draftFromChat(chat: Chat, defaultBuyin: number, makeId: () => string): Draft | null {
  if (chat.records.length === 0 || chat.date === null) return null
  const players: DraftPlayer[] = []
  for (const r of chat.records) {
    let p = players.find((x) => sameName(x.name, r.name))
    if (!p) {
      p = { id: makeId(), name: r.name, buyin: defaultBuyin, rebuys: [], cashouts: [] }
      players.push(p)
    }
    if (r.kind === 'rebuy') p.rebuys.push(r.at)
    else p.cashouts.push({ chips: r.chips, at: r.at })
  }
  const times = chat.records.map((r) => r.at).sort()
  return { date: chat.date, start: times[0], end: times[times.length - 1], rebuy: defaultBuyin, players }
}

// Игрок, которого нет в тексте: закуп по умолчанию, выход 0
export function addDraftPlayer(draft: Draft, name: string, makeId: () => string): Draft {
  const player: DraftPlayer = { id: makeId(), name: name.trim(), buyin: draft.rebuy, rebuys: [], cashouts: [] }
  return { ...draft, players: [...draft.players, player] }
}

// Два игрока — один человек (ник и имя): докупы и выходы складываются, закуп — один, больший из двух.
// Остаётся `intoId` со своим именем и местом в списке
export function mergeDraftPlayers(draft: Draft, fromId: string, intoId: string): Draft {
  const from = draft.players.find((p) => p.id === fromId)
  if (!from || fromId === intoId || !draft.players.some((p) => p.id === intoId)) return draft
  const players = draft.players
    .filter((p) => p.id !== fromId)
    .map((p) =>
      p.id !== intoId
        ? p
        : {
            ...p,
            buyin: Math.max(p.buyin, from.buyin),
            rebuys: [...p.rebuys, ...from.rebuys].sort(),
            cashouts: [...p.cashouts, ...from.cashouts].sort((a, b) => a.at.localeCompare(b.at)),
          },
    )
  return { ...draft, players }
}

// «Это постоянный игрок …»: имя игрока — имя постоянного; такое имя уже у другого на сверке —
// двое объединяются, остаётся тот, другой, с именем постоянного
export function assignRegular(draft: Draft, playerId: string, regular: string): Draft {
  const name = regular.trim()
  if (!name || !draft.players.some((p) => p.id === playerId)) return draft
  const same = draft.players.find((p) => p.id !== playerId && sameName(p.name, name))
  const next = same ? mergeDraftPlayers(draft, playerId, same.id) : draft
  const keepId = same ? same.id : playerId
  return { ...next, players: next.players.map((p) => (p.id === keepId ? { ...p, name } : p)) }
}

// Число докупов: меньше — уходят последние, больше — новые со временем конца игры
export function setRebuyCount(p: DraftPlayer, count: number, at: string): DraftPlayer {
  const n = Math.max(0, Math.trunc(count))
  const rebuys = n <= p.rebuys.length ? p.rebuys.slice(0, n) : [...p.rebuys, ...Array<string>(n - p.rebuys.length).fill(at)]
  return { ...p, rebuys }
}

export const cashoutTotal = (p: DraftPlayer) => p.cashouts.reduce((s, c) => s + c.chips, 0)

// Выход правится одним числом: 0 — выхода нет; иначе одна запись со временем последнего выхода
export function setCashout(p: DraftPlayer, chips: number, at: string): DraftPlayer {
  if (chips === cashoutTotal(p)) return p
  if (chips <= 0) return { ...p, cashouts: [] }
  return { ...p, cashouts: [{ chips, at: p.cashouts[p.cashouts.length - 1]?.at ?? at }] }
}

// Имена, которые встречаются больше одного раза (без учёта регистра) — игру с ними не создать
export function duplicateNames(draft: Draft): string[] {
  const seen = new Map<string, string>()
  const dups = new Set<string>()
  for (const p of draft.players) {
    const key = p.name.trim().toLowerCase()
    if (seen.has(key)) dups.add(seen.get(key)!)
    else seen.set(key, p.name.trim())
  }
  return [...dups]
}

export type DraftMeta = { name: string; rate: number; now: string }

// Черновик → обычная игра: записи со временем сообщений, по порядку времени
export function gameFromDraft(draft: Draft, meta: DraftMeta, makeId: () => string): Game {
  const players: Player[] = draft.players.map((p) => ({ id: p.id, name: p.name.trim() }))
  const entries: Entry[] = []
  for (const p of draft.players) {
    if (p.buyin > 0) entries.push({ id: makeId(), playerId: p.id, kind: 'buyin', chips: p.buyin, at: draft.start })
    for (const at of p.rebuys) entries.push({ id: makeId(), playerId: p.id, kind: 'rebuy', chips: draft.rebuy, at })
    for (const c of p.cashouts) entries.push({ id: makeId(), playerId: p.id, kind: 'cashout', chips: c.chips, at: c.at })
  }
  entries.sort((a, b) => a.at.localeCompare(b.at))
  return {
    id: makeId(),
    name: meta.name,
    date: draft.date,
    rate: meta.rate,
    players,
    entries,
    updatedAt: meta.now,
  }
}
