// Тест UI-2: открытие карты видно другим, запрос итогов. Запуск: node test/ui2.js
const WebSocket = require('ws');
process.env.PORT = 8094;
require('../server');
const storage = require('../src/poker/storage');

const URL = 'ws://localhost:8094';
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open() {
  const ws = new WebSocket(URL);
  ws.box = { last: {} };
  ws.on('message', (raw) => { const m = JSON.parse(raw); ws.box.last[m.type] = m; if (m.type === 'joined') ws.pid = m.playerId; });
  return new Promise((res) => ws.on('open', () => res(ws)));
}
const send = (ws, o) => ws.send(JSON.stringify(o));
async function waitUntil(fn, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); }
  return false;
}

(async function run() {
  // --- A: открытие карты видно сопернику ---
  console.log('\n--- A: ручное открытие карты ---');
  const A = await open();
  send(A, { type: 'create', name: 'Алиса', format: { type: 'cash', sb: 5, bb: 10 }, settings: { startingStack: 1000 } });
  await waitUntil(() => A.pid);
  const roomId = A.box.last['joined'].roomId;
  const B = await open();
  send(B, { type: 'join', roomId, name: 'Борис' });
  await waitUntil(() => B.pid);
  send(A, { type: 'start' });
  await waitUntil(() => A.box.last['state'] && A.box.last['state'].view.stage === 'preflop');

  // до открытия: B не видит карт A
  const aSeatBeforeFromB = B.box.last['state'].view.seats.find((s) => s.id === A.pid);
  check(aSeatBeforeFromB.holeCards.every((c) => c === null), 'до открытия B не видит карт Алисы');

  // A открывает свою карту 0
  send(A, { type: 'reveal', cardIndex: 0 });
  const revealed = await waitUntil(() => {
    const aSeat = B.box.last['state'].view.seats.find((s) => s.id === A.pid);
    return aSeat && aSeat.holeCards[0] !== null;
  }, 3000);
  check(revealed, 'после открытия B видит первую карту Алисы');
  const aSeatAfter = B.box.last['state'].view.seats.find((s) => s.id === A.pid);
  check(aSeatAfter.holeCards[1] === null, 'вторая карта Алисы по-прежнему скрыта (открыли только одну)');

  // флаги раскрытия приходят владельцу
  const aSelf = A.box.last['state'].view.seats.find((s) => s.id === A.pid);
  check(aSelf.revealedFlags && aSelf.revealedFlags[0] === true, 'владелец видит флаг раскрытия своей карты');

  // --- B: запрос итогов ---
  console.log('\n--- B: итоги ---');
  send(A, { type: 'summary' });
  const gotSummary = await waitUntil(() => A.box.last['summary'], 2000);
  check(gotSummary, 'итоги получены');
  check(A.box.last['summary'].kind === 'cash' && Array.isArray(A.box.last['summary'].rows), 'итоги кеша — таблица строк');

  // --- C: экспорт ---
  send(A, { type: 'export' });
  const gotExport = await waitUntil(() => A.box.last['export'], 2000);
  check(gotExport && A.box.last['export'].data.roomId === roomId, 'экспорт лога сессии получен');

  storage.deleteRoomFiles(roomId);
  console.log(failures === 0 ? '\n✅ ВСЕ ТЕСТЫ UI-2 ПРОЙДЕНЫ' : `\n❌ ПРОВАЛЕНО: ${failures}`);
  process.exit(failures ? 1 : 0);
})();

setTimeout(() => { console.log('\n❌ таймаут'); process.exit(1); }, 15000);
