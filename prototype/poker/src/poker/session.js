// Реестр сессии: закупы игроков, история раздач, порядок вылетов.
// Из него считаются итоговые таблицы — сводка кеша (+/−) и места турнира.
// Чистый модуль без I/O (диск — отдельно, в storage.js).

function createSession(startingStack) {
  return {
    startingStack,
    buyIns: {},      // id -> сколько всего занёс фишек
    names: {},       // id -> имя
    hands: [],       // компактные записи раздач
    eliminated: [],  // id в порядке вылета (первый вылетевший — первый)
    handCount: 0,
  };
}

function addPlayer(s, { id, name }) {
  if (s.buyIns[id] == null) {
    s.buyIns[id] = s.startingStack;
    s.names[id] = name;
  }
}

// Докупка/ребай (на будущее — UI добавим позже).
function recordBuyIn(s, id, amount) {
  s.buyIns[id] = (s.buyIns[id] || 0) + amount;
}

function recordHand(s, rec) {
  s.handCount += 1;
  const full = { n: s.handCount, ...rec };
  s.hands.push(full);
  return full;
}

function updateEliminations(s, players) {
  for (const p of players) {
    if (p.chips === 0 && !s.eliminated.includes(p.id)) s.eliminated.push(p.id);
  }
}

// Сводка кеша: всего закуплено, текущий стек, итог (+/−), сортировка по итогу.
function cashSummary(s, players) {
  return players
    .map((p) => {
      const buyIn = s.buyIns[p.id] ?? s.startingStack;
      return { id: p.id, name: s.names[p.id] || p.name, buyIn, stack: p.chips, net: p.chips - buyIn };
    })
    .sort((a, b) => b.net - a.net);
}

// Турнирная таблица мест: живые (по стеку) сверху, затем вылетевшие в обратном
// порядке (вылетевший последним — выше).
function tournamentStandings(s, players) {
  const alive = players.filter((p) => p.chips > 0).sort((a, b) => b.chips - a.chips).map((p) => p.id);
  const busted = [...s.eliminated].reverse();
  const order = [...alive, ...busted];
  return order.map((id, i) => ({
    place: i + 1,
    id,
    name: s.names[id] || id,
    chips: players.find((p) => p.id === id)?.chips ?? 0,
    eliminated: s.eliminated.includes(id),
  }));
}

module.exports = {
  createSession, addPlayer, recordBuyIn, recordHand,
  updateEliminations, cashSummary, tournamentStandings,
};
