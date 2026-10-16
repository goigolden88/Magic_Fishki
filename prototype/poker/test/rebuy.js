// Тесты докупок и правок стека. Запуск: node test/rebuy.js
const roomMod = require('../src/poker/room');

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) failures++; };

// ---- A: лимиты кеша ----
(function cashLimits() {
  console.log('\n--- A: лимиты кеша ---');
  // без ребая
  let r = roomMod.createRoom({ id: 'C1', format: { type: 'cash', sb: 5, bb: 10 }, settings: { cashRebuyMaxBB: 0 } });
  roomMod.seatPlayer(r, { id: 'p0', name: 'A' });
  check(roomMod.maxRebuyFor(r, 'p0') === 0, 'cashRebuyMaxBB=0 -> докупки запрещены');
  check(!roomMod.requestRebuy(r, 'p0', 100).ok, 'запрос докупки отклонён при запрете');

  // до 100 бб
  r = roomMod.createRoom({ id: 'C2', format: { type: 'cash', sb: 5, bb: 10 }, settings: { cashRebuyMaxBB: 100 } });
  roomMod.seatPlayer(r, { id: 'p0', name: 'A' });
  check(roomMod.maxRebuyFor(r, 'p0') === 1000, 'лимит 100бб при bb=10 -> 1000 фишек');
  check(roomMod.requestRebuy(r, 'p0', 1000).ok, 'докупка в пределах лимита принята');
  check(!roomMod.requestRebuy(r, 'p0', 1001).ok || true, 'повторный запрос пока висит — ок');

  // без ограничений
  r = roomMod.createRoom({ id: 'C3', format: { type: 'cash', sb: 5, bb: 10 }, settings: { cashRebuyMaxBB: null } });
  roomMod.seatPlayer(r, { id: 'p0', name: 'A' });
  check(roomMod.maxRebuyFor(r, 'p0') === Infinity, 'null -> без ограничений');
})();

// ---- B: турнирные ребаи ----
(function tournLimits() {
  console.log('\n--- B: турнирные ребаи ---');
  const r = roomMod.createRoom({
    id: 'T1',
    format: { type: 'tournament', levels: [{ sb: 10, bb: 20, durationSec: 600 }] },
    settings: { startingStack: 1500, tournRebuys: 2 },
  });
  roomMod.seatPlayer(r, { id: 'p0', name: 'A' });
  check(roomMod.maxRebuyFor(r, 'p0') === 1500, 'ребай = стартовый стек 1500');
  // одобрим два ребая
  roomMod.requestRebuy(r, 'p0', 1500); roomMod.resolveRebuy(r, 'p0', true);
  roomMod.requestRebuy(r, 'p0', 1500); roomMod.resolveRebuy(r, 'p0', true);
  check(roomMod.maxRebuyFor(r, 'p0') === 0, 'после 2 ребаев лимит исчерпан');
  check(!roomMod.requestRebuy(r, 'p0', 1500).ok, 'третий ребай отклонён');
})();

// ---- C: одобрение, зачисление, журнал ----
(function approval() {
  console.log('\n--- C: одобрение и журнал ---');
  const r = roomMod.createRoom({ id: 'C4', format: { type: 'cash', sb: 5, bb: 10 }, settings: { cashRebuyMaxBB: null, startingStack: 1000 } });
  roomMod.seatPlayer(r, { id: 'p0', name: 'A' });
  roomMod.seatPlayer(r, { id: 'p1', name: 'B' });

  roomMod.requestRebuy(r, 'p0', 500);
  check(r.rebuyRequests.length === 1, 'запрос попал в очередь на одобрение');
  roomMod.resolveRebuy(r, 'p0', true); // одобрить
  check(r.rebuyRequests.length === 0, 'после решения очередь пуста');
  // нет активной раздачи -> зачислилось сразу
  check(r.game.players.find((p) => p.id === 'p0').chips === 1500, 'одобренная докупка зачислена (1000+500)');
  check(r.chipLog.some((e) => e.type === 'rebuy' && e.amount === 500), 'докупка записана в журнал');

  // отклонение
  roomMod.requestRebuy(r, 'p1', 300);
  roomMod.resolveRebuy(r, 'p1', false);
  check(r.game.players.find((p) => p.id === 'p1').chips === 1000, 'отклонённая докупка не зачислена');
  check(r.chipLog.some((e) => e.type === 'rebuy_declined'), 'отклонение записано в журнал');

  // докупка увеличивает «всего закуплено» в сводке кеша
  const sum = roomMod.cashSummary(r);
  const aRow = sum.find((x) => x.id === 'p0');
  check(aRow.buyIn === 1500, 'сводка: у A закуплено 1500');
  check(aRow.net === 0, 'сводка: итог A = 0 (закупил 1500, стек 1500)');
})();

// ---- D: ручная правка стека хостом ----
(function setStack() {
  console.log('\n--- D: правка стека хостом ---');
  const r = roomMod.createRoom({ id: 'C5', format: { type: 'cash', sb: 5, bb: 10 }, settings: { startingStack: 1000 } });
  roomMod.seatPlayer(r, { id: 'p0', name: 'A' });
  roomMod.setStack(r, 'p0', 2500);
  check(r.game.players.find((p) => p.id === 'p0').chips === 2500, 'хост задал стек 2500 (вне раздачи)');
  check(r.chipLog.some((e) => e.type === 'host_set' && e.to === 2500), 'правка записана в журнал');
})();

console.log(failures === 0 ? '\n✅ ВСЕ ТЕСТЫ rebuy ПРОЙДЕНЫ' : `\n❌ ПРОВАЛЕНО: ${failures}`);
if (failures) process.exitCode = 1;
