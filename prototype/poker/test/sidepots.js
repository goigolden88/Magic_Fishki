// Тесты боковых банков. Запуск: node test/sidepots.js
const { buildPots } = require('../src/poker/pots');
const engine = require('../src/poker/engine');
const holdem = require('../src/poker/variants/holdem');

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) failures++; };
const setEq = (a, b) => a.length === b.length && new Set(a).size === new Set([...a, ...b]).size;

// ---- A: чистое построение банков ----
(function buildPotsTests() {
  console.log('\n--- A: построение банков ---');

  // 1) без ал-инов — один банк
  let p = buildPots([
    { id: 'a', committed: 100, folded: false },
    { id: 'b', committed: 100, folded: false },
    { id: 'c', committed: 100, folded: false },
  ]);
  check(p.length === 1 && p[0].amount === 300 && setEq(p[0].eligible, ['a', 'b', 'c']), 'один банк 300 на троих');

  // 2) короткий ал-ин -> основной + боковой
  p = buildPots([
    { id: 'a', committed: 100, folded: false }, // all-in за 100
    { id: 'b', committed: 200, folded: false },
    { id: 'c', committed: 200, folded: false },
  ]);
  check(p.length === 2, 'короткий ал-ин даёт 2 банка');
  check(p[0].amount === 300 && setEq(p[0].eligible, ['a', 'b', 'c']), 'основной 300 — все трое');
  check(p[1].amount === 200 && setEq(p[1].eligible, ['b', 'c']), 'боковой 200 — только b,c');

  // 3) возврат непокрытой ставки (лишнее достаётся одному претенденту)
  p = buildPots([
    { id: 'a', committed: 500, folded: false },
    { id: 'b', committed: 200, folded: false }, // all-in за 200
  ]);
  check(p.length === 2 && p[1].amount === 300 && setEq(p[1].eligible, ['a']),
    'непокрытые 300 возвращаются игроку a (один претендент)');

  // 4) мёртвые деньги фолдера сливаются в банк, который разыгрывают остальные
  p = buildPots([
    { id: 'a', committed: 50, folded: true },   // вложил 50 и спасовал
    { id: 'b', committed: 200, folded: false },
    { id: 'c', committed: 200, folded: false },
  ]);
  check(p.length === 1 && p[0].amount === 450 && setEq(p[0].eligible, ['b', 'c']),
    'фолдерские 50 в общем банке 450, претендуют b,c');
})();

// ---- B: раздача движком — основной и боковой банк разным игрокам ----
(function engineSidePot() {
  console.log('\n--- B: раздача с боковым банком ---');
  // 3 игрока: p0 (короткий стек 300) идёт ал-ин, p1 и p2 разыгрывают боковой банк.
  // p0=As Ah (сет тузов, лучший) -> основной банк.
  // p1=Kd Ks (пара K), p2=Qc Qh (пара Q) -> p1 берёт боковой.
  const deck = [
    'As', 'Kd', 'Qc', 'Ah', 'Ks', 'Qh', // личные
    'Tc', 'Ad', '7c', '2s',             // burn + flop
    '3c', '9h',                         // burn + turn
    '4c', 'Jd',                         // burn + river
  ];
  const g = engine.createGame(holdem);
  engine.addPlayer(g, { id: 'p0', name: 'A', chips: 300 });
  engine.addPlayer(g, { id: 'p1', name: 'B', chips: 1000 });
  engine.addPlayer(g, { id: 'p2', name: 'C', chips: 1000 });

  engine.startHand(g, { sb: 5, bb: 10, deckOverride: deck });
  // Кнопка=p0; SB=p1; BB=p2; ход префлоп = p0.
  engine.applyAction(g, 'p0', { type: 'allin' });        // 300
  engine.applyAction(g, 'p1', { type: 'raise', amount: 600 }); // боковой между p1,p2
  engine.applyAction(g, 'p2', { type: 'call' });          // -> флоп (p1,p2 ещё с фишками)
  // чек-даун
  engine.applyAction(g, 'p1', { type: 'check' });
  engine.applyAction(g, 'p2', { type: 'check' });          // turn
  engine.applyAction(g, 'p1', { type: 'check' });
  engine.applyAction(g, 'p2', { type: 'check' });          // river
  engine.applyAction(g, 'p1', { type: 'check' });
  engine.applyAction(g, 'p2', { type: 'check' });          // showdown

  const res = g.hand.result;
  const c = (id) => g.players.find((p) => p.id === id).chips;
  check(res.pots.length === 2, 'построено 2 банка (основной + боковой)');
  check(res.pots[0].amount === 900 && setEq(res.pots[0].winners, ['p0']), 'основной банк 900 -> p0 (сет тузов)');
  check(res.pots[1].amount === 600 && setEq(res.pots[1].winners, ['p1']), 'боковой банк 600 -> p1 (KK > QQ)');
  check(c('p0') === 900 && c('p1') === 1000 && c('p2') === 400,
    `стеки: A=${c('p0')} B=${c('p1')} C=${c('p2')} (ожид. 900/1000/400)`);
  check(c('p0') + c('p1') + c('p2') === 2300, 'сумма фишек сохранилась');
})();

console.log(failures === 0 ? '\n✅ ВСЕ ТЕСТЫ 3b ПРОЙДЕНЫ' : `\n❌ ПРОВАЛЕНО: ${failures}`);
if (failures) process.exitCode = 1;
