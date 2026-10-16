const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const room = require('./src/poker/room');
const storage = require('./src/poker/storage');
const reconnect = require('./src/poker/reconnect');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

// --- Политики (всё расширяемо изменением одной строки) ---
const MAX_ROOMS = 10;                       // потолок числа комнат
const GRACE_MS = 60 * 1000;                 // льготный период перед удалением пустой комнаты
const SNAPSHOT_INTERVAL_MS = 15 * 1000;     // период автоснимков на диск
const CLEANUP_INTERVAL_MS = 24 * 3600 * 1000; // автоочистка раз в сутки

// tables[roomId] = { core, sockets:Set<ws>, hostId, emptyTimer }
const tables = {};

function makeId(len = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function makeRoomId() {
  let id;
  do { id = makeId(4); } while (tables[id]);
  return id;
}

function persist(roomId) {
  const t = tables[roomId];
  if (!t) return;
  storage.saveSnapshot(roomId, room.serializeRoom(t.core));
}

function broadcastState(roomId) {
  const t = tables[roomId];
  if (!t) return;
  const runout = t.pendingRunout
    ? { contenders: t.pendingRunout.contenders, votes: t.pendingRunout.votes, maxRuns: t.core.settings.maxRuns }
    : null;
  // Серверный таймер хода: ставим/снимаем по состоянию текущего игрока.
  manageTurnTimer(roomId);
  // id игроков с живым сокетом — для индикатора «отключён» у остальных
  const connectedIds = [...t.sockets]
    .filter((s) => s.readyState === s.OPEN && s.playerId)
    .map((s) => s.playerId);
  for (const ws of t.sockets) {
    if (ws.readyState !== ws.OPEN) continue;
    ws.send(JSON.stringify({
      type: 'state',
      view: room.viewFor(t.core, ws.playerId),
      isHost: ws.playerId === t.hostId,
      runout,
      turnDeadline: t.turnDeadline || null,   // абсолютное время (ms) дедлайна или null
      turnTimerSec: t.core.settings.turnTimerSec || 0,
      nextHandAt: t.nextHandAt || null,        // когда автоматически начнётся след. раздача
      sessionStarted: !!t.sessionStarted,
      connectedIds,
    }));
  }
}

// Управление серверным таймером хода. Идемпотентно: вызывается на каждой рассылке.
function manageTurnTimer(roomId) {
  const t = tables[roomId];
  if (!t) return;
  const sec = t.core.settings.turnTimerSec || 0;
  const v = room.viewFor(t.core, t.hostId);
  const activeTurn = sec > 0 && v.toAct && !t.core.paused && !t.pendingRunout
    && v.stage !== 'complete' && v.stage !== 'idle' && v.stage !== 'runout';

  if (!activeTurn) { clearTurnTimer(t); return; }

  // если ход сменился — перезапускаем отсчёт
  if (t.timedTurnFor !== v.toAct) {
    clearTurnTimer(t);
    t.timedTurnFor = v.toAct;
    t.turnDeadline = Date.now() + sec * 1000;
    t.turnTimer = setTimeout(() => onTurnExpire(roomId, v.toAct), sec * 1000);
  }
}

function clearTurnTimer(t) {
  if (t.turnTimer) clearTimeout(t.turnTimer);
  t.turnTimer = null;
  t.turnDeadline = null;
  t.timedTurnFor = null;
}

// Истёк таймер хода — авто-чек если можно, иначе авто-фолд (через forceCurrent).
function onTurnExpire(roomId, expectedTurn) {
  const t = tables[roomId];
  if (!t) return;
  const v = room.viewFor(t.core, t.hostId);
  if (v.toAct !== expectedTurn) return; // ход уже сменился — отбой
  const r = room.forceCurrent(t.core);
  clearTurnTimer(t);
  if (r && r.ok) afterEngineResult(roomId, r);
  else broadcastState(roomId);
}

function currentContenders(core) {
  const h = core.game.hand;
  return h ? h.seats.filter((s) => !s.folded).map((s) => s.id) : [];
}

// Обработать результат хода/старта: записать раздачу, развести точку досдачи.
function afterEngineResult(roomId, r) {
  const t = tables[roomId];
  if (r.handRecord) storage.appendHand(roomId, r.handRecord);
  if (r.state === 'runout') {
    if (!t.core.settings.runItTwice) {
      const rr = room.runOut(t.core, 1); // RIT выключен — один прогон
      if (rr.handRecord) storage.appendHand(roomId, rr.handRecord);
    } else {
      t.pendingRunout = { contenders: currentContenders(t.core), votes: {} }; // ждём согласия
    }
  }
  persist(roomId);
  broadcastState(roomId);
  maybeAutoStart(roomId); // после завершения раздачи — планируем следующую
}

// Пауза между раздачами по скорости раздачи (мс).
const NEXT_HAND_DELAY = { fast: 2500, medium: 4500, slow: 7000 };

function activeCount(core) {
  return core.game.players.filter((p) => p.chips > 0 && !p.sittingOut).length;
}

// Можно ли сейчас автоматически сдать новую раздачу.
function canAutoStart(t) {
  if (!t || t.core.paused || t.pendingRunout) return false;
  if (!t.sessionStarted) return false;    // первая раздача — только вручную хостом
  const h = t.core.game.hand;
  const handActive = h && h.stage !== 'complete' && h.stage !== 'idle';
  if (handActive) return false;          // раздача ещё идёт
  return activeCount(t.core) >= 2;        // нужно 2+ активных игрока
}

// Запланировать автозапуск следующей раздачи (если условия выполнены).
function maybeAutoStart(roomId) {
  const t = tables[roomId];
  if (!t) return;
  clearTimeout(t.autoStartTimer);
  if (!canAutoStart(t)) return;
  const delay = NEXT_HAND_DELAY[t.core.settings.dealSpeed] || NEXT_HAND_DELAY.medium;
  t.nextHandAt = Date.now() + delay;
  t.autoStartTimer = setTimeout(() => {
    const tt = tables[roomId];
    if (!tt || !canAutoStart(tt)) { if (tt) { tt.nextHandAt = null; broadcastState(roomId); } return; }
    tt.nextHandAt = null;
    const rr = room.startHand(tt.core);
    afterEngineResult(roomId, rr);
  }, delay);
  broadcastState(roomId); // чтобы клиенты показали "след. раздача через…"
}

// ----- HTTP: статика -----
const server = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
    res.end(data);
  });
});

// ----- WebSocket -----
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.playerId = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    try { handle(ws, msg); }
    catch (e) { ws.send(JSON.stringify({ type: 'error', message: e.message })); }
  });
  ws.on('close', () => {
    const t = tables[ws.roomId];
    if (!t) return;
    t.sockets.delete(ws);
    // Льготный период: не сносим комнату сразу — короткий блип связи её не убивает.
    if (t.sockets.size === 0) {
      clearTimeout(t.emptyTimer);
      t.emptyTimer = setTimeout(() => {
        if (tables[ws.roomId] && tables[ws.roomId].sockets.size === 0) {
          clearTurnTimer(tables[ws.roomId]);
          clearTimeout(tables[ws.roomId].autoStartTimer);
          persist(ws.roomId);          // финальный снимок остаётся на диске (живёт 3 дня)
          delete tables[ws.roomId];
        }
      }, GRACE_MS);
    } else {
      broadcastState(ws.roomId); // оставшиеся увидят, кто отключился
    }
  });
});

function err(ws, message) { ws.send(JSON.stringify({ type: 'error', message })); }

function handle(ws, msg) {
  if (msg.type === 'create') {
    if (Object.keys(tables).length >= MAX_ROOMS) return err(ws, `Достигнут лимит комнат (${MAX_ROOMS})`);
    const roomId = makeRoomId();
    const playerId = makeId(8);
    const token = reconnect.issueToken();
    const core = room.createRoom({ id: roomId, variantId: msg.variantId || 'holdem', format: msg.format, settings: msg.settings });
    room.seatPlayer(core, { id: playerId, name: msg.name || 'Игрок' });
    tables[roomId] = { core, sockets: new Set([ws]), hostId: playerId, emptyTimer: null, tokens: { [playerId]: token } };
    ws.roomId = roomId;
    ws.playerId = playerId;
    ws.send(JSON.stringify({ type: 'joined', roomId, playerId, token }));
    broadcastState(roomId);
    persist(roomId);
    return;
  }

  if (msg.type === 'join') {
    const t = tables[msg.roomId];
    if (!t) return err(ws, 'Комната не найдена');
    clearTimeout(t.emptyTimer);
    const playerId = makeId(8);
    const token = reconnect.issueToken();
    const seated = room.seatPlayer(t.core, { id: playerId, name: msg.name || 'Игрок' });
    if (!seated.ok) return err(ws, seated.error || 'Не удалось сесть за стол');
    if (!t.tokens) t.tokens = {};
    t.tokens[playerId] = token;
    t.sockets.add(ws);
    ws.roomId = msg.roomId;
    ws.playerId = playerId;
    ws.send(JSON.stringify({ type: 'joined', roomId: msg.roomId, playerId, token }));
    broadcastState(msg.roomId);
    maybeAutoStart(msg.roomId);
    return;
  }

  // Возврат на своё место после обрыва/перезагрузки (по сохранённому токену).
  if (msg.type === 'rejoin') {
    const t = tables[msg.roomId];
    if (!t) return ws.send(JSON.stringify({ type: 'rejoinFailed', reason: 'no_room' }));
    const check = reconnect.canRejoin(t.tokens || {}, t.core.game.players, msg.playerId, msg.token);
    if (!check.ok) return ws.send(JSON.stringify({ type: 'rejoinFailed', reason: check.reason }));
    clearTimeout(t.emptyTimer);
    // одна активная сессия на игрока: если где-то висит старый открытый сокет — закрываем его
    for (const sock of [...t.sockets]) {
      if (sock.playerId === msg.playerId && sock !== ws) {
        t.sockets.delete(sock);
        if (sock.readyState === sock.OPEN) { try { sock.close(); } catch (e) { /* ignore */ } }
      }
    }
    t.sockets.add(ws);
    ws.roomId = msg.roomId;
    ws.playerId = msg.playerId;
    ws.send(JSON.stringify({ type: 'joined', roomId: msg.roomId, playerId: msg.playerId, token: msg.token, reconnected: true }));
    broadcastState(msg.roomId);
    return;
  }

  const t = tables[ws.roomId];
  if (!t) return err(ws, 'Вы не в комнате');
  const isHost = ws.playerId === t.hostId;

  if (msg.type === 'pause') {
    if (!isHost) return err(ws, 'Поставить паузу может только создатель');
    room.pause(t.core, ws.playerId);
    broadcastState(ws.roomId);
    return;
  }
  if (msg.type === 'resume') {
    if (!isHost) return err(ws, 'Снять паузу может только создатель');
    room.resume(t.core);
    broadcastState(ws.roomId);
    maybeAutoStart(ws.roomId);
    return;
  }

  if (msg.type === 'skipTurn') {
    if (!isHost) return err(ws, 'Пропустить ход может только создатель');
    const r = room.forceCurrent(t.core);
    if (!r.ok) return err(ws, r.error);
    afterEngineResult(ws.roomId, r);
    return;
  }

  if (msg.type === 'sitOut' || msg.type === 'sitIn') {
    // хост может двигать любого; игрок — только себя
    const target = msg.playerId || ws.playerId;
    if (!isHost && target !== ws.playerId) return err(ws, 'Можно менять только свой статус');
    room.setSitOut(t.core, target, msg.type === 'sitOut');
    broadcastState(ws.roomId);
    maybeAutoStart(ws.roomId);
    return;
  }

  if (msg.type === 'requestRebuy') {
    const r = room.requestRebuy(t.core, ws.playerId, msg.amount | 0);
    if (!r.ok) return err(ws, r.error);
    broadcastState(ws.roomId);
    return;
  }

  if (msg.type === 'resolveRebuy') {
    if (!isHost) return err(ws, 'Одобрять докупки может только создатель');
    const r = room.resolveRebuy(t.core, msg.playerId, !!msg.approve);
    if (!r.ok) return err(ws, r.error);
    maybeAutoStart(ws.roomId);
    broadcastState(ws.roomId);
    persist(ws.roomId);
    return;
  }

  if (msg.type === 'setStack') {
    if (!isHost) return err(ws, 'Менять стеки может только создатель');
    const r = room.setStack(t.core, msg.playerId, msg.amount | 0);
    if (!r.ok) return err(ws, r.error);
    maybeAutoStart(ws.roomId);
    broadcastState(ws.roomId);
    persist(ws.roomId);
    return;
  }

  if (msg.type === 'setTheme') {
    if (!isHost) return err(ws, 'Менять оформление может только создатель');
    const FELTS = ['green', 'blue', 'red', 'charcoal'];
    const BACKS = ['classic', 'blue', 'green', 'geo'];
    if (FELTS.includes(msg.feltTheme)) t.core.settings.feltTheme = msg.feltTheme;
    if (BACKS.includes(msg.cardBack)) t.core.settings.cardBack = msg.cardBack;
    broadcastState(ws.roomId);
    persist(ws.roomId);
    return;
  }

  if (msg.type === 'removePlayer') {
    if (!isHost) return err(ws, 'Удалять игроков может только создатель');
    if (msg.playerId === t.hostId) return err(ws, 'Нельзя удалить создателя стола');
    const forced = room.removePlayer(t.core, msg.playerId);
    if (forced && forced.handRecord) storage.appendHand(ws.roomId, forced.handRecord);
    // отметим сокет удалённого игрока, чтобы он не висел в комнате
    for (const sock of t.sockets) if (sock.playerId === msg.playerId) sock.playerId = null;
    persist(ws.roomId);
    broadcastState(ws.roomId);
    maybeAutoStart(ws.roomId);
    return;
  }

  if (msg.type === 'start') {
    if (!isHost) return err(ws, 'Начать раздачу может только создатель');
    if (t.core.paused) return err(ws, 'Снимите паузу, чтобы продолжить');
    t.pendingRunout = null;
    t.sessionStarted = true;   // с этого момента раздачи идут автоматически
    const r = room.startHand(t.core);
    afterEngineResult(ws.roomId, r);
    return;
  }

  if (msg.type === 'action') {
    if (t.core.paused) return err(ws, 'Игра на паузе');
    if (t.pendingRunout) return err(ws, 'Идёт выбор числа прогонов');
    const r = room.applyAction(t.core, ws.playerId, msg.action);
    if (!r.ok) return err(ws, r.error);
    afterEngineResult(ws.roomId, r);
    return;
  }

  if (msg.type === 'ritVote') {
    if (!t.pendingRunout) return;
    if (!t.pendingRunout.contenders.includes(ws.playerId)) return;
    t.pendingRunout.votes[ws.playerId] = msg.times; // 1 = «играем один раз»
    const { contenders, votes } = t.pendingRunout;
    if (contenders.every((id) => votes[id] != null)) {
      const vals = contenders.map((id) => votes[id]);
      // если хоть кто-то против многократного — один прогон; иначе минимум выбранного
      const agreed = vals.includes(1) ? 1 : Math.min(Math.min(...vals), t.core.settings.maxRuns);
      t.pendingRunout = null;
      const rr = room.runOut(t.core, agreed);
      if (rr.handRecord) storage.appendHand(ws.roomId, rr.handRecord);
      persist(ws.roomId);
    }
    broadcastState(ws.roomId);
    return;
  }

  if (msg.type === 'reveal') {
    const r = room.applyAction(t.core, ws.playerId, { type: 'reveal', cardIndex: msg.cardIndex });
    if (!r.ok) return err(ws, r.error);
    broadcastState(ws.roomId);
    return;
  }

  if (msg.type === 'summary') {
    const data = t.core.format.type === 'tournament'
      ? { kind: 'tournament', rows: room.tournamentStandings(t.core) }
      : { kind: 'cash', rows: room.cashSummary(t.core) };
    ws.send(JSON.stringify({ type: 'summary', ...data }));
    return;
  }

  if (msg.type === 'export') {
    const summary = t.core.format.type === 'tournament'
      ? room.tournamentStandings(t.core)
      : room.cashSummary(t.core);
    ws.send(JSON.stringify({ type: 'export', data: storage.exportSession(ws.roomId, summary) }));
    return;
  }
}

// Периодические задачи
setInterval(() => { for (const id of Object.keys(tables)) persist(id); }, SNAPSHOT_INTERVAL_MS);
setInterval(() => storage.cleanupOld(), CLEANUP_INTERVAL_MS);

server.listen(PORT, () => {
  const removed = storage.cleanupOld(); // автоочистка старья при старте
  console.log(`Сервер запущен: http://localhost:${PORT}` + (removed ? ` (очищено старых файлов: ${removed})` : ''));
});
