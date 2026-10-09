import type { Balance } from './totals'

const NBSP = ' '
const MINUS = '−'

// 11000 → «11 000» (неразрывный пробел между разрядами)
export function formatNumber(n: number): string {
  const digits = String(Math.abs(Math.trunc(n)))
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  return n < 0 ? MINUS + grouped : grouped
}

function signed(n: number, text: string): string {
  if (n > 0) return '+' + text
  if (n < 0) return MINUS + text
  return text
}

// Фишки со знаком: +2 950, −5 000, 0
export function formatChips(chips: number, withSign = false): string {
  const text = formatNumber(Math.abs(chips))
  return withSign ? signed(chips, text) : formatNumber(chips)
}

// Копейки → рубли: 147500 → «1 475 ₽», 18250 → «182,50 ₽»
export function formatRub(kopecks: number, withSign = false): string {
  const abs = Math.abs(kopecks)
  const rub = Math.floor(abs / 100)
  const kop = abs % 100
  const text = formatNumber(rub) + (kop ? ',' + String(kop).padStart(2, '0') : '') + NBSP + '₽'
  if (withSign) return signed(kopecks, text)
  return kopecks < 0 ? MINUS + text : text
}

// Курс: 0.5 → «0,5»
export function formatRate(rate: number): string {
  return String(rate).replace('.', ',')
}

// «из 1 фишки», «из 21 фишки», «из 5 фишек», «из 11 фишек»
export function chipsGenitive(n: number): string {
  const abs = Math.abs(n)
  return abs % 10 === 1 && abs % 100 !== 11 ? 'фишки' : 'фишек'
}

// Строка «сходится ли игра» — число с основанием
export function balanceText(b: Balance): string {
  if (b.chipsIn === 0 && b.chipsOut === 0) return 'Записей пока нет'
  const ofTotal = `выведено ${formatNumber(b.chipsOut)} из ${formatNumber(b.chipsIn)} ${chipsGenitive(b.chipsIn)}`
  if (b.ok) return `Игра сходится: ${ofTotal}`
  if (b.diff > 0) {
    return `Не хватает ${formatNumber(b.diff)} ${chipsGenitive(b.diff)} — у кого-то не записан выход (${ofTotal})`
  }
  return `Выведено больше, чем закуплено, на ${formatNumber(-b.diff)} — проверьте записи (${ofTotal})`
}

// «0,5» или «0.5» → 0.5; не число или не больше нуля — null
export function parseRate(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'))
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null
}

// «1 000» → 1000; только целое больше нуля, иначе null
export function parseChips(text: string): number | null {
  const clean = text.replace(/[\s ]/g, '')
  if (!/^\d+$/.test(clean)) return null
  const n = Number(clean)
  return n > 0 && Number.isSafeInteger(n) ? n : null
}
