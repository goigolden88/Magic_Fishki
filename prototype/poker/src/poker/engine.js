// Движок одной раздачи. Не знает правил конкретного варианта — берёт их
// из game.variant. Не знает про блайнды как формат — получает sb/bb/ante на вход
// (их даёт модуль "формат": кеш или турнир).
//
// Фаза 3a: ОДИН общий банк (без боковых), один прогон борда.
//   Боковые банки   -> Фаза 3b
//   Run it twice/3x -> Фаза 3c
const { shuffle } = require('./cards');
const { buildPots } = require('./pots');

// Комбинации "каре и выше" — для спец-анимации (данные едут в результат).
const PREMIUM = new Set(['Four of a Kind', 'Straight Flush', 'Royal Flush']);

const STAGES = ['preflop', 'flop', 'turn', 'river'];

// ---------- создание игры и игроки ----------

function createGame(variant) {
  return {
    variant,
    players: [],        // { id, name, chips } — постоянные за столом
    buttonPlayerId: null,
    hand: null,         // текущая раздача или null
  };
}

function addPlayer(game, { id, name, chips, seat = null }) {
  game.players.push({ id, name, chips, seat });
}

// ---------- вспомогательное ----------

function canAct(s) {
  return !s.folded && !s.allIn && s.chips > 0;
}

function nextIndex(hand, i) {
  return (i + 1) % hand.seats.length;
}

// Двигаем указатель хода до ближайшего, кто может действовать.
function skipToActable(hand) {
  let count = 0;
  while (count < hand.seats.length && !canAct(hand.seats[hand.toAct])) {
    hand.toAct = nextIndex(hand, hand.toAct);
    count++;
  }
}

// Положить фишки в банк. countAsStreetBet=true для ставок (учитываются при
// уравнивании), false для анте (мёртвые деньги).
function postChips(hand, seat, amount, countAsStreetBet) {
  const pay = Math.min(amount, seat.chips);
  seat.chips -= pay;
  seat.committed += pay;
  hand.pot += pay;
  if (countAsStreetBet) seat.streetBet += pay;
  if (seat.chips === 0) seat.allIn = true;
  return pay;
}

// ---------- старт раздачи ----------

function startHand(game, { sb, bb, ante = 0, deckOverride = null }) {
  const playing = game.players.filter((p) => p.chips > 0 && !p.sittingOut);
  if (playing.length < 2) throw new Error('Нужно минимум 2 активных игрока с фишками');
  // порядок за столом — по номеру места (а не по порядку входа); fallback на индекс
  playing.forEach((p, i) => { if (p.seat == null) p.seat = i; });
  playing.sort((a, b) => a.seat - b.seat);

  // Кнопка дилера: следующий играющий после прошлой кнопки (устойчиво к вылетам).
  let btn;
  if (game.buttonPlayerId == null) {
    btn = 0;
  } else {
    const prev = playing.findIndex((p) => p.id === game.buttonPlayerId);
    btn = prev === -1 ? 0 : (prev + 1) % playing.length;
  }
  game.buttonPlayerId = playing[btn].id;

  const deck = deckOverride ? deckOverride.slice() : shuffle(game.variant.buildDeck());

  const seats = playing.map((p) => ({
    id: p.id,
    name: p.name,
    chips: p.chips,
    holeCards: [],
    revealed: [],
    folded: false,
    allIn: false,
    streetBet: 0,   // вложено на текущей улице (для уравнивания)
    committed: 0,   // вложено за всю раздачу (для банка/боковых)
    hasActed: false,
  }));

  const hand = {
    stage: 'preflop',
    deck,
    board: [],
    pot: 0,
    seats,
    buttonIndex: btn,
    currentBet: 0,
    minRaise: bb,
    blinds: { sb, bb, ante },
    toAct: 0,
    result: null,
    actionLog: [], // [{street, id, name, type, to}] — для истории раздач
  };
  game.hand = hand;

  const n = seats.length;
  const heads = n === 2;

  // Анте со всех (мёртвые деньги).
  if (ante > 0) {
    for (const s of seats) postChips(hand, s, ante, false);
  }

  // Блайнды. Хедз-ап: кнопка ставит малый, оппонент — большой.
  const sbIndex = heads ? btn : (btn + 1) % n;
  const bbIndex = heads ? (btn + 1) % n : (btn + 2) % n;
  postChips(hand, seats[sbIndex], sb, true);
  postChips(hand, seats[bbIndex], bb, true);
  hand.currentBet = bb;
  hand.minRaise = bb;

  // Раздача личных карт по кругу.
  for (let r = 0; r < game.variant.holeCards; r++) {
    for (const s of seats) s.holeCards.push(hand.deck.shift());
  }
  for (const s of seats) s.revealed = s.holeCards.map(() => false);

  // Первый ход префлоп: хедз-ап — кнопка; иначе — слева от большого блайнда.
  hand.toAct = heads ? btn : (bbIndex + 1) % n;
  skipToActable(hand);

  return hand;
}

// ---------- действия игрока ----------

// Принудительный ход за текущего игрока (хостом): чек если можно, иначе фолд.
// Используется при пропуске зависшего/отсутствующего игрока.
function forceCurrent(game) {
  const hand = game.hand;
  if (!hand || hand.stage === 'showdown' || hand.stage === 'complete' || hand.stage === 'runout') {
    return { ok: false, error: 'Нет активного хода для пропуска' };
  }
  const seat = hand.seats[hand.toAct];
  if (!seat) return { ok: false, error: 'Некого пропускать' };
  const toCall = hand.currentBet - seat.streetBet;
  return applyAction(game, seat.id, { type: toCall > 0 ? 'fold' : 'check' });
}

function applyAction(game, playerId, action) {
  const hand = game.hand;

  // Открытие своей карты можно делать вне очереди (по подтверждению на клиенте).
  if (action.type === 'reveal') return doReveal(hand, playerId, action.cardIndex);

  if (!hand || hand.stage === 'showdown' || hand.stage === 'complete') {
    return { ok: false, error: 'Сейчас нет активной раздачи' };
  }

  const seat = hand.seats[hand.toAct];
  if (!seat || seat.id !== playerId) return { ok: false, error: 'Сейчас не ваш ход' };

  const toCall = hand.currentBet - seat.streetBet;
  const street = hand.stage; // улица на момент действия (до возможного перехода)

  switch (action.type) {
    case 'fold':
      seat.folded = true;
      seat.hasActed = true;
      break;

    case 'check':
      if (toCall > 0) return { ok: false, error: 'Нельзя чек: есть ставка для уравнивания' };
      seat.hasActed = true;
      break;

    case 'call':
      if (toCall <= 0) return { ok: false, error: 'Уравнивать нечего — используйте чек' };
      postChips(hand, seat, toCall, true); // если фишек меньше — уйдёт в all-in
      seat.hasActed = true;
      break;

    case 'raise': {
      // amount = СУММА, до которой поднимаем (целевой streetBet на этой улице).
      const target = action.amount;
      if (target == null || target <= hand.currentBet) {
        return { ok: false, error: 'Рейз должен превышать текущую ставку' };
      }
      const need = target - seat.streetBet;
      const raiseBy = target - hand.currentBet;
      const isAllIn = need >= seat.chips;
      if (!isAllIn && raiseBy < hand.minRaise) {
        return { ok: false, error: `Минимальный рейз до ${hand.currentBet + hand.minRaise}` };
      }
      if (need > seat.chips) return { ok: false, error: 'Недостаточно фишек' };
      postChips(hand, seat, need, true);
      raiseTo(hand, seat, raiseBy);
      break;
    }

    case 'allin': {
      const need = seat.chips;
      const newStreetBet = seat.streetBet + need;
      postChips(hand, seat, need, true); // ставит allIn
      if (newStreetBet > hand.currentBet) {
        raiseTo(hand, seat, newStreetBet - hand.currentBet);
      } else {
        seat.hasActed = true; // all-in в пределах колла — без переоткрытия торгов
      }
      break;
    }

    default:
      return { ok: false, error: 'Неизвестное действие' };
  }

  // лог действия для истории раздач (улица — на момент хода)
  hand.actionLog.push({
    street, id: seat.id, name: seat.name, type: action.type,
    to: (action.type === 'call' || action.type === 'raise' || action.type === 'allin') ? seat.streetBet : undefined,
    allIn: !!seat.allIn,
  });

  // Остался один — забирает банк без вскрытия.
  const live = hand.seats.filter((s) => !s.folded);
  if (live.length === 1) return endHandSinglePlayer(game, live[0]);

  return advanceAfterAction(game);
}

// Повышение ставки: фиксируем новый уровень и переоткрываем круг.
// (3a: любое повышение currentBet переоткрывает торги — упрощение, корректное
//  для игры с друзьями; тонкость неполного all-in-рейза уточним позже.)
function raiseTo(hand, raiser, raiseBy) {
  hand.currentBet = raiser.streetBet;
  hand.minRaise = Math.max(hand.minRaise, raiseBy);
  for (const s of hand.seats) if (!s.folded && !s.allIn) s.hasActed = false;
  raiser.hasActed = true;
}

function doReveal(hand, playerId, cardIndex) {
  if (!hand) return { ok: false, error: 'Нет раздачи' };
  const seat = hand.seats.find((s) => s.id === playerId);
  if (!seat) return { ok: false, error: 'Игрок не найден' };
  if (cardIndex == null || cardIndex < 0 || cardIndex >= seat.holeCards.length) {
    return { ok: false, error: 'Неверный индекс карты' };
  }
  seat.revealed[cardIndex] = true;
  return { ok: true, state: 'revealed', playerId, cardIndex, card: seat.holeCards[cardIndex] };
}

// ---------- продвижение раздачи ----------

function bettingRoundComplete(hand) {
  const actors = hand.seats.filter((s) => !s.folded && !s.allIn && s.chips > 0);
  if (actors.length === 0) return true; // все в all-in
  return actors.every((s) => s.hasActed && s.streetBet === hand.currentBet);
}

function advanceAfterAction(game) {
  const hand = game.hand;
  if (bettingRoundComplete(hand)) return advanceStreet(game);

  hand.toAct = nextIndex(hand, hand.toAct);
  skipToActable(hand);
  if (!canAct(hand.seats[hand.toAct])) return advanceStreet(game);

  return { ok: true, state: 'awaiting', toAct: hand.seats[hand.toAct].id };
}

function dealBoard(hand, count) {
  hand.deck.shift(); // сжигаем карту перед улицей (как в живой игре)
  for (let i = 0; i < count; i++) hand.board.push(hand.deck.shift());
}

function dealCountFor(variant, stage) {
  return { flop: variant.boardStages[0], turn: variant.boardStages[1], river: variant.boardStages[2] }[stage];
}

// Открыть очередную улицу и начать круг ставок.
function openStreet(game, stage) {
  const hand = game.hand;
  for (const s of hand.seats) { s.streetBet = 0; s.hasActed = false; }
  hand.currentBet = 0;
  hand.minRaise = hand.blinds.bb;
  dealBoard(hand, dealCountFor(game.variant, stage));
  hand.stage = stage;
  hand.toAct = (hand.buttonIndex + 1) % hand.seats.length;
  skipToActable(hand);
  return { ok: true, state: 'awaiting', stage: hand.stage, board: hand.board.slice(), toAct: hand.seats[hand.toAct].id };
}

// Вызывается при завершении круга ставок.
function advanceStreet(game) {
  const hand = game.hand;
  if (hand.stage === 'river') return goToShowdown(game);

  const nonFolded = hand.seats.filter((s) => !s.folded);
  const liveActors = nonFolded.filter((s) => !s.allIn && s.chips > 0);

  // Ставок больше не будет, но банк оспаривают ≥2 — это точка досдачи (run-out).
  // Не сдаём сразу: встаём на паузу, чтобы собрать согласие на число прогонов.
  if (liveActors.length <= 1 && nonFolded.length >= 2) {
    hand._runoutFrom = hand.stage;
    hand.stage = 'runout';
    return { ok: true, state: 'runout', remainingStreets: STAGES.slice(STAGES.indexOf(hand._runoutFrom) + 1) };
  }

  return openStreet(game, STAGES[STAGES.indexOf(hand.stage) + 1]);
}

// Целочисленное деление банка между прогонами; лишние фишки — ранним прогонам.
function splitInts(total, n) {
  const base = Math.floor(total / n);
  const arr = Array(n).fill(base);
  for (let i = 0; i < total - base * n; i++) arr[i] += 1;
  return arr;
}

// Досдать оставшиеся улицы `times` раз и разыграть банки по прогонам.
// times=1 — обычная досдача и стандартное вскрытие (как раньше).
function runOut(game, times = 1) {
  const hand = game.hand;
  const from = hand._runoutFrom || hand.stage;
  const remaining = STAGES.slice(STAGES.indexOf(from) + 1);
  const sharedBoard = hand.board.slice();

  if (times <= 1) {
    for (const st of remaining) {
      dealBoard(hand, dealCountFor(game.variant, st));
    }
    hand.stage = 'river';
    return goToShowdown(game);
  }

  // Несколько прогонов: общий борд + досданные карты без пересечений между прогонами.
  const boards = [];
  for (let r = 0; r < times; r++) {
    const b = sharedBoard.slice();
    for (const st of remaining) {
      hand.deck.shift(); // burn
      const cnt = dealCountFor(game.variant, st);
      for (let i = 0; i < cnt; i++) b.push(hand.deck.shift());
    }
    boards.push(b);
  }

  const pots = buildPots(hand.seats.map((s) => ({ id: s.id, committed: s.committed, folded: s.folded })));
  const payouts = {};
  const potResults = [];
  const runResults = boards.map((b) => {
    const shown = hand.seats.filter((s) => !s.folded).map((s) => ({ id: s.id, holeCards: s.holeCards }));
    return { board: b, results: game.variant.getWinners(shown, b).results };
  });

  for (const pot of pots) {
    const perRun = splitInts(pot.amount, times);
    const runs = [];
    for (let r = 0; r < times; r++) {
      const contenders = hand.seats.filter((s) => pot.eligible.includes(s.id)).map((s) => ({ id: s.id, holeCards: s.holeCards }));
      const winners = contenders.length <= 1 ? contenders.map((c) => c.id) : game.variant.getWinners(contenders, boards[r]).winnerIds;
      distribute(hand, winners, perRun[r], payouts);
      runs.push({ run: r + 1, winners, amount: perRun[r] });
    }
    potResults.push({ amount: pot.amount, eligible: pot.eligible, runs });
  }

  for (const [id, amt] of Object.entries(payouts)) hand.seats.find((s) => s.id === id).chips += amt;
  syncChipsBack(game);
  for (const s of hand.seats) if (!s.folded) s.revealed = s.holeCards.map(() => true);

  hand.board = boards[0]; // представительный борд для отображения
  const winnerIds = [...new Set(potResults.flatMap((p) => p.runs.flatMap((r) => r.winners)))];
  const premium = runResults.some((rr) => Object.entries(rr.results).some(([id, h]) => winnerIds.includes(id) && PREMIUM.has(h.name)));
  hand.result = {
    runsCount: times,
    runs: runResults.map((rr) => ({ board: rr.board, results: rr.results })),
    pots: potResults,
    payouts,
    winnerIds,
    premium,
    pot: hand.pot,
  };
  hand.stage = 'complete';
  return { ok: true, state: 'showdown', result: hand.result };
}

// ---------- завершение ----------

function syncChipsBack(game) {
  for (const s of game.hand.seats) {
    const p = game.players.find((pp) => pp.id === s.id);
    if (p) p.chips = s.chips;
  }
}

function endHandSinglePlayer(game, seat) {
  const hand = game.hand;
  seat.chips += hand.pot;
  syncChipsBack(game);
  hand.result = {
    winnerIds: [seat.id],
    results: {},
    payouts: { [seat.id]: hand.pot },
    pot: hand.pot,
    premium: false,
    uncontested: true,
  };
  hand.stage = 'complete';
  return { ok: true, state: 'handComplete', result: hand.result };
}

// Раздача лишних фишек при делёжке — по позиции по часовой от кнопки.
function orderByButton(hand, ids) {
  const n = hand.seats.length;
  const order = [];
  for (let k = 1; k <= n; k++) {
    const id = hand.seats[(hand.buttonIndex + k) % n].id;
    if (ids.includes(id)) order.push(id);
  }
  return order;
}

function distribute(hand, winners, amount, payouts) {
  const ordered = orderByButton(hand, winners);
  const share = Math.floor(amount / ordered.length);
  let remainder = amount - share * ordered.length;
  for (const id of ordered) payouts[id] = (payouts[id] || 0) + share;
  for (let i = 0; i < remainder; i++) payouts[ordered[i % ordered.length]] += 1;
}

function goToShowdown(game) {
  const hand = game.hand;
  hand.stage = 'showdown';

  // Имена комбинаций для всех, кто дошёл до вскрытия (для показа и премиум-флага).
  const shown = hand.seats.filter((s) => !s.folded).map((s) => ({ id: s.id, holeCards: s.holeCards }));
  const { results } = game.variant.getWinners(shown, hand.board);

  // Строим основной и боковые банки и разыгрываем каждый отдельно.
  const pots = buildPots(hand.seats.map((s) => ({ id: s.id, committed: s.committed, folded: s.folded })));
  const payouts = {};
  const potResults = [];

  for (const pot of pots) {
    const contenders = hand.seats
      .filter((s) => pot.eligible.includes(s.id))
      .map((s) => ({ id: s.id, holeCards: s.holeCards }));
    let winners;
    if (contenders.length <= 1) winners = contenders.map((c) => c.id);
    else winners = game.variant.getWinners(contenders, hand.board).winnerIds;
    distribute(hand, winners, pot.amount, payouts);
    potResults.push({ amount: pot.amount, eligible: pot.eligible, winners });
  }

  for (const [id, amt] of Object.entries(payouts)) {
    hand.seats.find((s) => s.id === id).chips += amt;
  }
  syncChipsBack(game);

  for (const s of hand.seats) if (!s.folded) s.revealed = s.holeCards.map(() => true);

  const winnerIds = [...new Set(potResults.flatMap((p) => p.winners))];
  const premium = winnerIds.some((id) => results[id] && PREMIUM.has(results[id].name));
  hand.result = { winnerIds, results, payouts, pots: potResults, pot: hand.pot, premium };
  hand.stage = 'complete';

  return { ok: true, state: 'showdown', result: hand.result };
}

// ---------- персонализированный вид для игрока ----------
// Чужие нераскрытые карты приходят как null (прячем на сервере, не на клиенте).

function viewFor(game, viewerId) {
  const hand = game.hand;
  if (!hand || hand.stage === 'complete') {
    // до раздачи или между раздачами — показываем сидящих за столом
    return {
      stage: hand && hand.stage === 'complete' ? 'complete' : 'idle',
      players: game.players.map((p) => ({ id: p.id, name: p.name, chips: p.chips, seat: p.seat, sittingOut: !!p.sittingOut })),
      tableSeats: game.players.map((p) => ({ id: p.id, name: p.name, chips: p.chips, seat: p.seat, sittingOut: !!p.sittingOut })),
      buttonId: game.buttonPlayerId,
      result: hand ? hand.result : null,
      board: hand ? hand.board.slice() : [],
      pot: hand ? hand.pot : 0,
      buttonIndex: hand ? hand.buttonIndex : -1,
      seats: hand ? hand.seats.map((s) => ({
        id: s.id, name: s.name, chips: s.chips, folded: s.folded, allIn: s.allIn,
        streetBet: s.streetBet, committed: s.committed,
        holeCards: s.holeCards.map((c, i) => (s.id === viewerId || s.revealed[i] ? c : null)),
      })) : [],
    };
  }
  const over = hand.stage === 'showdown';
  return {
    stage: hand.stage,
    board: hand.board.slice(),
    pot: hand.pot,
    currentBet: hand.currentBet,
    minRaise: hand.minRaise,
    buttonIndex: hand.buttonIndex,
    buttonId: game.buttonPlayerId,
    blinds: hand.blinds,
    toAct: over ? null : hand.seats[hand.toAct]?.id,
    // все сидящие за столом (с местами), включая сит-аут/вне раздачи — для рассадки
    tableSeats: game.players.map((p) => ({ id: p.id, name: p.name, chips: p.chips, seat: p.seat, sittingOut: !!p.sittingOut })),
    seats: hand.seats.map((s) => ({
      id: s.id,
      name: s.name,
      chips: s.chips,
      folded: s.folded,
      allIn: s.allIn,
      sittingOut: !!(game.players.find((p) => p.id === s.id) || {}).sittingOut,
      streetBet: s.streetBet,
      committed: s.committed,
      holeCards: s.holeCards.map((c, i) => (s.id === viewerId || s.revealed[i] ? c : null)),
      revealedFlags: s.id === viewerId ? s.revealed.slice() : undefined,
    })),
    result: hand.result,
  };
}

// ---------- пересадка ----------
// Пересесть нельзя, пока ты в текущей живой раздаче и ещё не сбросил карты.
function canReseat(game, playerId) {
  const hand = game.hand;
  if (!hand || hand.stage === 'complete' || hand.stage === 'idle') return true;
  const seat = hand.seats.find((s) => s.id === playerId);
  if (!seat) return true;           // не участвует в этой раздаче — можно
  return !!seat.folded;             // в раздаче: только если уже сфолдил
}

// Переместить игрока на свободное место targetSeat (0..maxSeats-1).
function reseat(game, playerId, targetSeat, maxSeats) {
  const p = game.players.find((pp) => pp.id === playerId);
  if (!p) return { ok: false, error: 'Игрок не найден' };
  if (!Number.isInteger(targetSeat) || targetSeat < 0 || targetSeat >= maxSeats) return { ok: false, error: 'Некорректное место' };
  if (game.players.some((pp) => pp.id !== playerId && pp.seat === targetSeat)) return { ok: false, error: 'Место занято' };
  if (!canReseat(game, playerId)) return { ok: false, error: 'Нельзя пересесть во время своей раздачи' };
  p.seat = targetSeat;
  return { ok: true };
}

module.exports = {
  createGame,
  addPlayer,
  startHand,
  applyAction,
  forceCurrent,
  runOut,
  viewFor,
  reseat,
  canReseat,
  PREMIUM,
};
