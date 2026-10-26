// Режим игры (Р-29): «покер», «покер и казино», «только казино»
import type { Game, GameMode } from '../model'

export const MODE_LABEL: Record<GameMode, string> = {
  poker: 'Покер',
  mixed: 'Покер и казино',
  casino: 'Только казино',
}

// Поле режима есть — оно; нет (игры до Р-29) — по данным: раунды без покерных записей — только казино,
// и то и другое — покер и казино, иначе — покер
export function gameMode(game: Game): GameMode {
  if (game.mode !== undefined) return game.mode
  const rounds = game.casino?.length ?? 0
  if (rounds === 0) return 'poker'
  return game.entries.length === 0 ? 'casino' : 'mixed'
}

// «Добавить казино» в игре «покер» — игра становится «покер и казино»
export function addCasino(game: Game): Game {
  return gameMode(game) === 'poker' ? { ...game, mode: 'mixed' } : game
}

// «Добавить покер» в игре «только казино» — «покер и казино», курс — из настроек
export function addPoker(game: Game, rate: number): Game {
  return gameMode(game) === 'casino' ? { ...game, mode: 'mixed', rate } : game
}
