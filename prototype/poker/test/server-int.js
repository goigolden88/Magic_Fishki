// Сквозной тест серверного пути без браузера: два клиента по WebSocket
// создают комнату, играют пассивную руку до вскрытия. Проверяем главное:
// каждый видит только свои карты, банк и фишки сходятся.
// Запуск: node test/server-int.js
const WebSocket = require('ws');
process.env.PORT = 8090;
require('../server'); // поднимает сервер на 8090

const URL = 'ws://localhost:8090';
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '✅' : '❌') + ' ' + msg); if (!cond) failures++; };

function mkClient(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, playerId: null, lastView: null, sawPrivacy: null };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'joined') c.playerId = m.playerId;
    if (m.type === 'error') { console.log(`  !! ${name}: ${m.message}`); failures++; }
    if (m.type === 'state') {
      c.lastView = m.view;
      c.isHost = m.isHost;
      // запоминаем самый первый префлоп-снимок (до автоигры) для проверки приватности
      if (!c.firstPreflop && m.view.stage === 'preflop' && m.view.seats.length === 2) {
        c.firstPreflop = JSON.parse(JSON.stringify(m.view));
      }
      maybeAct(c);
    }
  });
  return c;
}

// Бот: если мой ход — call (если есть что уравнивать) или check. Доводим до вскрытия.
function maybeAct(c) {
  const v = c.lastView;
  if (!v || !v.seats) return;
  if (v.stage === 'complete' || v.stage === 'showdown') { onComplete(); return; }
  if (v.toAct !== c.playerId) return;
  const me = v.seats.find((s) => s.id === c.playerId);
  if (!me) return;
  const toCall = v.currentBet - me.streetBet;
  const action = toCall > 0 ? { type: 'call' } : { type: 'check' };
  setTimeout(() => c.ws.send(JSON.stringify({ type: 'action', action })), 10);
}

const A = mkClient('A');
const B = mkClient('B');

let completed = false;
function onComplete() {
  if (completed) return;
  if (A.lastView?.stage !== 'complete' || B.lastView?.stage !== 'complete') return;
  completed = true;

  const va = A.lastView, vb = B.lastView;
  // банк роздан, фишки сходятся к 2000
  const sumA = va.seats.reduce((n, s) => n + s.chips, 0);
  check(sumA === 2000, `сумма фишек после раздачи = 2000 (получено ${sumA})`);
  check(va.result && va.result.winnerIds.length >= 1, 'есть победитель');
  // на вскрытии карты видны обоим
  const allShownToA = va.seats.every((s) => s.holeCards.every((card) => card !== null));
  check(allShownToA, 'на вскрытии A видит все карты');

  // приватность — по первому префлоп-снимку каждого клиента
  const fa = A.firstPreflop, fb = B.firstPreflop;
  const aSelf = fa.seats.find((s) => s.id === A.playerId);
  const aOther = fa.seats.find((s) => s.id !== A.playerId);
  check(aSelf.holeCards.every((c) => c !== null), 'на префлопе A видит свои карты');
  check(aOther.holeCards.every((c) => c === null), 'на префлопе A НЕ видит карты Бориса');
  const bSelf = fb.seats.find((s) => s.id === B.playerId);
  const bOther = fb.seats.find((s) => s.id !== B.playerId);
  check(bSelf.holeCards.every((c) => c !== null), 'на префлопе B видит свои карты');
  check(bOther.holeCards.every((c) => c === null), 'на префлопе B НЕ видит карты Алисы');

  console.log('\nКомбинации:', JSON.stringify(va.result.results));
  console.log(failures === 0 ? '\n✅ СКВОЗНОЙ ТЕСТ ПРОЙДЕН' : `\n❌ ПРОВАЛЕНО: ${failures}`);
  process.exit(failures ? 1 : 0);
}

// Сценарий
A.ws.on('open', () => {
  A.ws.send(JSON.stringify({
    type: 'create', name: 'Алиса', variantId: 'holdem',
    format: { type: 'cash', sb: 5, bb: 10, ante: 0 },
    settings: { startingStack: 1000 },
  }));
});

// как только A получил playerId — B заходит
const joinTimer = setInterval(() => {
  if (A.playerId && B.ws.readyState === WebSocket.OPEN) {
    clearInterval(joinTimer);
    B.ws.send(JSON.stringify({ type: 'join', roomId: A.lastView.room.id, name: 'Борис' }));
    // после захода B — стартуем раздачу и проверяем приватность карт первым состоянием
    setTimeout(() => {
      A.ws.send(JSON.stringify({ type: 'start' }));
    }, 100);
  }
}, 20);

setTimeout(() => { console.log('\n❌ таймаут'); process.exit(1); }, 8000);
