// Юнит-тесты для stats.js — без зависимостей от движка.
// Кормим модуль синтетическим объектом hand и проверяем накопление метрик.
//
// Запуск из корня проекта: node test/stats.js
// Модуль ищется и в src/poker (боевое размещение), и рядом (если положить тест туда же).

let stats;
try { stats = require('../src/poker/stats'); }
catch (e) { stats = require('./stats'); }

let failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`✗ ${label}: got ${a}, expected ${e}`); failed++; }
  else console.log(`✓ ${label}`);
}

// Синтетический hand: 3 игрока, btn=0 (Алиса), sb=Боб, bb=Кей.
function makeHand(btn = 0, n = 3, names = ['Алиса', 'Боб', 'Кей']) {
  return {
    buttonIndex: btn,
    seats: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: names[i], streetBet: 0, folded: false, allIn: false })),
  };
}

// --- Тест 1: VPIP/PFR/ATS, простой open-raise с BTN ---
{
  const s = stats.createStats();
  const hand = makeHand(0, 3);
  stats.onHandStart(s, hand);

  // Алиса (BTN) рейзит до 30. preStage=preflop, preCurrentBet=10 (BB).
  hand.seats[0].streetBet = 30;
  stats.onAction(s, hand, 'p0', { type: 'raise', amount: 30 }, 'preflop', 10);

  // Боб (SB) фолд — никакой статы кроме hand учтённой
  stats.onAction(s, hand, 'p1', { type: 'fold' }, 'preflop', 30);

  // Кей (BB) колл — VPIP
  hand.seats[2].streetBet = 30;
  stats.onAction(s, hand, 'p2', { type: 'call' }, 'preflop', 30);

  const ma = stats.metricsFor(s, 'p0');
  const mc = stats.metricsFor(s, 'p2');

  eq(ma.hands, 1, 'Алиса: 1 раздача');
  eq(ma.vpip, 100, 'Алиса VPIP=100% (открылась рейзом)');
  eq(ma.pfr, 100, 'Алиса PFR=100%');
  eq(ma.ats, 100, 'Алиса ATS=100% (BTN, open-raise, до неё никто не повышал)');
  eq(mc.vpip, 100, 'Кей VPIP=100% (колл рейза с BB)');
  eq(mc.pfr, 0, 'Кей PFR=0% (просто колл)');
  eq(mc.ats, null, 'Кей ATS=— (он в BB, не ATS-позиция)');
}

// --- Тест 2: 3-handed — BB исключается из ATS-позиции ---
{
  const s = stats.createStats();
  const hand = makeHand(0, 3);
  stats.onHandStart(s, hand);
  const transient = s.hand.transient;
  eq(transient.p0.isATSPos, true, '3-handed: BTN — ATS');
  eq(transient.p1.isATSPos, true, '3-handed: SB — ATS');
  eq(transient.p2.isATSPos, false, '3-handed: BB исключён из ATS');
}

// --- Тест 3: HU (2 игрока) — ATS только у BTN ---
{
  const s = stats.createStats();
  const hand = makeHand(0, 2, ['Алиса', 'Боб']);
  stats.onHandStart(s, hand);
  eq(s.hand.transient.p0.isATSPos, true, 'HU: BTN — ATS');
  eq(s.hand.transient.p1.isATSPos, false, 'HU: BB — не ATS');
}

// --- Тест 4: CB на флопе ---
{
  const s = stats.createStats();
  const hand = makeHand(0, 3);
  stats.onHandStart(s, hand);

  // префлоп: Алиса (BTN) рейзит, Боб колл, Кей колл — Алиса остаётся агрессором
  hand.seats[0].streetBet = 30;
  stats.onAction(s, hand, 'p0', { type: 'raise', amount: 30 }, 'preflop', 10);
  hand.seats[1].streetBet = 30;
  stats.onAction(s, hand, 'p1', { type: 'call' }, 'preflop', 30);
  hand.seats[2].streetBet = 30;
  stats.onAction(s, hand, 'p2', { type: 'call' }, 'preflop', 30);

  // открытие флопа — Алиса получает CB-opp
  hand.seats.forEach((s) => { s.streetBet = 0; });
  stats.onFlopOpened(s, hand);
  eq(stats.metricsFor(s, 'p0').cb, 0, 'до бета на флопе CB=0%');

  // Алиса делает CB
  hand.seats[0].streetBet = 60;
  stats.onAction(s, hand, 'p0', { type: 'raise', amount: 60 }, 'flop', 0);
  eq(stats.metricsFor(s, 'p0').cb, 100, 'CB=100% после бета на флопе');
}

// --- Тест 5: AF из raises/calls ---
{
  const s = stats.createStats();
  const hand = makeHand(0, 3);
  stats.onHandStart(s, hand);
  // 2 рейза и 1 колл от p0
  hand.seats[0].streetBet = 30;
  stats.onAction(s, hand, 'p0', { type: 'raise', amount: 30 }, 'preflop', 10);
  hand.seats[0].streetBet = 60;
  stats.onAction(s, hand, 'p0', { type: 'raise', amount: 60 }, 'flop', 0);
  stats.onAction(s, hand, 'p0', { type: 'call' }, 'turn', 100);
  eq(stats.metricsFor(s, 'p0').af, 2, 'AF = 2 raises / 1 call = 2.0');
}

// --- Тест 6: all-in считается как рейз если поднимает ставку ---
{
  const s = stats.createStats();
  const hand = makeHand(0, 3);
  stats.onHandStart(s, hand);
  hand.seats[0].streetBet = 200; // ушёл в all-in выше currentBet=10
  hand.seats[0].allIn = true;
  stats.onAction(s, hand, 'p0', { type: 'allin' }, 'preflop', 10);
  const m = stats.metricsFor(s, 'p0');
  eq(m.pfr, 100, 'all-in выше currentBet → PFR=100%');
  eq(m.vpip, 100, 'all-in → VPIP');
}

// --- Тест 7: all-in как колл (ниже currentBet) ---
{
  const s = stats.createStats();
  const hand = makeHand(0, 3);
  stats.onHandStart(s, hand);
  hand.seats[1].streetBet = 25; // меньше currentBet=30, значит это all-in-колл
  hand.seats[1].allIn = true;
  stats.onAction(s, hand, 'p1', { type: 'allin' }, 'preflop', 30);
  const m = stats.metricsFor(s, 'p1');
  eq(m.pfr, 0, 'all-in ниже currentBet → PFR=0% (это колл)');
  eq(m.vpip, 100, 'но VPIP=100%');
}

// --- Тест 8: 5-handed — CO определяется правильно ---
{
  const s = stats.createStats();
  // btn=2, n=5: BTN=2, SB=3, BB=4, UTG=0, CO=1
  const hand = makeHand(2, 5, ['A','B','C','D','E']);
  hand.seats.forEach((seat, i) => seat.id = 'p' + i);
  stats.onHandStart(s, hand);
  const t = s.hand.transient;
  eq(t.p2.isATSPos, true, '5-handed: BTN(idx2) — ATS');
  eq(t.p3.isATSPos, true, '5-handed: SB(idx3) — ATS');
  eq(t.p4.isATSPos, false, '5-handed: BB(idx4) — не ATS');
  eq(t.p0.isATSPos, false, '5-handed: UTG(idx0) — не ATS');
  eq(t.p1.isATSPos, true, '5-handed: CO(idx1) — ATS');
}

console.log(failed === 0 ? `\n✓ Все тесты прошли` : `\n✗ Провалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
