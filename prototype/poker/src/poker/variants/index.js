// Реестр вариантов — точка расширения первой оси.
// Добавить Short Deck / Omaha = написать модуль по контракту holdem.js
// и зарегистрировать его здесь. Остальной код менять не нужно.
const holdem = require('./holdem');

const variants = {
  [holdem.id]: holdem,
  // [shortdeck.id]: shortdeck,   // в будущем
  // [omaha.id]: omaha,           // в будущем
};

function getVariant(id) {
  return variants[id] || holdem;
}

function listVariants() {
  return Object.values(variants).map((v) => ({ id: v.id, name: v.name }));
}

module.exports = { variants, getVariant, listVariants };
