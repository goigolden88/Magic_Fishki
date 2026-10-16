// Тесты run it twice/three. Запуск: node test/runittwice.js
const engine = require('../src/poker/engine');
const holdem = require('../src/poker/variants/holdem');
const WebSocket = require('ws');

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) failures++; };
const setEq = (a, b) => a.length === b.length && new Set([...a, ...b]).size === a.length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- A: движок, два прогона, банк делится между разными победителями ----
(function engineRunTwice() {
  console.log('\n--- A: два прогона борда ---');
  const deck = [
    'As', 'Ks', 'Ah', 'Kd',
    'Tc', 'Ad', '7c', '2s', '3c', '9h', '4c', 'Jd',
    '5c', 'Kc', '8c', '3s', '6c', '4h', '7s', '5d',
  ];
  const g = engine.createGame(holdem);
  engine.addPlayer(g, { id: 'p0', name: 'A', chips: 1000 });
  engine.addPlayer(g, { id: 'p1', name: 'B', chips: 1000 });

  engine.startHand(g, { sb: 5, bb: 10, deckOverride: deck });
  engine.applyAction(g, 'p0', { type: 'allin' });
  const r = engine.applyAction(g, 'p1', { type: 'allin' });
  check(r.state === 'runout', 'оба ал-ин -> точка досдачи');

  const out = engine.runOut(g, 2);
  const res = out.result;
  check(res.runsCount === 2, 'два прогона зафиксированы');
  check(res.runs.length === 2 && res.runs[0].board.length === 5 && res.runs[1].board.length === 5, 'у каждого прогона полный борд');
  check(res.pots.length === 1, 'один банк');
  const runs = res.pots[0].runs;
  check(setEq(runs[0].winners, ['p0']) && runs[0].amount === 1000, 'прогон 1: p0 берёт 1000');
  check(setEq(runs[1].winners, ['p1']) && runs[1].amount === 1000, 'прогон 2: p1 берёт 1000');
  const c = (id) => g.players.find((p) => p.id === id).chips;
  check(c('p0') === 1000 && c('p1') === 1000, `банк поделён прогонами: A=${c('p0')} B=${c('p1')}`);
  check(c('p0') + c('p1') === 2000, 'сумма фишек сохранилась');
})();

// ---- B: сквозь сервер — согласие на 2 прогона (событийная модель) ----
(async function serverConsent() {
  console.log('\n--- B: согласие на прогоны через сервер ---');
  process.env.PORT = 8092;
  require('../server');
  const URL = 'ws://localhost:8092';

  function open() {
    const ws = new WebSocket(URL);
    ws.box = { last: {} };
    ws.autoAllin = false;
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      ws.box.last[m.type] = m;
      if (m.type === 'joined') ws.pid = m.playerId;
      // реактивно идём ва-банк, как только наступает наш ход
      if (m.type === 'state' && ws.autoAllin && ws.pid) {
        const v = m.view;
        const me = v.seats && v.seats.find((s) => s.id === ws.pid);
        const active = v.stage !== 'complete' && v.stage !== 'showdown' && !m.runout;
        if (active && v.toAct === ws.pid && me && me.chips > 0) {
          ws.send(JSON.stringify({ type: 'action', action: { type: 'allin' } }));
        }
      }
    });
    return new Promise((res) => ws.on('open', () => res(ws)));
  }
  const send = (ws, o) => ws.send(JSON.stringify(o));
  async function waitUntil(fn, ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(20); }
    return false;
  }

  const A = await open();
  send(A, { type: 'create', name: 'Алиса', format: { type: 'cash', sb: 5, bb: 10 }, settings: { startingStack: 1000, runItTwice: true } });
  await waitUntil(() => A.pid);
  const roomId = A.box.last['joined'].roomId;
  const B = await open();
  send(B, { type: 'join', roomId, name: 'Борис' });
  await waitUntil(() => B.pid);

  // включаем авто-ва-банк и стартуем
  A.autoAllin = true; B.autoAllin = true;
  send(A, { type: 'start' });

  // ждём, пока сервер запросит согласие на прогоны
  const gotRunout = await waitUntil(() => A.box.last['state'] && A.box.last['state'].runout && A.box.last['state'].runout.contenders.length === 2);
  check(gotRunout, 'сервер запросил согласие на прогоны');

  // оба голосуют за 2 прогона
  send(A, { type: 'ritVote', times: 2 });
  send(B, { type: 'ritVote', times: 2 });

  const done = await waitUntil(() => A.box.last['state'] && A.box.last['state'].view.stage === 'complete');
  check(done, 'раздача завершена после прогонов');
  const finalA = A.box.last['state'].view;
  check(finalA.result && finalA.result.runsCount === 2, 'результат содержит 2 прогона');
  const sum = finalA.seats.reduce((n, s) => n + s.chips, 0);
  check(sum === 2000, `фишки сохранились (${sum})`);

  require('../src/poker/storage').deleteRoomFiles(roomId);
  console.log(failures === 0 ? '\n✅ ВСЕ ТЕСТЫ 3c ПРОЙДЕНЫ' : `\n❌ ПРОВАЛЕНО: ${failures}`);
  process.exit(failures ? 1 : 0);
})();

setTimeout(() => { console.log('\n❌ таймаут'); process.exit(1); }, 12000);
