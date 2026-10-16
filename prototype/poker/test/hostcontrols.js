// Тест сит-аута и пропуска хода. Запуск: node test/hostcontrols.js
const engine = require('../src/poker/engine');
const holdem = require('../src/poker/variants/holdem');

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) failures++; };

// ---- A: сит-аут исключает игрока из раздачи ----
(function sitOut() {
  console.log('\n--- A: сит-аут ---');
  const g = engine.createGame(holdem);
  engine.addPlayer(g, { id: 'p0', name: 'A', chips: 1000 });
  engine.addPlayer(g, { id: 'p1', name: 'B', chips: 1000 });
  engine.addPlayer(g, { id: 'p2', name: 'C', chips: 1000 });
  g.players.find((p) => p.id === 'p2').sittingOut = true; // C в сит-ауте

  engine.startHand(g, { sb: 5, bb: 10 });
  const ids = g.hand.seats.map((s) => s.id);
  check(ids.length === 2 && !ids.includes('p2'), 'игрок в сит-ауте не сел в раздачу');
})();

// ---- B: пропуск хода хостом (forceCurrent) ----
(function skip() {
  console.log('\n--- B: пропуск хода ---');
  const g = engine.createGame(holdem);
  engine.addPlayer(g, { id: 'p0', name: 'A', chips: 1000 });
  engine.addPlayer(g, { id: 'p1', name: 'B', chips: 1000 });
  engine.startHand(g, { sb: 5, bb: 10 });

  // хедз-ап: ход у кнопки (SB), перед ним есть колл -> forceCurrent должен сделать ФОЛД
  const firstToAct = g.hand.seats[g.hand.toAct].id;
  const r = engine.forceCurrent(g);
  check(r.ok, 'пропуск хода выполнен');
  // раз остался один игрок — раздача завершилась без вскрытия
  check(g.hand.stage === 'complete' && g.hand.result.uncontested, 'фолд за отсутствующего -> банк сопернику');
  const winner = g.hand.result.winnerIds[0];
  check(winner !== firstToAct, 'выиграл не тот, чей ход пропустили');
})();

// ---- C: forceCurrent делает ЧЕК, когда коллировать нечего ----
(function skipCheck() {
  console.log('\n--- C: пропуск = чек на флопе ---');
  const g = engine.createGame(holdem);
  engine.addPlayer(g, { id: 'p0', name: 'A', chips: 1000 });
  engine.addPlayer(g, { id: 'p1', name: 'B', chips: 1000 });
  engine.startHand(g, { sb: 5, bb: 10 });
  engine.applyAction(g, 'p0', { type: 'call' });  // до флопа
  engine.applyAction(g, 'p1', { type: 'check' });
  // флоп, ставок нет -> forceCurrent = чек, раздача продолжается
  const stageBefore = g.hand.stage;
  const r = engine.forceCurrent(g);
  check(r.ok && g.hand.stage !== 'complete', 'чек за игрока не завершает раздачу');
  check(stageBefore === 'flop', 'мы действительно на флопе');
})();

console.log(failures === 0 ? '\n✅ ВСЕ ТЕСТЫ host-controls ПРОЙДЕНЫ' : `\n❌ ПРОВАЛЕНО: ${failures}`);
if (failures) process.exitCode = 1;
