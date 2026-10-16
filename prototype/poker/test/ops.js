// Автотесты логики 3a-ops. Запуск: node test/ops.js
const { tournamentFormat } = require('../src/poker/format');
const session = require('../src/poker/session');
const storage = require('../src/poker/storage');
const roomMod = require('../src/poker/room');

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) failures++; };

// ---- A: пауза замораживает турнирные часы ----
(function pauseClock() {
  console.log('\n--- A: пауза турнирных часов ---');
  const f = tournamentFormat({
    levels: [
      { sb: 5, bb: 10, durationSec: 60 },
      { sb: 10, bb: 20, durationSec: 60 },
    ],
    startedAt: 0,
  });
  check(f.blinds(10000).level === 1, 'на 10-й секунде — уровень 1');
  f.pause(30000); // пауза на 30-й секунде
  check(f.blinds(100000).level === 1, 'во время паузы уровень заморожен (1)');
  f.resume(130000); // перерыв длился 100 секунд
  check(f.blinds(130000).level === 1, 'сразу после паузы — всё ещё уровень 1 (30с сыграно)');
  check(f.blinds(160000).level === 2, 'через 30с после паузы наступает уровень 2');
})();

// ---- B: итоговые таблицы ----
(function standings() {
  console.log('\n--- B: итоговые таблицы ---');
  // кеш
  const sc = session.createSession(1000);
  session.addPlayer(sc, { id: 'p0', name: 'Алиса' });
  session.addPlayer(sc, { id: 'p1', name: 'Борис' });
  const cashPlayers = [{ id: 'p0', chips: 1300 }, { id: 'p1', chips: 700 }];
  const cs = session.cashSummary(sc, cashPlayers);
  check(cs[0].id === 'p0' && cs[0].net === 300, 'кеш: Алиса +300 на первом месте');
  check(cs[1].id === 'p1' && cs[1].net === -300, 'кеш: Борис −300');

  // турнир
  const st = session.createSession(1000);
  ['p0', 'p1', 'p2'].forEach((id) => session.addPlayer(st, { id, name: id }));
  session.updateEliminations(st, [{ id: 'p0', chips: 1500 }, { id: 'p1', chips: 1500 }, { id: 'p2', chips: 0 }]);
  session.updateEliminations(st, [{ id: 'p0', chips: 3000 }, { id: 'p1', chips: 0 }, { id: 'p2', chips: 0 }]);
  const ts = session.tournamentStandings(st, [{ id: 'p0', chips: 3000 }, { id: 'p1', chips: 0 }, { id: 'p2', chips: 0 }]);
  check(ts[0].id === 'p0' && ts[0].place === 1, 'турнир: p0 — 1 место (выжил)');
  check(ts[1].id === 'p1' && ts[1].place === 2, 'турнир: p1 — 2 место (вылетел последним)');
  check(ts[2].id === 'p2' && ts[2].place === 3, 'турнир: p2 — 3 место (вылетел первым)');
})();

// ---- C: хранилище — снимок, журнал, очистка ----
(function storageTest() {
  console.log('\n--- C: хранилище ---');
  const id = 'TESTROOM';
  storage.deleteRoomFiles(id); // чистый старт

  const room = roomMod.createRoom({ id, format: { type: 'cash', sb: 5, bb: 10 } });
  roomMod.seatPlayer(room, { id: 'p0', name: 'Алиса' });
  roomMod.seatPlayer(room, { id: 'p1', name: 'Борис' });
  roomMod.startHand(room);

  // снимок и восстановление
  const snap = roomMod.serializeRoom(room);
  storage.saveSnapshot(id, snap);
  const loaded = roomMod.loadRoom(storage.loadSnapshot(id));
  check(loaded.id === id && loaded.game.players.length === 2, 'снимок сохранён и восстановлен');
  check(loaded.variant.id === 'holdem' && loaded.format.type === 'cash', 'вариант и формат восстановлены');
  check(!!loaded.game.hand && loaded.game.hand.board != null, 'состояние раздачи в снимке сохранено');

  // журнал
  storage.appendHand(id, { n: 1, pot: 30, winnerIds: ['p0'] });
  storage.appendHand(id, { n: 2, pot: 50, winnerIds: ['p1'] });
  const j = storage.readJournal(id);
  check(j.length === 2 && j[1].pot === 50, 'журнал: 2 раздачи прочитаны');

  // экспорт
  const exp = storage.exportSession(id, roomMod.cashSummary(room));
  check(exp.hands.length === 2 && Array.isArray(exp.summary), 'экспорт содержит историю и сводку');

  // автоочистка по возрасту
  const fs = require('fs');
  const oldFile = storage.snapPath(id);
  const fourDaysAgo = (Date.now() - 4 * 24 * 3600 * 1000) / 1000;
  fs.utimesSync(oldFile, fourDaysAgo, fourDaysAgo); // делаем снимок "старым"
  const removed = storage.cleanupOld(storage.THREE_DAYS_MS);
  check(removed >= 1 && storage.loadSnapshot(id) === null, 'файлы старше 3 дней удалены автоочисткой');

  storage.deleteRoomFiles(id); // прибираем за тестом
})();

console.log(failures === 0 ? '\n✅ ВСЕ ТЕСТЫ 3a-ops ПРОЙДЕНЫ' : `\n❌ ПРОВАЛЕНО: ${failures}`);
if (failures) process.exitCode = 1;
