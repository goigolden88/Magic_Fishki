import { describe, expect, it } from 'vitest'
import { formatBB, formatNumber, formatRub } from '../calc/format'
import { allHelpSections, HELP_VALUES, helpGroups, helpSections, OWN_SERVER_DOC, type HelpValues } from './helpText'

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
  timeBankPresets: '‹запас›',
  timeBankEvery: '‹раздач до пополнения›',
  timeBankAdd: '‹пополнение›',
  timeBankMax: '‹запас не больше›',
  tipTurn: '‹совет: ход›',
  tipBank: '‹совет: запас›',
  autoStartPauses: '‹паузы›',
  casinoStake: '‹ставка казино›',
  casinoTables: '‹столов казино›',
  casinoSeats: '‹мест казино›',
  tournamentBuyIn: '‹бай-ин›',
  levelMinutes: '‹минут на уровень›',
  prizeRule: '‹призы›',
  tournamentRate: '‹курс турнира›',
  hudFewHands: '‹мало раздач›',
  hudFirmHands: '‹твёрдое чтение›',
  botsMin: '‹ботов от›',
  botsMax: '‹ботов до›',
  botsDefault: '‹ботов сначала›',
  botPause: '‹пауза бота›',
  pushFold: '‹пуш-фолд›',
  forgottenHours: '‹забыли закрыть›',
  dealSeconds: '‹раздача летит›',
  streetSeconds: '‹улица летит›',
  coolerBB: '‹кулер от ББ›',
  autoOpenChoices: '‹столы сами›',
  autoOpenDefault: '‹столы сами сначала›',
  flipSeconds: '‹стол переворачивается›',
  mixVoteSeconds: '‹голосование микса›',
  runVoteSeconds: '‹выбор прогона›',
  muckVoteSeconds: '‹пауза мака›',
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
  potSnaps: '‹прилипает после флопа›',
  reraiseSnaps: '‹прилипает после рейза›',
  betSteps: '‹шаг колеса›',
  betShareBB: '‹доля банка в ББ›',
  betShareChips: '‹доля банка в фишках›',
  trainerSidesMin: '‹сторон от›',
  trainerSidesMax: '‹сторон до›',
  trainerWeights: '‹веса касания›',
  trainerSamples: '‹досдач в выборке›',
  trainerExample: '‹диапазон текстом›',
  chartsGame: '‹игра чартов›',
  chartsRounding: '‹округление чартов›',
  aiChartName: '‹имя чарта от ИИ›',
  aiShareSum: '‹доли ИИ в сумме›',
  ownBackFileMb: '‹своя рубашка, МБ›',
  ownNameMax: '‹название своей игры до›',
  ownHoleMin: '‹карт на руках от›',
  ownHoleMax: '‹карт на руках до›',
  ownDecks: '‹колоды своей игры›',
  ownShortDeck: '‹колода шорт-дека›',
  ownRoundMax: '‹карт в круге до›',
  ownRoundsMax: '‹кругов до›',
  ownBoardMin: '‹карт стола от›',
  ownBoardMax: '‹карт стола до›',
  ownBoardStart: '‹круги сначала›',
  ownSeatsMax: '‹мест своей игры до›',
  roomSeats: '‹мест в комнате›',
  ownGamesMax: '‹своих игр до›',
  ownLineExample: '‹строка своей игры›',
  ownOpenLineExample: '‹строка своей игры с открытыми›',
  ownHiLoLineExample: '‹строка своей игры хай/лоу›',
  ownServerDoc: '‹свой сервер›',
  syncQuiet: '‹тишина синхронизации›',
  syncGap: '‹возврат не чаще›',
  syncRetry: '‹повтор гонки›',
  tokenWarnDays: '‹предупреждение о токене›',
  tombstoneDays: '‹метка живёт›',
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
  'Свой сервер покера',
  'Regenerate token',
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
  'Показать первую': ['Показать', 'первую'],
  'Показать вторую': ['Показать', 'вторую'],
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
  // #245: разделы — группами, по порядку экранов
  it('группы и разделы в них — по экранам приложения', () => {
    expect(helpGroups(HELP_VALUES).map((g) => [g.title, g.sections.map((s) => s.title)])).toEqual([
      ['Учёт вечера', ['Игры', 'Из Телеграма', 'Игра', 'Казино', 'Игроки', 'Карточка игрока', 'Как считаются переводы']],
      ['Покер: начать игру', ['Играть', 'Комната покера', 'Ведущий', 'Кэш и турнир', 'Стол на этом телефоне', 'Против ботов']],
      [
        'Покер: за столом',
        [
          'Стол покера',
          'Время на ход, раздача сама, звук и анимация',
          'Вид стола',
          'HUD',
          'Заметки об игроках',
          'История раздач и выгрузка',
          'Конец игры и связь',
        ],
      ],
      ['Покер: игры', ['Холдем, омаха, шорт-дек', 'Свои игры', 'Микс', 'Прогнать несколько раз']],
      ['Тренажёр', ['Калькулятор', 'Чарты']],
      ['Приложение', ['Настройки', 'Синхронизация', 'Компьютер и широкое окно', 'Данные', 'Если что-то не так']],
    ])
  })

  it('каждый раздел — ровно в одной группе, пустых групп нет', () => {
    const inGroups = helpGroups(HELP_VALUES).flatMap((g) => g.sections.map((s) => s.title))
    const written = allHelpSections(HELP_VALUES).map((s) => s.title)
    expect(new Set(written).size).toBe(written.length)
    expect([...inGroups].sort()).toEqual([...written].sort())
    for (const g of helpGroups(HELP_VALUES)) expect(g.sections.length).toBeGreaterThan(0)
    expect(helpSections(HELP_VALUES).map((s) => s.title)).toEqual(inGroups)
  })

  // Ссылка «раздел «…»» в тексте ведёт на заголовок раздела справки
  it('ссылки на разделы — на существующие разделы', () => {
    const titles = new Set(allHelpSections(PLACEHOLDERS).map((s) => s.title))
    const missing = new Set<string>()
    for (const p of allHelpSections(PLACEHOLDERS).flatMap((s) => s.text)) {
      for (const [, title] of p.matchAll(/раздел(?:е|а)? «([^«»]+)»/g)) {
        if (title !== 'Настроек' && !titles.has(title)) missing.add(title)
      }
    }
    expect([...missing]).toEqual([])
  })

  it('раздел о сервере в «Настройках» ведёт на инструкцию «Свой сервер покера»', () => {
    expect(OWN_SERVER_DOC).toBe('https://github.com/goigolden88/Magic_Fishki/blob/main/docs/Свой%20сервер%20покера.md')
    const settings = allHelpSections(HELP_VALUES).find((s) => s.title === 'Настройки')
    expect(settings?.text.find((p) => p.includes('«Адрес сервера»'))).toContain(OWN_SERVER_DOC)
  })

  // Длинный раздел — абзацами по темам (#245): «Против ботов» был одним абзацем в несколько тысяч знаков
  it('абзацы — не длиннее трёх тысяч знаков', () => {
    const long = allHelpSections(HELP_VALUES)
      .flatMap((s) => s.text.map((p) => [s.title, p.length] as const))
      .filter(([, n]) => n > 3000)
    expect(long).toEqual([])
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
      timeBankPresets: '15, 30 или 60',
      timeBankEvery: '10',
      timeBankAdd: '5',
      timeBankMax: '60',
      tipTurn: '20',
      tipBank: '30',
      autoStartPauses: '3, 6 и 10',
      casinoStake: formatRub(10_000),
      casinoTables: '5',
      casinoSeats: '10',
      tournamentBuyIn: formatRub(100_000),
      levelMinutes: '15',
      prizeRule: 'до 4 игроков — всё первому, 5–7 — 65/35, от 8 — 50/30/20',
      tournamentRate: '1',
      hudFewHands: '30',
      hudFirmHands: '100',
      botsMin: '1',
      botsMax: '5',
      botsDefault: '3',
      botPause: '1',
      pushFold: '15',
      forgottenHours: '12',
      dealSeconds: '1,5',
      streetSeconds: '1',
      coolerBB: '20',
      autoOpenChoices: '3, 5 или 10',
      autoOpenDefault: '5',
      flipSeconds: '1,5',
      mixVoteSeconds: '15',
      runVoteSeconds: '10',
      muckVoteSeconds: '7',
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
      potSnaps: '33, 50, 66, 75 и 100',
      reraiseSnaps: '«×2,5» и «×3»',
      betSteps: `«${formatBB(10, 10)}» (сначала) или «${formatBB(5, 10)}»`,
      betShareBB: `«66 % банка · ${formatBB(1200, 100)}»`,
      betShareChips: `«66 % банка · ${formatNumber(1200)}»`,
      trainerSidesMin: '2',
      trainerSidesMax: '6',
      trainerWeights: '«100 %» (сначала), «75 %», «50 %», «25 %» или «0 %»',
      trainerSamples: formatNumber(20_000),
      trainerExample: '«77+, A9s+, AJo+, AKs:0.5»',
      chartsGame: '6-макс, 100 ББ',
      aiChartName: '«Чарт от ИИ»',
      aiShareSum: 'от 0,99 до 1,01',
      ownBackFileMb: '20',
      ownNameMax: '24',
      ownHoleMin: '2',
      ownHoleMax: '7',
      ownDecks: '«52 карты» или «36 карт»',
      ownShortDeck: '«36 карт»',
      ownRoundMax: '3',
      ownRoundsMax: '3',
      ownBoardMin: '3',
      ownBoardMax: '5',
      ownBoardStart: '3, 1, 1',
      ownSeatsMax: '10',
      roomSeats: '9',
      ownGamesMax: '8',
      ownLineExample: '«5 карт, ровно 2 из руки · стол 3-1-1 · пот-лимит · до 9 игроков»',
      ownOpenLineExample: '«3 карты (1 открытая), любые из руки · стол 3-1-1 · без лимита · до 10 игроков»',
      ownHiLoLineExample: '«4 карты, ровно 2 из руки · стол 3-1-1 · пот-лимит · хай/лоу · до 10 игроков»',
      ownServerDoc: OWN_SERVER_DOC,
      syncQuiet: '5 секунд',
      syncGap: 'минуту',
      syncRetry: 'минуту',
      tokenWarnDays: '30',
      tombstoneDays: '30',
      chartsRounding: 'доли округлены до 25 % (у пар — до 1/6)',
      bbExample: '42,5 ББ',
    })
  })
})
