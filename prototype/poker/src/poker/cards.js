// Общие утилиты для карт. Карта = строка "Ah" (ранг + масть),
// формат совместим с библиотекой pokersolver.
const SUITS = ['s', 'h', 'd', 'c'];

// Перемешивание Фишера–Йейтса. rng можно подменить в тестах для детерминизма.
function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { SUITS, shuffle };
