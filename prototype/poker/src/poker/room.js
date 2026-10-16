// Слой "комната": связывает вариант (движок), формат (блайнды), настройки стола
// и реестр сессии. Добавлено: пауза (хостом), запись завершённых раздач в сессию,
// итоговые таблицы, сериализация для снимка на диск.
const engine = require('./engine');
const session = require('./session');
const stats = require('./stats');
const { getVariant } = require('./variants');
const { createFormat } = require('./format');

const DEFAULT_SETTINGS = {
  startingStack: 1000,
  dealSpeed: 'medium',   // 'fast' | 'medium' | 'slow' — анимации (Фаза 5)
  runItTwice: false,     // разрешить прогон борда несколько раз при ал-ине
  maxRuns: 3,            // до скольких раз можно прогнать (2 или 3)
  turnTimerSec: 0,       // 0 = без ограничения; иначе секунды на ход
  // докупки: кеш — лимит за раз в bb (0 = запрет, null = без лимита); турнир — число ребаев на стек
  cashRebuyMaxBB: null,  // null = без ограничений, 0 = без ребая, иначе максимум bb за докупку
  tournRebuys: 0,        // сколько докупок (по стартовому стеку) разрешено на игрока в турнире
  publicHud: false,      // показывать HUD-статистику всех игроков всем (иначе — только свою)
  maxSeats: 9,           // число мест за столом (6 или 9)
  feltTheme: 'green',    // тема сукна: green | blue | red | charcoal
  cardBack: 'classic',   // рубашка карт: classic | blue | green | geo
};

function createRoom({ id, variantId = 'holdem', format, settings = {} }) {
  const variant = getVariant(variantId);
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return {
    id,
    variant,
    game: engine.createGame(variant),
    format: createFormat(format || { type: 'cash', sb: 5, bb: 10, ante: 0 }),
    settings: s,
    session: session.createSession(s.startingStack),
    paused: false,
    pausedBy: null,
    chipLog: [],          // журнал движения фишек (виден всем)
    pendingRebuys: {},    // id -> сумма, ожидающая применения к следующей раздаче
    rebuyRequests: [],    // [{ id, name, amount }] — запросы на одобрение хостом
    rebuyCounts: {},      // id -> сколько докупок уже сделано (для лимита турнира)
    stats: stats.createStats(),  // HUD-статистика сессии
  };
}

function seatPlayer(room, { id, name }) {
  if (room.game.players.find((p) => p.id === id)) return { ok: true };
  const seat = firstFreeSeat(room);
  if (seat == null) return { ok: false, error: 'Стол заполнен' };
  engine.addPlayer(room.game, { id, name, chips: room.settings.startingStack, seat });
  session.addPlayer(room.session, { id, name });
  return { ok: true };
}

// Наименьший свободный номер места в пределах maxSeats (или null, если мест нет).
function firstFreeSeat(room) {
  const max = room.settings.maxSeats || 9;
  const taken = new Set(room.game.players.map((p) => p.seat));
  for (let i = 0; i < max; i++) if (!taken.has(i)) return i;
  return null;
}

// Пересадка игрока на свободное место (между раздачами или вне своей раздачи).
function reseat(room, playerId, targetSeat) {
  return engine.reseat(room.game, playerId, targetSeat, room.settings.maxSeats || 9);
}

function startHand(room, now = Date.now()) {
  applyPendingRebuys(room); // долить одобренные докупки перед раздачей
  room.format.startClock(now); // запустить часы уровней при первой раздаче (no-op в кеше и при повторных)
  const b = room.format.blinds(now);
  const hand = engine.startHand(room.game, { sb: b.sb, bb: b.bb, ante: b.ante });
  stats.onHandStart(room.stats, hand);
  return hand;
}

// ---- докупки и ручные правки стека ----

// Максимально допустимая докупка для игрока (в фишках) или 0, если нельзя.
function maxRebuyFor(room, playerId) {
  const st = room.settings;
  if (room.format.type === 'tournament') {
    const used = room.rebuyCounts[playerId] || 0;
    if (used >= (st.tournRebuys || 0)) return 0;
    return st.startingStack; // один ребай = стартовый стек
  }
  // кеш
  if (st.cashRebuyMaxBB === 0) return 0;            // без ребая
  if (st.cashRebuyMaxBB == null) return Infinity;   // без ограничений
  const bb = room.format.blinds().bb;
  return st.cashRebuyMaxBB * bb;
}

// Игрок запросил докупку — кладём в очередь на одобрение хостом.
function requestRebuy(room, playerId, amount) {
  const p = room.game.players.find((pp) => pp.id === playerId);
  if (!p) return { ok: false, error: 'Игрок не найден' };
  const max = maxRebuyFor(room, playerId);
  if (max === 0) return { ok: false, error: 'Докупки запрещены настройками' };
  if (amount <= 0) return { ok: false, error: 'Некорректная сумма' };
  if (amount > max) return { ok: false, error: `Максимум для докупки: ${max}` };
  if (room.rebuyRequests.find((r) => r.id === playerId)) return { ok: false, error: 'Запрос уже отправлен' };
  room.rebuyRequests.push({ id: playerId, name: p.name, amount });
  return { ok: true };
}

// Хост одобрил/отклонил запрос.
function resolveRebuy(room, playerId, approve) {
  const idx = room.rebuyRequests.findIndex((r) => r.id === playerId);
  if (idx === -1) return { ok: false, error: 'Запрос не найден' };
  const req = room.rebuyRequests.splice(idx, 1)[0];
  if (!approve) {
    logChip(room, { type: 'rebuy_declined', playerId, name: req.name, amount: req.amount, by: 'host' });
    return { ok: true };
  }
  room.pendingRebuys[playerId] = (room.pendingRebuys[playerId] || 0) + req.amount;
  room.rebuyCounts[playerId] = (room.rebuyCounts[playerId] || 0) + 1;
  session.recordBuyIn(room.session, playerId, req.amount); // растёт «всего закуплено»
  logChip(room, { type: 'rebuy', playerId, name: req.name, amount: req.amount, by: 'host_approved' });
  // если раздачи нет — доливаем сразу; иначе применится перед следующей
  if (!room.game.hand || room.game.hand.stage === 'complete' || room.game.hand.stage === 'idle') applyPendingRebuys(room);
  return { ok: true };
}

// Долить все одобренные докупки в стеки (между раздачами).
function applyPendingRebuys(room) {
  for (const [id, amt] of Object.entries(room.pendingRebuys)) {
    const p = room.game.players.find((pp) => pp.id === id);
    if (p) p.chips += amt;
  }
  room.pendingRebuys = {};
}

// Ручная правка стека хостом: задаёт новое значение (применяется к след. раздаче,
// если идёт рука — кладём в очередь как дельту).
function setStack(room, playerId, newValue, byName) {
  const p = room.game.players.find((pp) => pp.id === playerId);
  if (!p) return { ok: false, error: 'Игрок не найден' };
  if (newValue < 0) return { ok: false, error: 'Стек не может быть отрицательным' };
  const handActive = room.game.hand && !['complete', 'idle'].includes(room.game.hand.stage);
  const oldValue = p.chips + (handActive ? 0 : 0);
  if (handActive) {
    // не трогаем стек в текущей руке — фиксируем целевое значение через очередь дельты
    const target = newValue;
    const cur = p.chips;
    room.pendingRebuys[playerId] = (room.pendingRebuys[playerId] || 0) + (target - cur);
    logChip(room, { type: 'host_set', playerId, name: p.name, from: cur, to: target, by: 'host', deferred: true });
  } else {
    logChip(room, { type: 'host_set', playerId, name: p.name, from: p.chips, to: newValue, by: 'host' });
    p.chips = newValue;
  }
  return { ok: true };
}

function logChip(room, entry) {
  room.chipLog.push({ ...entry, ts: Date.now() });
  if (room.chipLog.length > 500) room.chipLog.shift(); // не растём бесконечно
}

function applyAction(room, playerId, action) {
  // снимаем pre-состояние для статистики (важно до того, как движок изменит hand)
  const hand = room.game.hand;
  const preStage = hand ? hand.stage : null;
  const preCurrentBet = hand ? hand.currentBet : 0;

  const r = engine.applyAction(room.game, playerId, action);
  if (r.ok && preStage && action.type !== 'reveal') {
    stats.onAction(room.stats, room.game.hand, playerId, action, preStage, preCurrentBet);
    // переход префлоп → флоп: префлоп-агрессор получает CB-возможность
    if (preStage === 'preflop' && room.game.hand && room.game.hand.stage === 'flop') {
      stats.onFlopOpened(room.stats, room.game.hand);
    }
  }
  return recordIfComplete(room, r);
}

// Досдать борд N раз (по согласию) и зафиксировать раздачу.
function runOut(room, times) {
  const r = engine.runOut(room.game, times);
  return recordIfComplete(room, r);
}

// Пропуск хода текущего игрока (хостом).
function forceCurrent(room) {
  const r = engine.forceCurrent(room.game);
  return recordIfComplete(room, r);
}

// Перевод игрока в сит-аут / возврат в игру.
function setSitOut(room, playerId, value) {
  const p = room.game.players.find((pp) => pp.id === playerId);
  if (p) p.sittingOut = !!value;
}

// Полное удаление игрока со стола (хостом). Если он в текущей раздаче и ещё не
// сбросил карты — сначала складываем его руку, чтобы стол не завис, затем убираем.
// Возвращает результат форс-действия (если оно потребовалось) для записи раздачи.
function removePlayer(room, playerId) {
  const hand = room.game.hand;
  let forced = null;
  if (hand && hand.stage !== 'complete' && hand.stage !== 'idle') {
    const seat = hand.seats.find((s) => s.id === playerId);
    if (seat && !seat.folded) {
      if (hand.seats[hand.toAct] && hand.seats[hand.toAct].id === playerId) {
        forced = engine.forceCurrent(room.game); // его ход — корректно пропускаем
        forced = recordIfComplete(room, forced);
      } else {
        seat.folded = true; // не его ход — просто складываем карты
      }
    }
  }
  room.game.players = room.game.players.filter((p) => p.id !== playerId);
  return forced;
}

// Если раздача завершилась — один раз пишем её в реестр сессии.
function recordIfComplete(room, r) {
  const hand = room.game.hand;
  if (r.ok && hand && hand.stage === 'complete' && !hand._recorded) {
    hand._recorded = true;
    const rec = buildHandRecord(room);
    session.recordHand(room.session, rec);
    session.updateEliminations(room.session, room.game.players);
    r.handRecord = rec;
  }
  return r;
}

// Сгруппировать лог действий по улицам для компактной истории.
function groupActionsByStreet(log) {
  const order = ['preflop', 'flop', 'turn', 'river'];
  const byStreet = {};
  for (const a of log) {
    (byStreet[a.street] = byStreet[a.street] || []).push({ name: a.name, type: a.type, to: a.to, allIn: a.allIn });
  }
  return order.filter((s) => byStreet[s]).map((s) => ({ street: s, acts: byStreet[s] }));
}

function buildHandRecord(room) {
  const h = room.game.hand;
  const res = h.result;
  // в мульти-прогоне плоского results нет — берём из первого прогона
  const flatResults = res.results || (res.runs && res.runs[0] && res.runs[0].results) || {};
  return {
    board: h.board.slice(),
    pot: res.pot,
    blinds: h.blinds,
    winnerIds: res.winnerIds,
    results: flatResults,
    payouts: res.payouts,
    premium: res.premium,
    runsCount: res.runsCount || 1,
    runs: res.runs ? res.runs.map((r) => ({ board: r.board })) : undefined,
    pots: res.pots,
    actionLog: (h.actionLog || []).slice(),
    seats: h.seats.map((s) => ({
      id: s.id,
      name: s.name,
      folded: s.folded,
      cards: !s.folded ? s.holeCards.slice() : (s.revealed.some(Boolean) ? s.holeCards.slice() : null),
      committed: s.committed,
    })),
    ts: Date.now(),
  };
}

function pause(room, byPlayerId, now = Date.now()) {
  room.paused = true;
  room.pausedBy = byPlayerId;
  room.format.pause(now);
}

function resume(room, now = Date.now()) {
  room.paused = false;
  room.pausedBy = null;
  room.format.resume(now);
}

function cashSummary(room) {
  return session.cashSummary(room.session, room.game.players);
}
function tournamentStandings(room) {
  return session.tournamentStandings(room.session, room.game.players);
}

// Персонализированный вид + метаданные комнаты.
function viewFor(room, playerId) {
  const v = engine.viewFor(room.game, playerId);
  const b = room.format.blinds();
  // HUD: если публичный — раздаём всем все метрики; иначе игрок видит только свою.
  let hud;
  if (room.settings.publicHud) {
    hud = stats.allMetrics(room.stats);
  } else {
    const mine = stats.metricsFor(room.stats, playerId);
    hud = mine ? { [playerId]: mine } : {};
  }
  return {
    ...v,
    room: {
      id: room.id,
      variant: room.variant.name,
      format: room.format.type,
      settings: room.settings,
      level: b.level,
      msToNextLevel: b.msToNext,
      clockRunning: room.format.type === 'tournament' && room.format.startedAt != null,
      blinds: { sb: b.sb, bb: b.bb, ante: b.ante },
      paused: room.paused,
      pausedBy: room.pausedBy,
      chipLog: room.chipLog.slice(-50),       // последние записи журнала фишек (всем)
      rebuyRequests: room.rebuyRequests.slice(), // ожидающие одобрения (для хоста)
      myRebuyMax: (() => { const m = maxRebuyFor(room, playerId); return m === Infinity ? -1 : m; })(), // -1 = без ограничений (Infinity не переживает JSON)
      pendingRebuyMine: room.pendingRebuys[playerId] || 0,
      publicHud: !!room.settings.publicHud,
      hud,
      recentHands: (room.session.hands || []).slice(-5).reverse().map((h) => ({
        n: h.n,
        board: h.board || [],
        pot: h.pot,
        ts: h.ts,
        premium: !!h.premium,
        winners: (h.winnerIds || []).map((id) => ({
          name: room.session.names[id] || id,
          amount: (h.payouts || {})[id] || 0,
          combo: (h.results || {})[id] && h.results[id].descr,
          comboCards: (h.results || {})[id] && (h.results[id].cards || h.results[id].comboCards) || null,
        })),
        shown: (h.seats || []).filter((s) => s.cards).map((s) => ({ name: s.name, cards: s.cards, folded: s.folded })),
        actions: groupActionsByStreet(h.actionLog || []),
      })),
    },
  };
}

// ---- сериализация для снимка на диск ----
function serializeRoom(room) {
  return {
    id: room.id,
    variantId: room.variant.id,
    format: room.format.serialize(),
    settings: room.settings,
    paused: room.paused,
    pausedBy: room.pausedBy,
    game: {
      players: room.game.players,
      buttonPlayerId: room.game.buttonPlayerId,
      hand: room.game.hand,
    },
    session: room.session,
    chipLog: room.chipLog,
    pendingRebuys: room.pendingRebuys,
    rebuyRequests: room.rebuyRequests,
    rebuyCounts: room.rebuyCounts,
    stats: room.stats,
  };
}

function loadRoom(snap) {
  const variant = getVariant(snap.variantId);
  const players = snap.game.players || [];
  // старые снимки могли быть без номеров мест — назначим по порядку
  players.forEach((p, i) => { if (p.seat == null) p.seat = i; });
  return {
    id: snap.id,
    variant,
    game: {
      variant,
      players,
      buttonPlayerId: snap.game.buttonPlayerId,
      hand: snap.game.hand,
    },
    format: createFormat(snap.format),
    settings: snap.settings,
    session: snap.session,
    paused: snap.paused,
    pausedBy: snap.pausedBy,
    chipLog: snap.chipLog || [],
    pendingRebuys: snap.pendingRebuys || {},
    rebuyRequests: snap.rebuyRequests || [],
    rebuyCounts: snap.rebuyCounts || {},
    stats: snap.stats || stats.createStats(),
  };
}

module.exports = {
  createRoom, seatPlayer, startHand, applyAction, runOut, forceCurrent, setSitOut, removePlayer, viewFor,
  pause, resume, cashSummary, tournamentStandings,
  requestRebuy, resolveRebuy, setStack, maxRebuyFor,
  reseat, firstFreeSeat,
  serializeRoom, loadRoom, DEFAULT_SETTINGS,
};
