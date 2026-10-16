// Сквозной тест 3a-ops. Запуск: node test/ops-int.js
const WebSocket = require('ws');
const fs = require('fs');
process.env.PORT = 8091;
require('../server');
const storage = require('../src/poker/storage');

const URL = 'ws://localhost:8091';
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open() {
  const ws = new WebSocket(URL);
  ws.box = { msgs: [], last: {} };
  ws.on('message', (raw) => { const m = JSON.parse(raw); ws.box.msgs.push(m); ws.box.last[m.type] = m; });
  return new Promise((res) => ws.on('open', () => res(ws)));
}
const send = (ws, o) => ws.send(JSON.stringify(o));
async function waitFor(ws, type, ms = 1500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (ws.box.last[type]) return ws.box.last[type]; await sleep(15); }
  return null;
}

(async function run() {
  // --- 1. Пауза блокирует действия ---
  const A = await open();
  send(A, { type: 'create', name: 'Алиса', format: { type: 'cash', sb: 5, bb: 10 }, settings: { startingStack: 1000 } });
  const joinedA = await waitFor(A, 'joined');
  const roomId = joinedA.roomId;
  const B = await open();
  send(B, { type: 'join', roomId, name: 'Борис' });
  await waitFor(B, 'joined');
  await sleep(50);

  send(A, { type: 'start' });
  await sleep(50);
  send(A, { type: 'pause' });
  await sleep(50);
  const stA = A.box.last['state'];
  check(stA && stA.view.room.paused === true, 'пауза отражена в состоянии');

  // чей ход — тот пробует сходить на паузе
  const view = A.box.last['state'].view;
  const mover = view.toAct;
  const moverWs = mover === A.box.last['joined']?.playerId ? A : B;
  A.box.last['error'] = null; B.box.last['error'] = null;
  send(moverWs, { type: 'action', action: { type: 'check' } });
  const e = (await waitFor(moverWs, 'error')) || {};
  check(/паузе/i.test(e.message || ''), 'действие на паузе отклонено');

  send(A, { type: 'resume' });
  await sleep(50);
  check(A.box.last['state'].view.room.paused === false, 'пауза снята');

  // --- 2. Доигрываем руку: журнал и снимок появляются на диске ---
  // пассивная автоигра до вскрытия
  for (let i = 0; i < 12; i++) {
    for (const ws of [A, B]) {
      const v = ws.box.last['state']?.view;
      const pid = ws.box.last['joined'].playerId;
      if (!v || !v.seats || v.toAct !== pid) continue;
      if (v.stage === 'complete' || v.stage === 'showdown') continue;
      const me = v.seats.find((s) => s.id === pid);
      const toCall = v.currentBet - (me?.streetBet || 0);
      send(ws, { type: 'action', action: toCall > 0 ? { type: 'call' } : { type: 'check' } });
      await sleep(40);
    }
    if (A.box.last['state']?.view.stage === 'complete') break;
  }
  await sleep(100);
  check(A.box.last['state']?.view.stage === 'complete', 'рука доиграна до конца');
  check(storage.readJournal(roomId).length >= 1, 'раздача записана в журнал на диске');
  check(storage.loadSnapshot(roomId) !== null, 'снимок состояния сохранён на диске');

  // экспорт
  send(A, { type: 'export' });
  const exp = await waitFor(A, 'export');
  check(exp && exp.data.hands.length >= 1 && Array.isArray(exp.data.summary), 'экспорт сессии работает');

  // --- 3. Лимит комнат (MAX_ROOMS = 10) ---
  // уже занята 1 комната; создаём ещё 9 (итого 10), 11-я должна отказать
  const extra = [];
  for (let i = 0; i < 9; i++) {
    const c = await open();
    send(c, { type: 'create', name: 'X' + i, format: { type: 'cash', sb: 5, bb: 10 } });
    await waitFor(c, 'joined');
    extra.push(c);
  }
  const over = await open();
  send(over, { type: 'create', name: 'Лишний', format: { type: 'cash', sb: 5, bb: 10 } });
  const limitErr = await waitFor(over, 'error');
  check(limitErr && /лимит/i.test(limitErr.message), '11-я комната отклонена по лимиту');

  // прибираемся
  storage.deleteRoomFiles(roomId);
  console.log(failures === 0 ? '\n✅ СКВОЗНОЙ ТЕСТ 3a-ops ПРОЙДЕН' : `\n❌ ПРОВАЛЕНО: ${failures}`);
  process.exit(failures ? 1 : 0);
})();

setTimeout(() => { console.log('\n❌ таймаут'); process.exit(1); }, 12000);
