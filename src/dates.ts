const pad = (n: number) => String(n).padStart(2, '0')

// Сегодня по часам телефона: YYYY-MM-DD
export function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 2026-10-09 → «9 октября 2026»
export function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
    .toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .replace(/\s*г\.$/, '')
}

// ISO → «21:05»
export function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
