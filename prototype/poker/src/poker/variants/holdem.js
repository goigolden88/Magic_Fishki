// Модуль варианта "Texas Hold'em".
// Любой будущий вариант (Short Deck, Omaha) реализует ТОТ ЖЕ контракт:
//   id, name, holeCards, boardStages, buildDeck(), getWinners(contenders, board)
// Движок раздачи не знает про конкретные правила — он вызывает только этот контракт.
const { Hand } = require('pokersolver');
const { SUITS } = require('../cards');

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

const holdem = {
  id: 'holdem',
  name: "Texas Hold'em",
  holeCards: 2,           // сколько личных карт у игрока
  boardStages: [3, 1, 1], // сколько общих карт открывается на flop / turn / river

  // Полная упорядоченная колода (движок сам перемешает).
  buildDeck() {
    const deck = [];
    for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
    return deck;
  },

  // Определение победителей среди дошедших до вскрытия.
  // contenders: [{ id, holeCards: ['As','Kd'] }], board: ['2c','7d','9s','Jh','Ad']
  // Возвращает { winnerIds: [...], results: { id: { name, rank, descr } } }
  getWinners(contenders, board) {
    const solved = contenders.map((c) => {
      const h = Hand.solve([...c.holeCards, ...board]);
      h._id = c.id;
      return h;
    });
    const winners = Hand.winners(solved);
    const winnerIds = winners.map((h) => h._id);
    const results = {};
    for (const h of solved) {
      results[h._id] = {
        name: h.name,
        rank: h.rank,
        descr: h.descr,
        // 5 карт, составляющих комбинацию (для истории раздач); формат как у колоды: 'As','Kd'...
        cards: (h.cards || []).map((c) => (typeof c === 'string' ? c : c.value + c.suit)),
      };
    }
    return { winnerIds, results };
  },
};

module.exports = holdem;
