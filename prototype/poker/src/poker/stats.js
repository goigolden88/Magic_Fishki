// Покерная HUD-статистика по игроку в пределах сессии стола.
// Считается инкрементально из действий движка. Источник правды — engine.
// VPIP — % раздач, где игрок добровольно вложил фишки преflop (call/raise/allin),
//        не считая постинга блайндов.
// PFR  — % раздач с рейзом преflop.
// ATS  — % раздач, где игрок в ATS-позиции (BTN/CO/SB, не BB)
//        получил возможность открыться рейзом, и реализовал её.
// CB   — % раздач, где игрок был префлоп-агрессором и дошёл до флопа,
//        и сделал бет/рейз на флопе.
// AF   — Aggression Factor: raises / calls (за всю сессию, все улицы).

function createStats() {
  return {
    perPlayer: {},   // id -> агрегаты
    hand: null,      // транзиентное состояние текущей раздачи
  };
}

function ensure(stats, id, name) {
  if (!stats.perPlayer[id]) {
    stats.perPlayer[id] = {
      name: name || id, hands: 0,
      vpip: 0, pfr: 0,
      atsOpp: 0, ats: 0,
      cbOpp: 0, cb: 0,
      raises: 0, calls: 0,
    };
  } else if (name) stats.perPlayer[id].name = name;
}

// Является ли seatIdx ATS-позицией (BTN/CO/SB, исключая BB).
// HU (2 игрока) — ATS = BTN (он же SB).
// 3+ игроков    — BTN, SB, CO; при этом BB исключаем (на малых столах CO может совпасть с BB).
function isATSPosition(seatIdx, btn, n) {
  if (n < 2) return false;
  if (n === 2) return seatIdx === btn;
  const sb = (btn + 1) % n;
  const bb = (btn + 2) % n;
  const co = (btn - 1 + n) % n;
  if (seatIdx === bb) return false;
  return seatIdx === btn || seatIdx === sb || seatIdx === co;
}

// Старт новой раздачи: инициализируем транзиентное состояние и инкрементим hands.
function onHandStart(stats, hand) {
  const seats = hand.seats; const btn = hand.buttonIndex; const n = seats.length;
  const transient = {};
  seats.forEach((s, i) => {
    ensure(stats, s.id, s.name);
    transient[s.id] = {
      seatIdx: i,
      isATSPos: isATSPosition(i, btn, n),
      didVPIP: false, didPFR: false,
      hadATSOpp: false, didATS: false,
      gotCBOpp: false, didCB: false,
    };
    stats.perPlayer[s.id].hands += 1;
  });
  stats.hand = {
    preRaiserId: null,
    seenPreflopRaise: false,
    transient,
  };
}

// Действие игрока. Вызывается ПОСЛЕ применения движком, но с pre-состоянием
// (preStage, preCurrentBet) — иначе мы не отличим all-in-колл от all-in-рейза.
function onAction(stats, hand, playerId, action, preStage, preCurrentBet) {
  const h = stats.hand; if (!h) return;
  const t = h.transient[playerId]; if (!t) return;
  const agg = stats.perPlayer[playerId]; if (!agg) return;
  if (action.type === 'fold' || action.type === 'check' || action.type === 'reveal') return;

  const seat = hand.seats.find((s) => s.id === playerId);
  const isAllInRaise = action.type === 'allin' && seat && seat.streetBet > preCurrentBet;
  const isRaise = action.type === 'raise' || isAllInRaise;
  const isCall = action.type === 'call' || (action.type === 'allin' && !isAllInRaise);

  // AF: универсально по всем улицам
  if (isRaise) agg.raises += 1;
  if (isCall) agg.calls += 1;

  if (preStage === 'preflop') {
    // VPIP: любой вклад фишек (call/raise/allin) сверх постинга блайнда
    if (!t.didVPIP) { t.didVPIP = true; agg.vpip += 1; }
    // PFR: только рейз
    if (isRaise && !t.didPFR) { t.didPFR = true; agg.pfr += 1; }
    // ATS: позиция + до меня не было рейза + я открываюсь рейзом
    if (t.isATSPos && !h.seenPreflopRaise && !t.hadATSOpp) {
      t.hadATSOpp = true; agg.atsOpp += 1;
      if (isRaise) { t.didATS = true; agg.ats += 1; }
    }
    if (isRaise) { h.preRaiserId = playerId; h.seenPreflopRaise = true; }
  } else if (preStage === 'flop') {
    // CB: первое агрессивное действие префлоп-агрессора на флопе
    if (h.preRaiserId === playerId && t.gotCBOpp && !t.didCB && isRaise) {
      t.didCB = true; agg.cb += 1;
    }
  }
}

// Открытие флопа: префлоп-агрессор, оставшийся в игре, получает CB-возможность.
function onFlopOpened(stats, hand) {
  const h = stats.hand; if (!h) return;
  const aggId = h.preRaiserId;
  if (!aggId) return;
  const seat = hand.seats.find((s) => s.id === aggId);
  if (!seat || seat.folded || seat.allIn) return; // если уже всё-аллин — действовать он не сможет
  const t = h.transient[aggId]; if (!t || t.gotCBOpp) return;
  t.gotCBOpp = true;
  stats.perPlayer[aggId].cbOpp += 1;
}

// Метрики игрока, готовые к отображению (проценты округлены до целых).
function metricsFor(stats, playerId) {
  const a = stats.perPlayer[playerId]; if (!a) return null;
  const pct = (num, den) => den > 0 ? Math.round(num / den * 100) : null;
  // AF = raises / calls. При нуле коллов: если были агрессивные действия — бесконечная
  // агрессия (как в покер-трекерах), иначе данных нет.
  let af;
  if (a.calls > 0) af = Math.round((a.raises / a.calls) * 10) / 10;
  else if (a.raises > 0) af = Infinity;
  else af = null;
  // Infinity не переживает JSON — отдаём строкой-сентинелом
  const afSafe = af === Infinity ? 'inf' : af;
  return {
    name: a.name,
    hands: a.hands,
    vpip: pct(a.vpip, a.hands),
    pfr: pct(a.pfr, a.hands),
    ats: pct(a.ats, a.atsOpp),
    cb: pct(a.cb, a.cbOpp),
    af: afSafe,
  };
}

function allMetrics(stats) {
  const out = {};
  for (const id of Object.keys(stats.perPlayer)) out[id] = metricsFor(stats, id);
  return out;
}

module.exports = { createStats, onHandStart, onAction, onFlopOpened, metricsFor, allMetrics, isATSPosition };
