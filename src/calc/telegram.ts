// Вставка из Телеграма (Р-10): текст «Копировать» → записи #rebuy / #cashout и раунды казино → черновик игры на сверке
import { linkRegulars, type CasinoRound, type Entry, type Game, type Player, type Regular } from '../model'
import { parseRound } from './casino'

export type ChatRecord =
  | { kind: 'rebuy'; name: string; at: string } // name — кому докуп
  | { kind: 'cashout'; name: string; chips: number; at: string }

// Раунд казино (Р-13) — строками, как вводится в игре: «Эрик, Артём +150»
export type ChatRound = { text: string; at: string }

export type Chat = {
  date: string | null // YYYY-MM-DD — день первого сообщения
  records: ChatRecord[]
  rounds: ChatRound[]
  unparsed: string[] // строки без тегов и непонятные — показываются на сверке
}

// [05.06.2026 22:10] Аня Б: #rebuy Гоша — час бывает без ведущего нуля, секунды — необязательны
const HEADER = /^\[(\d{1,2})\.(\d{1,2})\.(\d{4}),? (\d{1,2}):(\d{2})(?::\d{2})?\]\s*([^:]+?):\s*(.*)$/
const REBUY = /^#rebuy(?:\s+(.+))?$/i
// Число в конце, можно с пробелами между разрядами: «2400», «2 400»
const CASHOUT = /^#cashout(?:\s+(.*?))?\s+(\d{1,3}(?:[  ]\d{3})+|\d+)$/i
const DEBT = /^#debt(?:\s+(.*))?$/i
const CASINO = /^казино:?$/i // заголовок раунда первой строкой — не доля

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

// Копейки → число для строки раунда: 50050 → «500,50»
function rubText(kopecks: number): string {
  const kop = kopecks % 100
  return String(Math.floor(kopecks / 100)) + (kop ? ',' + String(kop).padStart(2, '0') : '')
}

// «Эрик Аскару 500» — Эрик должен Аскару: раунд из двух, первый −N, второй +N. Не долг — null
function debtRound(line: string): string | null {
  const r = parseRound(line)
  const a = r.amounts[0]
  const names = a?.name.match(/^(.+?)\s+(\S+)$/)
  if (r.bad.length > 0 || r.amounts.length !== 1 || a.kopecks <= 0 || !names) return null
  return `${names[1]} -${rubText(a.kopecks)}\n${names[2]} +${rubText(a.kopecks)}`
}

// Тег без имени — запись того, кто написал. Строки без тега в сообщении — один раунд казино;
// после #debt — каждая строка свой раунд-долг
export function parseChat(text: string): Chat {
  const { list, orphans } = messages(text)
  const records: ChatRecord[] = []
  const rounds: ChatRound[] = []
  const unparsed = [...orphans]
  for (const msg of list) {
    if (msg.lines.length === 0) unparsed.push(`${msg.sender}:`)
    const lines = msg.lines.length > 1 && CASINO.test(msg.lines[0]) ? msg.lines.slice(1) : msg.lines
    const roundLines: string[] = []
    let debt = false
    for (const line of lines) {
      const rebuy = line.match(REBUY)
      const cashout = line.match(CASHOUT)
      const debtTag = line.match(DEBT)
      const chips = cashout ? Number(cashout[2].replace(/\D/g, '')) : 0
      // «#rebuy 1000» — не имя, а сумма: докуп всегда по умолчанию, значит отправителю
      const rebuyName = rebuy?.[1]?.trim() ?? ''
      const debtText = debtTag ? (debtTag[1]?.trim() ?? '') : debt && !line.startsWith('#') ? line : ''
      if (rebuy) {
        records.push({ kind: 'rebuy', name: /^[\d\s]+$/.test(rebuyName) ? msg.sender : rebuyName || msg.sender, at: msg.at })
      } else if (cashout && chips > 0) {
        records.push({ kind: 'cashout', name: cashout[1]?.trim() || msg.sender, chips, at: msg.at })
      } else if (debtTag && debtText === '') {
        debt = true
      } else if (debtText !== '') {
        debt = true
        const round = debtRound(debtText)
        if (round) rounds.push({ text: round, at: msg.at })
        else unparsed.push(`${msg.sender}: ${line}`)
      } else if (!line.startsWith('#') && parseRound(line).bad.length === 0) {
        roundLines.push(line)
      } else {
        unparsed.push(`${msg.sender}: ${line}`)
      }
    }
    if (roundLines.length > 0) rounds.push({ text: roundLines.join('\n'), at: msg.at })
  }
  return { date: list[0]?.date ?? null, records, rounds, unparsed }
}

export type DraftCashout = { chips: number; at: string }

export type DraftPlayer = {
  id: string
  name: string
  buyin: number // фишек закупа; 0 — без закупа
  rebuys: string[] // время каждого докупа
  cashouts: DraftCashout[]
}

// Раунд казино на сверке: текст правится, имена — как в чате, участник для имени — `casinoPlayer`
export type DraftRound = { id: string; text: string; at: string }

export type Draft = {
  date: string // YYYY-MM-DD
  start: string // время первого сообщения — время закупов
  end: string // время последнего — для докупов и выходов, добавленных на сверке
  rebuy: number // фишек в докупе — закуп по умолчанию (Р-09)
  players: DraftPlayer[]
  rounds: DraftRound[]
  links: Record<string, string> // имя из раунда (`nameKey`) → id игрока, выбранного руками
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// Каждый игрок из текста — один закуп на сумму по умолчанию; игроки — в порядке появления.
// Раунды игроков не создают: имена из них связываются на сверке. Ни записей, ни раундов — черновика нет
export function draftFromChat(chat: Chat, defaultBuyin: number, makeId: () => string): Draft | null {
  if ((chat.records.length === 0 && chat.rounds.length === 0) || chat.date === null) return null
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
  const rounds = chat.rounds.map((r) => ({ id: makeId(), text: r.text, at: r.at }))
  const times = [...chat.records, ...chat.rounds].map((r) => r.at).sort()
  return { date: chat.date, start: times[0], end: times[times.length - 1], rebuy: defaultBuyin, players, rounds, links: {} }
}

// Имя для сравнения: без регистра, крайних и двойных пробелов, «ё» = «е»
export const nameKey = (name: string) => name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')

const ENDINGS = ['у', 'ю', 'е', 'и'] // дательный: «Аскару», «Артему»

// Имя из раунда подходит игроку: его полное имя или первое слово («Эрнест» — и «Эрнест Jun»),
// как есть или с одной буквой окончания
export function nameFits(text: string, playerName: string): boolean {
  const t = nameKey(text)
  const full = nameKey(playerName)
  if (full === '') return false
  return [full, full.split(' ')[0]].some(
    (k) => t === k || (t.length === k.length + 1 && t.startsWith(k) && ENDINGS.includes(t[t.length - 1])),
  )
}

// Участник для имени из раунда: выбран руками — он; иначе единственный подходящий; двое или никого — null
export function casinoPlayer(draft: Draft, name: string): DraftPlayer | null {
  const linked = draft.players.find((p) => p.id === draft.links[nameKey(name)])
  if (linked) return linked
  const fit = draft.players.filter((p) => nameFits(name, p.name))
  return fit.length === 1 ? fit[0] : null
}

export type CasinoName = {
  name: string // как в первом раунде с ним
  player: DraftPlayer | null // null — не разобрано: выбрать руками
  candidates: DraftPlayer[] // подходящие по имени
}

// Имена из раундов, каждое один раз (`nameKey`), в порядке появления
export function casinoNames(draft: Draft): CasinoName[] {
  const seen = new Set<string>()
  const list: CasinoName[] = []
  for (const r of draft.rounds) {
    for (const { name } of parseRound(r.text).amounts) {
      const key = nameKey(name)
      if (seen.has(key)) continue
      seen.add(key)
      list.push({ name, player: casinoPlayer(draft, name), candidates: draft.players.filter((p) => nameFits(name, p.name)) })
    }
  }
  return list
}

// Имя из раунда — этот игрок
export function linkCasinoName(draft: Draft, name: string, playerId: string): Draft {
  if (!draft.players.some((p) => p.id === playerId)) return draft
  return { ...draft, links: { ...draft.links, [nameKey(name)]: playerId } }
}

// Имя из раунда — новый участник только казино: без закупа, докупов и выхода
export function addCasinoPlayer(draft: Draft, name: string, makeId: () => string): Draft {
  const player: DraftPlayer = { id: makeId(), name: name.trim(), buyin: 0, rebuys: [], cashouts: [] }
  return linkCasinoName({ ...draft, players: [...draft.players, player] }, name, player.id)
}

export const casinoOnly = (p: DraftPlayer) => p.buyin === 0 && p.rebuys.length === 0 && p.cashouts.length === 0

export function setRoundText(draft: Draft, roundId: string, text: string): Draft {
  return { ...draft, rounds: draft.rounds.map((r) => (r.id === roundId ? { ...r, text } : r)) }
}

export function removeRound(draft: Draft, roundId: string): Draft {
  return { ...draft, rounds: draft.rounds.filter((r) => r.id !== roundId) }
}

// Раунды, с которыми игру не создать: пустой, есть неразобранная строка или не в ноль
export function badRounds(draft: Draft): DraftRound[] {
  return draft.rounds.filter((r) => {
    const parsed = parseRound(r.text)
    return parsed.amounts.length === 0 || parsed.bad.length > 0 || parsed.sum !== 0
  })
}

// Игрок, которого нет в тексте: закуп по умолчанию, выход 0
export function addDraftPlayer(draft: Draft, name: string, makeId: () => string): Draft {
  const player: DraftPlayer = { id: makeId(), name: name.trim(), buyin: draft.rebuy, rebuys: [], cashouts: [] }
  return { ...draft, players: [...draft.players, player] }
}

// Два игрока — один человек (ник и имя): докупы и выходы складываются, закуп — один, больший из двух.
// Остаётся `intoId` со своим именем и местом в списке; имена раундов, выбранные для `fromId`, — к нему
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
  const links = Object.fromEntries(Object.entries(draft.links).map(([k, id]) => [k, id === fromId ? intoId : id]))
  return { ...draft, players, links }
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

// Раунд черновика → раунд игры: доли по участникам (два имени одного — сложены), нулевые не пишутся;
// неразобранные имена пропускаются — с ними игру не создают
function casinoRound(draft: Draft, round: DraftRound, id: string): CasinoRound {
  const sums = new Map<string, number>()
  for (const a of parseRound(round.text).amounts) {
    const p = casinoPlayer(draft, a.name)
    if (p) sums.set(p.id, (sums.get(p.id) ?? 0) + a.kopecks)
  }
  const amounts = [...sums].filter(([, k]) => k !== 0).map(([playerId, kopecks]) => ({ playerId, kopecks }))
  return { id, amounts, at: round.at }
}

// Черновик → обычная игра: записи и раунды со временем сообщений, по порядку времени;
// участник с именем постоянного игрока связан с ним (Р-12). Раундов нет — нет и поля casino
export function gameFromDraft(draft: Draft, meta: DraftMeta, makeId: () => string, regulars: Regular[]): Game {
  const players: Player[] = linkRegulars(
    draft.players.map((p) => ({ id: p.id, name: p.name.trim() })),
    regulars,
  )
  const entries: Entry[] = []
  for (const p of draft.players) {
    if (p.buyin > 0) entries.push({ id: makeId(), playerId: p.id, kind: 'buyin', chips: p.buyin, at: draft.start })
    for (const at of p.rebuys) entries.push({ id: makeId(), playerId: p.id, kind: 'rebuy', chips: draft.rebuy, at })
    for (const c of p.cashouts) entries.push({ id: makeId(), playerId: p.id, kind: 'cashout', chips: c.chips, at: c.at })
  }
  entries.sort((a, b) => a.at.localeCompare(b.at))
  const casino = draft.rounds
    .map((r) => casinoRound(draft, r, makeId()))
    .filter((r) => r.amounts.length > 0)
    .sort((a, b) => a.at.localeCompare(b.at))
  return {
    id: makeId(),
    name: meta.name,
    date: draft.date,
    rate: meta.rate,
    players,
    entries,
    ...(casino.length > 0 ? { casino } : {}),
    updatedAt: meta.now,
  }
}
