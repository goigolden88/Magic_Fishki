// Граничные случаи. Запуск: node test/edge.js
const engine = require('../src/poker/engine');
const holdem = require('../src/poker/variants/holdem');

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '✅' : '❌') + ' ' + msg);
  if (!cond) failures++;
}

// ---- Сценарий A: 3 игрока, all-in префлоп, автодосдача борда, каре (премиум) ----
(function scenarioA() {
  console.log('\n--- A: multiway all-in + каре ---');
  // Раздача 3 игрокам: p0c1,p1c1,p2c1,p0c2,p1c2,p2c2, burn, flop x3, burn, turn, burn, river
  // p0 = As Ah; борд Ad Ac -> каре тузов.
  const deck = [
    'As', 'Kd', '2h', 'Ah', 'Kc', '3h', // личные
    '4c', 'Ad', 'Ac', '7s',             // burn + flop
    '5c', '9d',                         // burn + turn
    '6c', 'Jc',                         // burn + river
  ];
  const g = engine.createGame(holdem);
  engine.addPlayer(g, { id: 'p0', name: 'A', chips: 300 });
  engine.addPlayer(g, { id: 'p1', name: 'B', chips: 1000 });
  engine.addPlayer(g, { id: 'p2', name: 'C', chips: 1000 });

  engine.startHand(g, { sb: 5, bb: 10, deckOverride: deck });
  // Кнопка=p0; SB=p1; BB=p2; первый ход префлоп = p0 (UTG в 3-макс).
  check(engine.viewFor(g, 'p0').toAct === 'p0', 'первый ход префлоп у кнопки (3-макс)');

  engine.applyAction(g, 'p0', { type: 'allin' });  // 300
  engine.applyAction(g, 'p1', { type: 'call' });    // уравнивает 300
  const rr = engine.applyAction(g, 'p2', { type: 'fold' }); // -> пауза run-out
  check(rr.state === 'runout', 'после фолда — точка досдачи (run-out)');
  engine.runOut(g, 1); // досдаём один прогон -> вскрытие

  const res = g.hand.result;
  check(res && res.winnerIds.length === 1 && res.winnerIds[0] === 'p0', 'выигрывает p0');
  check(res && res.results['p0'].name === 'Four of a Kind', 'комбинация p0 = каре');
  check(res && res.premium === true, 'премиальная рука распознана');

  const c = (id) => g.players.find((p) => p.id === id).chips;
  check(c('p0') === 610 && c('p1') === 700 && c('p2') === 990,
    `стеки: A=${c('p0')} B=${c('p1')} C=${c('p2')} (ожид. 610/700/990)`);
  check(c('p0') + c('p1') + c('p2') === 2300, 'сумма фишек сохранилась (2300)');
})();

// ---- Сценарий B: ничья -> сплит банка ----
(function scenarioB() {
  console.log('\n--- B: сплит при ничьей ---');
  // Оба играют борд (стрит на столе T-A), руки эквивалентны -> делёж.
  // p0 = 2c 3d; p1 = 4h 5s; борд = Ts Jh Qd Kc Ad (стрит туз-десятка на столе).
  const deck = [
    '2c', '4h', '3d', '5s',   // личные: p0=2c 3d, p1=4h 5s
    '6c', 'Ts', 'Jh', 'Qd',   // burn + flop
    '7c', 'Kc',               // burn + turn
    '8c', 'Ad',               // burn + river
  ];
  const g = engine.createGame(holdem);
  engine.addPlayer(g, { id: 'p0', name: 'A', chips: 1000 });
  engine.addPlayer(g, { id: 'p1', name: 'B', chips: 1000 });

  engine.startHand(g, { sb: 5, bb: 10, deckOverride: deck });
  engine.applyAction(g, 'p0', { type: 'call' });   // хедз-ап: кнопка p0 уравнивает
  engine.applyAction(g, 'p1', { type: 'check' });   // флоп
  engine.applyAction(g, 'p1', { type: 'check' });
  engine.applyAction(g, 'p0', { type: 'check' });   // тёрн
  engine.applyAction(g, 'p1', { type: 'check' });
  engine.applyAction(g, 'p0', { type: 'check' });   // ривер
  engine.applyAction(g, 'p1', { type: 'check' });
  engine.applyAction(g, 'p0', { type: 'check' });   // вскрытие

  const res = g.hand.result;
  check(res && res.winnerIds.length === 2, 'два победителя (ничья)');
  const c = (id) => g.players.find((p) => p.id === id).chips;
  check(c('p0') === 1000 && c('p1') === 1000, `банк поделён поровну: A=${c('p0')} B=${c('p1')}`);
})();

// ---- Сценарий C: фолд -> банк без вскрытия ----
(function scenarioC() {
  console.log('\n--- C: фолд, банк без вскрытия ---');
  const g = engine.createGame(holdem);
  engine.addPlayer(g, { id: 'p0', name: 'A', chips: 1000 });
  engine.addPlayer(g, { id: 'p1', name: 'B', chips: 1000 });
  engine.startHand(g, { sb: 5, bb: 10 });
  engine.applyAction(g, 'p0', { type: 'raise', amount: 30 }); // кнопка поднимает
  const r = engine.applyAction(g, 'p1', { type: 'fold' });    // BB пасует
  check(r.result && r.result.uncontested === true, 'банк забран без вскрытия');
  const c = (id) => g.players.find((p) => p.id === id).chips;
  check(c('p0') === 1010 && c('p1') === 990, `стеки: A=${c('p0')} B=${c('p1')} (ожид. 1010/990)`);
})();

console.log(failures === 0 ? '\n✅ ВСЕ ГРАНИЧНЫЕ ТЕСТЫ ПРОЙДЕНЫ' : `\n❌ ПРОВАЛЕНО: ${failures}`);
if (failures) process.exitCode = 1;
