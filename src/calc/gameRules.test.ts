import { describe, expect, it } from 'vitest'
import { gameRules, RULE_DECK_36, RULE_HI_LO, RULE_LOW_STRAIGHT_36, RULE_POT, RULE_SHORT_ORDER } from './gameRules'
import { HELP_VALUES, helpSections } from '../screens/helpText'
import { ownGameError, type OwnGame } from '../poker/ownGame'
import { DEFAULT_SETTINGS, type Settings } from '../poker/table'

const phones: Settings = { ...DEFAULT_SETTINGS, cards: 'phones' }

function own(game: Partial<OwnGame>): Settings {
  const g: OwnGame = { id: 'own-t', name: 'Своя', hole: 2, fromHand: 'any', deck: 52, order: 'standard', board: [3, 1, 1], limit: 'nolimit', ...game }
  expect(ownGameError(g)).toBeNull()
  return { ...phones, games: [g], game: g.id }
}

describe('правила игры за столом (#277)', () => {
  it('холдем — карточки нет: и без поля игры, и явно', () => {
    expect(gameRules(DEFAULT_SETTINGS)).toBeNull()
    expect(gameRules({ ...phones, game: 'holdem' })).toBeNull()
    // Своей игры с таким id в столе нет — не своя
    expect(gameRules({ ...phones, game: 'own-nope' })).toBeNull()
  })

  it('омаха: 4 карты, ровно 2 из руки; пот-лимит — строкой, без лимита — как в холдеме', () => {
    expect(gameRules({ ...phones, game: 'omaha' })).toEqual({
      title: 'Омаха',
      lines: ['4 карты на руках', 'Рука — ровно 2 из руки и 3 со стола', RULE_POT],
    })
    expect(gameRules({ ...phones, game: 'omaha', limit: 'pot' })?.lines).toContain(RULE_POT)
    expect(gameRules({ ...phones, game: 'omaha', limit: 'nolimit' })).toEqual({
      title: 'Омаха',
      lines: ['4 карты на руках', 'Рука — ровно 2 из руки и 3 со стола'],
    })
    expect(RULE_POT).toBe('Пот-лимит: повысить можно не больше банка')
  })

  it('шорт-дек: колода 36, старшинство и младший стрит — как в справке', () => {
    expect(gameRules({ ...phones, game: 'shortdeck' })).toEqual({
      title: 'Шорт-дек',
      lines: [RULE_DECK_36, RULE_SHORT_ORDER, RULE_LOW_STRAIGHT_36],
    })
    const help = helpSections(HELP_VALUES)
      .flatMap((s) => s.text)
      .join(' ')
    expect(help).toContain('без двоек–пятёрок')
    expect(help).toContain('Флеш в нём старше фулл-хауса')
    expect(help).toContain('туз с шестёркой, семёркой, восьмёркой и девяткой — младший стрит')
    expect(help).toContain('тройка старше стрита')
  })

  it('своя: открытые карты и «любые» из руки', () => {
    expect(gameRules(own({ name: 'Три с открытой', hole: 3, up: 1 }))).toEqual({
      title: 'Три с открытой',
      lines: ['3 карты на руках, 1 открытая — её видят все', 'Рука — любые из руки и стола', 'За столом — до 10 игроков'],
    })
    expect(gameRules(own({ hole: 7, up: 2 }))?.lines[0]).toBe('7 карт на руках, 2 открытые — их видят все')
  })

  it('своя без открытых: две карты и «любые» — как в холдеме, только места', () => {
    expect(gameRules(own({}))?.lines).toEqual(['За столом — до 10 игроков'])
    expect(gameRules(own({ hole: 5, fromHand: 2, limit: 'pot' }))?.lines).toEqual([
      '5 карт на руках',
      'Рука — ровно 2 из руки и 3 со стола, как в омахе',
      RULE_POT,
      'За столом — до 9 игроков',
    ])
  })

  it('своя «ровно N»: не два — без «как в омахе»; две карты и ровно 2 — строкой', () => {
    expect(gameRules(own({ hole: 4, fromHand: 3 }))?.lines[1]).toBe('Рука — ровно 3 из руки и 2 со стола')
    expect(gameRules(own({ fromHand: 2 }))?.lines).toEqual(['Рука — ровно 2 из руки и 3 со стола, как в омахе', 'За столом — до 10 игроков'])
  })

  it('своя: колода 36 с обычным старшинством и как в шорт-деке; 52 со старшинством шорт-дека', () => {
    expect(gameRules(own({ deck: 36 }))?.lines).toEqual([RULE_DECK_36, RULE_LOW_STRAIGHT_36, 'За столом — до 10 игроков'])
    expect(gameRules(own({ deck: 36, order: 'shortdeck' }))?.lines).toEqual([
      RULE_DECK_36,
      RULE_LOW_STRAIGHT_36,
      RULE_SHORT_ORDER,
      'За столом — до 10 игроков',
    ])
    expect(gameRules(own({ order: 'shortdeck' }))?.lines).toEqual([RULE_SHORT_ORDER, 'За столом — до 10 игроков'])
  })

  it('своя хай/лоу: делёж банка строкой', () => {
    const rules = gameRules(own({ name: 'Омаха хай/лоу', hole: 4, fromHand: 2, limit: 'pot', hiLo: true }))
    expect(rules?.lines).toEqual([
      '4 карты на руках',
      'Рука — ровно 2 из руки и 3 со стола, как в омахе',
      RULE_POT,
      RULE_HI_LO,
      'За столом — до 10 игроков',
    ])
    expect(RULE_HI_LO).toContain('лоу «восьмёрка или ниже»')
    expect(RULE_HI_LO).toContain('лоу нет — весь банк старшей')
  })

  it('своя: стол 3-1-1 — как в холдеме, 2-2-1 и один круг — строкой', () => {
    expect(gameRules(own({ board: [3, 1, 1] }))?.lines.some((l) => l.startsWith('Стол'))).toBe(false)
    expect(gameRules(own({ board: [2, 2, 1] }))?.lines[0]).toBe('Стол: после раздачи — 2 карты, затем 2 и 1')
    expect(gameRules(own({ board: [3, 2] }))?.lines[0]).toBe('Стол: после раздачи — 3 карты, затем 2')
    expect(gameRules(own({ board: [3] }))?.lines[0]).toBe('Стол: после раздачи — 3 карты, других кругов нет')
  })

  it('«Микс» на своей игре — её правила; сменили на холдем — карточки нет', () => {
    const g: OwnGame = { id: 'own-m', name: 'Пять', hole: 5, fromHand: 'any', deck: 52, order: 'standard', board: [3, 1, 1], limit: 'nolimit' }
    const mix: Settings = { ...phones, mix: true, games: [g], game: 'holdem' }
    expect(gameRules(mix)).toBeNull()
    expect(gameRules({ ...mix, game: 'own-m' })).toEqual({
      title: 'Пять',
      lines: ['5 карт на руках', 'Рука — любые из руки и стола', 'За столом — до 9 игроков'],
    })
    expect(gameRules({ ...mix, game: 'omaha' })?.title).toBe('Омаха')
  })
})
