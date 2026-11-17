// Правила игры за столом (#277): карточка по касанию строки над столом — чем игра стола отличается от холдема,
// простыми словами. Игра — текущая (settings.game; у «Микса» — та, на которую сменили). Холдем — null: карточки нет.
// Слова своей игры — те же кусочки, что в её строке (ownGameLine): одно описание игры, а не два
import { fromHandText, holeText, limitText, openText, ownSeatsLine } from './ownGameForm'
import { upOf, type OwnGame } from '../poker/ownGame'
import { limitFor, ownGameOf, type Settings } from '../poker/table'

export type GameRules = { title: string; lines: string[] }

// Строки, общие для шорт-дека и своих игр, — как в справке («Холдем, омаха, шорт-дек»)
export const RULE_DECK_36 = 'Колода 36 карт — без двоек–пятёрок'
export const RULE_LOW_STRAIGHT_36 = 'Туз с шестёркой, семёркой, восьмёркой и девяткой — младший стрит'
export const RULE_SHORT_ORDER = 'Флеш старше фулл-хауса, тройка старше стрита'
export const RULE_POT = `${capital(limitText('pot'))}: повысить можно не больше банка`
export const RULE_HI_LO = 'Хай/лоу: банк пополам — старшей руке и лоу «восьмёрка или ниже»; лоу нет — весь банк старшей'

// Стол холдема: флоп, тёрн, ривер
const HOLDEM_BOARD = [3, 1, 1]

export function gameRules(settings: Settings): GameRules | null {
  const own = ownGameOf(settings)
  if (own) return { title: own.name, lines: ownRules(own) }
  if (settings.game === 'omaha') {
    return {
      title: 'Омаха',
      lines: [`${holeText(4)} на руках`, fromHandLine(2, false), ...(limitFor(settings) === 'pot' ? [RULE_POT] : [])],
    }
  }
  if (settings.game === 'shortdeck') return { title: 'Шорт-дек', lines: [RULE_DECK_36, RULE_SHORT_ORDER, RULE_LOW_STRAIGHT_36] }
  return null
}

// Своя игра: только то, что не как в холдеме; число мест — всегда (оно от карт игры)
function ownRules(game: OwnGame): string[] {
  const up = upOf(game)
  const lines: string[] = []
  if (game.hole !== 2 || up > 0) {
    lines.push(`${holeText(game.hole)} на руках${up > 0 ? `, ${openText(up)} — ${up === 1 ? 'её' : 'их'} видят все` : ''}`)
  }
  // «Любые» из двух карт — как в холдеме; из большего числа — сказать
  if (game.fromHand !== 'any') lines.push(fromHandLine(game.fromHand, game.fromHand === 2))
  else if (game.hole !== 2) lines.push(`Рука — ${fromHandText('any')} и стола`)
  if (game.board.join('-') !== HOLDEM_BOARD.join('-')) lines.push(boardLine(game.board))
  if (game.deck === 36) lines.push(RULE_DECK_36, RULE_LOW_STRAIGHT_36)
  if (game.order === 'shortdeck') lines.push(RULE_SHORT_ORDER)
  if (game.limit === 'pot') lines.push(RULE_POT)
  if (game.hiLo) lines.push(RULE_HI_LO)
  lines.push(ownSeatsLine(game))
  return lines
}

// «Рука — ровно 2 из руки и 3 со стола, как в омахе»
function fromHandLine(n: number, likeOmaha: boolean): string {
  return `Рука — ${fromHandText(n)} и ${5 - n} со стола${likeOmaha ? ', как в омахе' : ''}`
}

// «Стол: после раздачи — 2 карты, затем 2 и 1»; один круг — «…, других кругов нет»
function boardLine(board: number[]): string {
  const [first, ...rest] = board
  const after = rest.length > 0 ? `затем ${rest.join(' и ')}` : 'других кругов нет'
  return `Стол: после раздачи — ${holeText(first)}, ${after}`
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
