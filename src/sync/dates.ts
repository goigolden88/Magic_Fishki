// Копия из FamilyCore@d9e5ec6 (core/dates.ts), правится здесь. Только то, что нужно синхронизации и её экрану:
// проверка дня, дни между датами, «3 дня», «через минуту». Свои даты «Фишек» — src/dates.ts

export type DateStr = string

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Существует ли такой календарный день: отсекает 31.02 и месяц 13
function isRealDate(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}

export function isDateStr(value: string): boolean {
  const m = ISO_DATE.exec(value)
  return m ? isRealDate(Number(m[1]), Number(m[2]), Number(m[3])) : false
}

// DateStr → локальная полночь; на мусоре кидает
function toDate(d: DateStr): Date {
  const m = ISO_DATE.exec(d)
  if (!m || !isRealDate(Number(m[1]), Number(m[2]), Number(m[3]))) throw new Error(`Не дата: ${d}`)
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

export function toDateStr(date: Date): DateStr {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function today(): DateStr {
  return toDateStr(new Date())
}

// Время последней правки записи — поле updatedAt
export function nowIso(): string {
  return new Date().toISOString()
}

export function daysBetween(from: DateStr, to: DateStr): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / MS_PER_DAY)
}

export function plural(n: number, forms: [string, string, string]): string {
  // Дробное число всегда берёт вторую форму: «3,5 дня»
  if (!Number.isInteger(n)) return forms[1]
  const abs = Math.abs(n) % 100
  if (abs >= 11 && abs <= 14) return forms[2]
  switch (abs % 10) {
    case 1:
      return forms[0]
    case 2:
    case 3:
    case 4:
      return forms[1]
    default:
      return forms[2]
  }
}

export function days(n: number): string {
  const number = Number.isInteger(n) ? String(n) : String(n).replace('.', ',')
  return `${number} ${plural(n, ['день', 'дня', 'дней'])}`
}

// Промежуток из миллисекунд для «через …»: 5000 → «5 секунд», 60000 → «минуту», 120000 → «2 минуты»
export function timeSpan(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} ${plural(seconds, ['секунду', 'секунды', 'секунд'])}`
  const minutes = Math.round(seconds / 60)
  if (minutes === 1) return 'минуту'
  return `${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])}`
}
