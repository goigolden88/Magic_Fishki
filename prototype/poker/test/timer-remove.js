// Тест таймера хода, удаления игрока и автозапуска. Запуск: node test/timer-remove.js
const WebSocket = require('ws');
process.env.PORT = 8093;
require('../server');
const storage = require('../src/poker/storage');

const URL = 'ws://localhost:8093';
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open() {
  const ws = new WebSocket(URL);
  ws.box = { last: {}, states: 0 };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    ws.box.last[m.type] = m;
    if (m.type === 'state') ws.box.states++;
    if (m.type === 'joined') ws.pid = m.playerId;
  });
  return new Promise((res) => ws.on('open', () => res(ws)));
}
const send = (ws, o) => ws.send(JSON.stringify(o));
async function waitUntil(fn, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); }
  return false;
}

(async function run() {
  // --- A: автозапуск + таймер хода ---
  console.log('\n--- A: автозапуск и таймер хода ---');
  const A = await open();
  send(A, { type: 'create', name: 'Алиса', format: { type: 'cash', sb: 5, bb: 10 }, settings: { startingStack: 1000, turnTimerSec: 1, dealSpeed: 'fast' } });
  await waitUntil(() => A.pid);
  const roomId = A.box.last['joined'].roomId;
  const B = await open();
  send(B, { type: 'join', roomId, name: 'Борис' });
  await waitUntil(() => B.pid);
  await sleep(300);

  // до ручного старта раздача НЕ должна начаться сама
  const startedEarly = A.box.last['state'] && A.box.last['state'].view.stage === 'preflop';
  check(!startedEarly, 'первая раздача не стартует автоматически (ждёт хоста)');

  // хост стартует вручную
  send(A, { type: 'start' });
  const started = await waitUntil(() => A.box.last['state'] && A.box.last['state'].view.stage === 'preflop', 4000);
  check(started, 'раздача началась после ручного старта хостом');

  const st = A.box.last['state'];
  check(st.turnDeadline && st.turnTimerSec === 1, 'сервер прислал дедлайн хода');

  // ждём, пока сервер сам сходит за зависшего игрока
  const turnBefore = A.box.last['state'].view.toAct;
  const acted = await waitUntil(() => {
    const v = A.box.last['state'].view;
    return v.toAct !== turnBefore || v.stage !== 'preflop';
  }, 5000);
  check(acted, 'по истечении таймера сервер сходил за игрока');

  // после первой (ручной) раздачи автозапуск должен сработать сам
  const autoAfter = await waitUntil(() => {
    const v = A.box.last['state'] && A.box.last['state'].view;
    return A.box.last['state'] && (A.box.last['state'].nextHandAt || (v && v.stage === 'preflop'));
  }, 9000);
  check(autoAfter, 'после первой раздачи следующая запускается автоматически');

  // --- B: удаление игрока ---
  console.log('\n--- B: удаление игрока ---');
  const C = await open();
  send(C, { type: 'join', roomId, name: 'Виктор' });
  await waitUntil(() => C.pid);
  await sleep(60);
  send(A, { type: 'removePlayer', playerId: C.pid });
  const removed = await waitUntil(() => {
    const v = A.box.last['state'].view;
    const list = v.players || v.seats || [];
    return !list.some((p) => p.id === C.pid);
  }, 3000);
  check(removed, 'удалённый игрок исчез со стола');

  // не-хост не может удалять (ждём именно ошибку у B)
  B.box.last['error'] = null;
  send(B, { type: 'removePlayer', playerId: A.pid });
  const gotErr = await waitUntil(() => B.box.last['error'] && /создател/i.test(B.box.last['error'].message), 2000);
  check(gotErr, 'гость не может удалять игроков');

  storage.deleteRoomFiles(roomId);
  console.log(failures === 0 ? '\n✅ ВСЕ ТЕСТЫ timer+remove+autostart ПРОЙДЕНЫ' : `\n❌ ПРОВАЛЕНО: ${failures}`);
  process.exit(failures ? 1 : 0);
})();

setTimeout(() => { console.log('\n❌ таймаут'); process.exit(1); }, 20000);
