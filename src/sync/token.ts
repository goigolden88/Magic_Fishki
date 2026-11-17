// Копия из FamilyCore@d9e5ec6 (core/token.ts), правится здесь.
// Срок жизни токена GitHub: разбор дня и порог предупреждения (Я-39 семьи)

import { isDateStr, type DateStr } from './dates'

// За сколько дней до конца жизни токена начинать предупреждать. Есть в справке
export const WARN_DAYS = 30

// День, когда истекает токен. GitHub присылает «2027-09-09 12:00:00 +0300», руками вписывается «2027-09-09» —
// общее у них первые десять символов; часовой пояс отброшен: предупреждение за месяц, час ничего не решает.
// null — срок неизвестен (это не «бессрочный»)
export function expiryDay(value: string | null): DateStr | null {
  if (!value) return null
  const day = value.slice(0, 10)
  return isDateStr(day) ? day : null
}
