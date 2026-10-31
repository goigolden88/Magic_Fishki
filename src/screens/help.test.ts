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
  forgottenHours: '‹забыли закрыть›',
  dealSeconds: '‹раздача летит›',
  streetSeconds: '‹улица летит›',
}

describe('справка', () => {
  it('разделы: по экрану, расчёт, данные и «если что-то не так»', () => {
    expect(helpSections(HELP_VALUES).map((s) => s.title)).toEqual([
      'Игры',
      'Игра',
      'Игроки',
      'Карточка игрока',
      'Из Телеграма',
      'Покер онлайн',
      'Настройки',
      'Как считаются переводы',
      'Данные',
      'Если что-то не так',
    ])
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
      forgottenHours: '12',
      dealSeconds: '1,5',
      streetSeconds: '1',
    })
  })
})
