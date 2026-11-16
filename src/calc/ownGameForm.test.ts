import { describe, expect, it } from 'vitest'
import { ownGameError, type OwnGame } from '../poker/ownGame'
import {
  canAddOwnGame,
  canAddRound,
  canRemoveRound,
  fromHandAllowed,
  fromHandChoices,
  OWN_GAME_NEW,
  ownFormError,
  ownGameFormOf,
  ownGameLine,
  ownGameOf,
  ownSeatsLine,
  putOwnGame,
  removeOwnGame,
  upChoices,
  withDeck,
  withHole,
  withoutRound,
  withRound,
  withRoundCards,
  type OwnGameForm,
} from './ownGameForm'

const OMAHA6: OwnGameForm = { name: 'Омаха-6', hole: 6, fromHand: 2, deck: 52, order: 'standard', board: [3, 1, 1], limit: 'pot' }

describe('форма своей игры (#225)', () => {
  it('новая — пустое название, стол «3, 1, 1»; сохранить нельзя, пока нет названия', () => {
    expect(OWN_GAME_NEW.board).toEqual([3, 1, 1])
    expect(ownFormError(OWN_GAME_NEW)).toEqual({ field: 'name', text: 'У своей игры нет названия' })
    expect(ownFormError({ ...OWN_GAME_NEW, name: '   ' })?.field).toBe('name')
    expect(ownFormError({ ...OWN_GAME_NEW, name: 'Я'.repeat(25) })?.field).toBe('name')
    expect(ownFormError({ ...OWN_GAME_NEW, name: 'Холдем друзей' })).toBeNull()
  })

  it('в описание и обратно: название без пробелов по краям, проверка — та же, что у сервера', () => {
    const game = ownGameOf({ ...OMAHA6, name: '  Омаха-6 ' }, 'own-a1')
    expect(game).toEqual({ id: 'own-a1', ...OMAHA6 })
    expect(ownGameError(game)).toBeNull()
    expect(ownGameFormOf(game)).toEqual(OMAHA6)
  })

  it('ошибка — под своим полем: «ровно N» или карты стола', () => {
    // Ровно одна из руки — нужно четыре карты стола, а их три
    const one = { ...OMAHA6, fromHand: 1, board: [3] }
    expect(ownFormError(one)).toEqual({ field: 'fromHand', text: '„Омаха-6“: из руки ровно 1 — нужно карт стола 4, а их 3' })
    expect(ownFormError({ ...OMAHA6, board: [1, 1] })?.field).toBe('board')
    expect(ownFormError({ ...OMAHA6, board: [3, 3] })).toEqual({ field: 'board', text: '„Омаха-6“: карт стола — от 3 до 5, а не 6' })
  })

  it('«ровно N»: кнопки до меньшего из карт на руках и 5; неактивны, если карт стола мало', () => {
    expect(fromHandChoices({ hole: 2 })).toEqual([1, 2])
    expect(fromHandChoices({ hole: 7 })).toEqual([1, 2, 3, 4, 5])
    expect(fromHandAllowed({ board: [3] }, 1)).toBe(false)
    expect(fromHandAllowed({ board: [3] }, 2)).toBe(true)
    expect(fromHandAllowed({ board: [3, 1] }, 1)).toBe(true)
  })

  it('меньше карт на руках — «ровно N» не больше их; колода 36 — старшинство шорт-дека', () => {
    expect(withHole({ ...OMAHA6, fromHand: 5, hole: 7 }, 3)).toMatchObject({ hole: 3, fromHand: 3 })
    expect(withHole(OMAHA6, 3)).toMatchObject({ hole: 3, fromHand: 2 })
    expect(withHole({ ...OMAHA6, fromHand: 'any' }, 2).fromHand).toBe('any')
    expect(withDeck(OMAHA6, 36)).toMatchObject({ deck: 36, order: 'shortdeck' })
    expect(withDeck({ ...OMAHA6, deck: 36, order: 'shortdeck' }, 52)).toMatchObject({ deck: 52, order: 'standard' })
  })

  it('круги стола: «+ круг» — в одну карту, до трёх кругов и пяти карт; «− круг» — пока кругов больше одного', () => {
    const flop = { ...OMAHA6, board: [3] }
    expect(withRound(flop).board).toEqual([3, 1])
    expect(canAddRound({ ...OMAHA6, board: [3, 1, 1] })).toBe(false)
    expect(canAddRound({ ...OMAHA6, board: [3, 2] })).toBe(false)
    expect(withRound({ ...OMAHA6, board: [3, 2] }).board).toEqual([3, 2])
    expect(withoutRound(OMAHA6).board).toEqual([3, 1])
    expect(canRemoveRound(flop)).toBe(false)
    expect(withoutRound(flop).board).toEqual([3])
    expect(withRoundCards(OMAHA6, 1, 2).board).toEqual([3, 2, 1])
  })

  it('строки: игра в списке и места за столом', () => {
    expect(ownGameLine({ ...OMAHA6, hole: 5 })).toBe('5 карт, ровно 2 из руки · стол 3-1-1 · пот-лимит · до 9 игроков')
    expect(ownGameLine(OMAHA6)).toBe('6 карт, ровно 2 из руки · стол 3-1-1 · пот-лимит · до 7 игроков')
    expect(ownGameLine({ ...OWN_GAME_NEW, name: 'Х', hole: 3, deck: 36, order: 'shortdeck', board: [3, 2] })).toBe(
      '3 карты, любые из руки · стол 3-2 · колода 36 · без лимита · до 10 игроков',
    )
    expect(ownGameLine({ ...OMAHA6, hole: 2, deck: 36, order: 'standard' })).toContain('колода 36, обычное старшинство')
    expect(ownGameLine({ ...OMAHA6, order: 'shortdeck' })).toContain('старшинство как в шорт-деке')
    expect(ownSeatsLine(OMAHA6)).toBe('За столом — до 7 игроков')
  })

  it('«из них открытых» (#226): кнопки 0…карт − 1; меньше карт — открытых меньше; 0 — без поля; строка с открытыми', () => {
    expect(upChoices({ hole: 3 })).toEqual([0, 1, 2])
    expect(upChoices({ hole: 2 })).toEqual([0, 1])
    expect(withHole({ ...OMAHA6, up: 5 }, 3)).toMatchObject({ hole: 3, up: 2 })
    expect(withHole({ ...OMAHA6, up: 1 }, 3)).toMatchObject({ hole: 3, up: 1 })
    expect(withHole(OMAHA6, 3)).not.toHaveProperty('up')
    // 0 открытых — описание без поля up, как у игр до #226
    expect(ownGameOf({ ...OMAHA6, up: 0 }, 'own-a1')).not.toHaveProperty('up')
    const game = ownGameOf({ ...OWN_GAME_NEW, name: 'Три с открытой', hole: 3, up: 1 }, 'own-a2')
    expect(game.up).toBe(1)
    expect(ownGameError(game)).toBeNull()
    expect(ownGameFormOf(game).up).toBe(1)
    expect(ownGameLine(game)).toBe('3 карты (1 открытая), любые из руки · стол 3-1-1 · без лимита · до 10 игроков')
    expect(ownGameLine({ ...OMAHA6, up: 2 })).toBe('6 карт (2 открытые), ровно 2 из руки · стол 3-1-1 · пот-лимит · до 7 игроков')
    expect(ownGameLine({ ...OMAHA6, hole: 7, up: 5 })).toContain('7 карт (5 открытых),')
    expect(ownGameLine({ ...OMAHA6, up: 0 })).toBe(ownGameLine(OMAHA6))
  })

  it('список: та же игра — на своём месте, новая — в конец, не больше восьми', () => {
    const a: OwnGame = { id: 'own-a', ...OMAHA6 }
    const b: OwnGame = { id: 'own-b', ...OMAHA6, name: 'Б' }
    expect(putOwnGame([a], b)).toEqual([a, b])
    expect(putOwnGame([a, b], { ...a, name: 'А2' })).toEqual([{ ...a, name: 'А2' }, b])
    expect(removeOwnGame([a, b], 'own-a')).toEqual([b])
    expect(canAddOwnGame(Array(7).fill(a))).toBe(true)
    expect(canAddOwnGame(Array(8).fill(a))).toBe(false)
  })
})
