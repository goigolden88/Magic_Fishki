import { describe, expect, it } from 'vitest'
import { formatNumber, formatRub } from '../calc/format'
import { HELP_VALUES, helpSections, type HelpValues } from './helpText'

// Вместо чисел — метка: цифра в выводе значит, что число вписано в текст руками
const PLACEHOLDERS: HelpValues = {
  rate: '‹курс›',
  buyin: '‹закуп›',
  amounts: '‹суммы›',
  window: '‹окно›',
  minWindow: '‹окно от›',
  maxWindow: '‹окно до›',
  blinds: '‹блайнды›',
  takeover: '‹без ведущего›',
  turnPresets: '‹время на ход›',
  turnMin: '‹своё от›',
  turnMax: '‹своё до›',
  sitOutAfter: '‹истечений›',
  autoStartPauses: '‹паузы›',
  casinoStake: '‹ставка казино›',
  casinoTables: '‹столов казино›',
  casinoSeats: '‹мест казино›',
  tournamentBuyIn: '‹бай-ин›',
  levelMinutes: '‹минут на уровень›',
  prizeRule: '‹призы›',
  tournamentRate: '‹курс турнира›',
  hudFewHands: '‹мало раздач›',
  botsMin: '‹ботов от›',
  botsMax: '‹ботов до›',
  botsDefault: '‹ботов сначала›',
  botPause: '‹пауза бота›',
  pushFold: '‹пуш-фолд›',
  forgottenHours: '‹забыли закрыть›',
  dealSeconds: '‹раздача летит›',
  streetSeconds: '‹улица летит›',
  autoOpenChoices: '‹столы сами›',
  autoOpenDefault: '‹столы сами сначала›',
  flipSeconds: '‹стол переворачивается›',
  mixVoteSeconds: '‹голосование микса›',
  runVoteSeconds: '‹выбор прогона›',
  quickBetsPot: '‹ставки после флопа›',
  quickBetsPre: '‹ставки до флопа›',
  quickBetsReraise: '‹перерейз до флопа›',
  quickBetsMax: '‹своих ставок до›',
  potPctMin: '‹доля банка от›',
  potPctMax: '‹доля банка до›',
  preMin: '‹ББ от›',
  preMax: '‹ББ до›',
  bbExample: '‹в ББ›',
  tableSizeMin: '‹размер стола от›',
  tableSizeMax: '‹размер стола до›',
}

// Код приложения и сервера комнат текстом — без тестов и без самой справки
const SOURCES = import.meta.glob<string>(
  ['../**/*.{ts,tsx}', '../../server/src/**/*.ts', '!../**/*.test.ts', '!../../server/src/**/*.test.ts', '!./helpText.ts'],
  { query: '?raw', import: 'default', eager: true },
)

// «…» в справке, которых нет строкой в коде: формат ввода, примеры, термины, чужие экраны
const NOT_IN_CODE = new Set<string>([
  'имена через запятую и число в рублях',
  'Эрик … % · Артём … % · Оля … % · ещё …',
  '≈ −… ₽',
  'сильная рука или блеф',
  'олл-ин или пас',
  'VPIP/PFR · раздач',
  'Update branch',
])

// В справке — в другом падеже или собрано из частей; в коде — эти части
const IN_CODE_AS: Record<string, string[]> = {
  'Анимацией карт': ['Анимация карт'],
  'Олл-ина': ['Олл-ин'],
  'Истории раздач': ['История раздач'],
  'Прошлых вечеров': ['Прошлые вечера'],
  Покером: ['Покер'],
  Ходах: ['Ходы'],
  Выходом: ['Выход'],
  половине: ['половины'],
  'Шансы: Да': ['Шансы', 'Да'],
  'Шансы: Нет': ['Шансы', 'Нет'],
  'Омаха, без лимита': ['Омаха, ', 'без лимита'],
  'Имя (батон) предлагает омаху': ['(батон) предлагает'],
  'Следующая раздача — омаха': ['Следующая раздача — '],
  'Остаёмся в холдем': ['Остаёмся в '],
}

// Части «…», которые должны быть в коде: многоточие и N — изменяемое (число, имя), короче двух знаков — не в счёт
function partsOf(quoted: string): string[] {
  return (
    IN_CODE_AS[quoted] ??
    quoted
      .replace(/\bN\b/g, '…')
      .split('…')
      .map((x) => x.trim())
      .filter((x) => x.length > 1)
  )
}

describe('справка', () => {
  it('разделы: по экрану, расчёт, данные и «если что-то не так»', () => {
    expect(helpSections(HELP_VALUES).map((s) => s.title)).toEqual([
      'Игры',
      'Игра',
      'Казино',
      'Игроки',
      'Карточка игрока',
      'Из Телеграма',
      'Играть',
      'Стол на этом телефоне',
      'Против ботов',
      'Комната покера',
      'Стол покера',
      'История раздач и выгрузка',
      'Холдем, омаха, шорт-дек',
      'Микс',
      'Прогнать несколько раз',
      'Время на ход, раздача сама, звук и анимация',
      'Ведущий',
      'Кэш и турнир',
      'Вид стола',
      'HUD',
      'Заметки об игроках',
      'Конец игры и связь',
      'Компьютер и широкое окно',
      'Настройки',
      'Как считаются переводы',
      'Данные',
      'Если что-то не так',
    ])
  })

  // Р-59: справка называет кнопки и экраны, как в приложении. Каждое «…» в тексте — строка из кода экранов
  // (многоточие в кавычках — изменяемая часть: «Ставка …» — «Ставка» есть в коде); не названия кнопок —
  // примеры, термины и подписи по умолчанию — списком ниже
  // Ссылки «раздел «…»» — на заголовки самой справки
  it('названия в «…» есть в коде', () => {
    const sections = helpSections(PLACEHOLDERS)
    const code = [...Object.values(SOURCES), ...sections.map((s) => s.title)].join('\n')
    const missing = new Set<string>()
    for (const p of sections.flatMap((s) => s.text)) {
      for (const [, quoted] of p.matchAll(/«([^«»]+)»/g)) {
        if (quoted.includes('‹') || NOT_IN_CODE.has(quoted)) continue
        if (partsOf(quoted).some((x) => !code.includes(x))) missing.add(quoted)
      }
    }
    expect([...missing]).toEqual([])
  })

  it('проверка названий не пустая: код читается, лишнего в списках нет', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50)
    const all = helpSections(PLACEHOLDERS)
      .flatMap((s) => s.text)
      .join('\n')
    for (const q of [...NOT_IN_CODE, ...Object.keys(IN_CODE_AS)]) expect(all).toContain(`«${q}»`)
  })

  it('цифрами в тексте ничего не написано', () => {
    for (const s of helpSections(PLACEHOLDERS)) {
      expect(s.title).not.toMatch(/\d/)
      for (const p of s.text) expect(p).not.toMatch(/\d/)
    }
  })

  it('каждое число берётся из констант и попадает в текст', () => {
    const all = helpSections(PLACEHOLDERS)
      .flatMap((s) => s.text)
      .join('\n')
    for (const mark of Object.values(PLACEHOLDERS)) expect(all).toContain(mark)
  })

  it('числа — те же, что у экранов', () => {
    expect(HELP_VALUES).toEqual({
      rate: '0,5',
      buyin: formatNumber(1000),
      amounts: [500, 1000, 2000].map(formatNumber).join(', '),
      window: '5',
      minWindow: '3',
      maxWindow: '10',
      blinds: '5/10',
      takeover: '1',
      turnPresets: '20, 30 или 60',
      turnMin: '10',
      turnMax: '300',
      sitOutAfter: '2',
      autoStartPauses: '3, 6 и 10',
      casinoStake: formatRub(10_000),
      casinoTables: '5',
      casinoSeats: '10',
      tournamentBuyIn: formatRub(100_000),
      levelMinutes: '15',
      prizeRule: 'до 4 игроков — всё первому, 5–7 — 65/35, от 8 — 50/30/20',
      tournamentRate: '1',
      hudFewHands: '30',
      botsMin: '1',
      botsMax: '5',
      botsDefault: '3',
      botPause: '1',
      pushFold: '15',
      forgottenHours: '12',
      dealSeconds: '1,5',
      streetSeconds: '1',
      autoOpenChoices: '3, 5 или 10',
      autoOpenDefault: '5',
      flipSeconds: '1,5',
      mixVoteSeconds: '15',
      runVoteSeconds: '10',
      quickBetsPot: '«⅓ банка», «½ банка», «¾ банка» и «Банк»',
      quickBetsPre: '«2,5 ББ», «3 ББ» и «4 ББ»',
      quickBetsReraise: '«×2,5», «×3» и «Банк»',
      quickBetsMax: '5',
      potPctMin: '10',
      potPctMax: '300',
      preMin: '2',
      preMax: '20',
      tableSizeMin: '70',
      tableSizeMax: '100',
      bbExample: '42,5 ББ',
    })
  })
})
