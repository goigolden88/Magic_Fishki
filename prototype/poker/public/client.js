'use strict';
// ---------- утилиты ----------
const $ = (id) => document.getElementById(id);
const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED = { h: true, d: true };

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

function cardEl(code, small) {
  const d = document.createElement('div');
  d.className = 'card' + (small ? ' small' : '');
  if (code == null) { d.classList.add('back'); return d; }
  const rank = code.slice(0, -1);
  const suit = code.slice(-1);
  if (RED[suit]) d.classList.add('red');
  const r = document.createElement('div'); r.className = 'rank'; r.textContent = rank === 'T' ? '10' : rank;
  const s = document.createElement('div'); s.className = 'suit'; s.textContent = SUIT[suit] || suit;
  d.append(r, s);
  return d;
}

// ---------- состояние клиента ----------
let socket = null;
let myPlayerId = null;
let amHost = false;
let lastView = null;
let selectedFormat = 'cash';
// пресеты ставок в % от банка (после колла); игрок может переназначить
let betPresets = JSON.parse(localStorage.getItem('betPresets') || 'null') || [33, 50, 66, 100];
let editingPresets = false;
let turnDeadline = null;   // абсолютное время дедлайна хода (ms) или null
let turnTimerSec = 0;
let nextHandAt = null;     // когда автоматически начнётся следующая раздача
let sessionStarted = false; // началась ли сессия (первый старт — вручную хостом)
let runoutVote = null;      // { contenders, votes, maxRuns } когда идёт голосование за прогоны
let myRitVote = null;       // мой выбор в текущем голосовании
let connectedIds = null;    // id игроков с живым сокетом (для индикатора «отключён»)
// дифф для анимаций 5.2
let dealAnimPending = false;   // одноразовый флаг «раздать карты с анимацией»
let boardAnimFrom = 0;         // с какого индекса борда карты новые (для переворота)
let pendingChipMoves = [];     // [{fromPid, toPot:true}] — ставки в банк
let pendingPayouts = null;     // { winners:[ids] } — выплаты из банка
let lastPayoutSig = null;      // чтобы не повторять анимацию выплаты на ту же раздачу
let displayUnit = localStorage.getItem('displayUnit') || 'chips'; // 'chips' | 'bb'
let viewRotation = parseInt(localStorage.getItem('viewRotation') || '0', 10) || 0; // визуальный поворот стола (моё место -> эта экранная позиция)
let animEnabled = localStorage.getItem('animEnabled') !== 'off'; // анимации (по умолч. вкл)
let levelEndAt = null;      // абсолютное время конца текущего турнирного уровня (или null)
let levelEndPaused = false; // если true — таймер уровня заморожен (показываем статично)
let levelPausedMs = 0;      // зафиксированный остаток на паузе

// единицы отображения: фишки или большие блайнды
function currentBB() { return (lastView && lastView.room && lastView.room.blinds && lastView.room.blinds.bb) || 1; }
function fmt(n) {
  if (n == null || isNaN(n)) return '';
  if (displayUnit === 'bb') {
    const bb = currentBB();
    if (!bb) return `${n}`;
    return `${(n / bb).toFixed(1)} BB`;
  }
  return `${n}`;
}

// локальный тик: индикатор таймера хода + обратный отсчёт до след. раздачи + таймер уровня
setInterval(() => {
  if (turnDeadline && lastView) updateTimerUI();
  if (nextHandAt) updateNextHandUI();
  if (levelEndAt || levelEndPaused) updateLevelTimerUI();
}, 500);

const params = new URLSearchParams(location.search);
const roomFromUrl = params.get('room');

// ---------- сохранённые учётные данные для переподключения ----------
function credsKey(roomId) { return 'poker:' + roomId; }
function saveCreds(roomId, playerId, token) {
  try { localStorage.setItem(credsKey(roomId), JSON.stringify({ playerId, token })); } catch (e) { /* ignore */ }
}
function loadCreds(roomId) {
  try { const v = localStorage.getItem(credsKey(roomId)); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}
function clearCreds(roomId) {
  try { localStorage.removeItem(credsKey(roomId)); } catch (e) { /* ignore */ }
}

// ---------- подключение ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  socket = new WebSocket(`${proto}://${location.host}`);

  socket.addEventListener('open', () => {
    $('status').textContent = 'подключено';
    if (roomFromUrl) {
      // зашли по ссылке — прячем настройки, меняем кнопку
      $('createOpts').classList.add('hidden');
      $('mainBtn').textContent = 'Войти в игру';
      // если есть сохранённая сессия для этой комнаты — пробуем вернуться на место
      const saved = loadCreds(roomFromUrl);
      if (saved && saved.playerId && saved.token) {
        $('status').textContent = 'переподключение…';
        $('mainBtn').disabled = true;
        socket.send(JSON.stringify({ type: 'rejoin', roomId: roomFromUrl, playerId: saved.playerId, token: saved.token }));
      }
    }
  });
  socket.addEventListener('close', () => { $('status').textContent = 'соединение потеряно — обновите страницу'; });
  socket.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
}

function onMessage(m) {
  if (m.type === 'joined') {
    myPlayerId = m.playerId;
    if (m.token) saveCreds(m.roomId, m.playerId, m.token);
    showTable(m.roomId);
  } else if (m.type === 'rejoinFailed') {
    // сохранённая сессия больше не действительна (стол закрыт, нас удалили или вылетели)
    if (roomFromUrl) clearCreds(roomFromUrl);
    $('mainBtn').disabled = false;
    const reasons = {
      no_room: 'стол закрыт — войдите заново',
      not_seated: 'вашего места больше нет — войдите заново',
      bad_token: 'сессия не распознана — войдите заново',
      unknown_player: 'сессия не найдена — войдите заново',
    };
    $('status').textContent = reasons[m.reason] || 'войдите заново';
    toast('Не удалось вернуться в игру — войдите заново');
  } else if (m.type === 'state') {
    amHost = m.isHost;
    // дифф для анимаций (сравниваем предыдущий вид с новым до подмены)
    computeAnimDiff(lastView, m.view);
    lastView = m.view;
    turnDeadline = m.turnDeadline || null;
    turnTimerSec = m.turnTimerSec || 0;
    nextHandAt = m.nextHandAt || null;
    sessionStarted = !!m.sessionStarted;
    runoutVote = m.runout || null;
    connectedIds = m.connectedIds || null;
    // турнирный таймер уровня: ставим абсолютный дедлайн или замораживаем на паузе.
    // Пока часы не запущены (стол не стартовал) — показываем уровень статично, без отсчёта.
    const r = m.view && m.view.room;
    if (r && r.format === 'tournament' && r.msToNextLevel != null && r.clockRunning) {
      if (r.paused) { levelEndPaused = true; levelPausedMs = r.msToNextLevel; levelEndAt = null; }
      else { levelEndPaused = false; levelEndAt = Date.now() + r.msToNextLevel; }
    } else if (r && r.format === 'tournament' && r.msToNextLevel != null) {
      // часы ещё не идут — статичная отметка полной длительности уровня
      levelEndPaused = true; levelPausedMs = r.msToNextLevel; levelEndAt = null;
    } else { levelEndAt = null; levelEndPaused = false; }
    renderTable(m.view);
    runChipAnimations();
    renderRunoutModal();
  } else if (m.type === 'summary') {
    showSummaryModal(m);
  } else if (m.type === 'export') {
    downloadExport(m.data);
  } else if (m.type === 'error') {
    toast(m.message);
  }
}

// ---------- лобби ----------
$('formatSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  selectedFormat = b.dataset.fmt;
  [...$('formatSeg').children].forEach((x) => x.classList.toggle('active', x === b));
  $('cashOpts').classList.toggle('hidden', selectedFormat !== 'cash');
  $('tournOpts').classList.toggle('hidden', selectedFormat !== 'tournament');
});

// схема роста: показывать «рост %» только для процентной схемы
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'tscheme') {
    $('growthWrap').classList.toggle('hidden', e.target.value !== 'percent');
  }
});

function buildCreatePayload() {
  const name = $('nameInput').value.trim() || 'Игрок';
  const stack = Math.max(1, parseInt($('stack').value, 10) || 1000);
  const speed = $('speed').value;
  let format;
  let rebuySettings = {};
  if (selectedFormat === 'tournament') {
    const structure = {
      scheme: $('tscheme').value,
      startSB: Math.max(1, parseInt($('tsb').value, 10) || 10),
      startBB: Math.max(2, parseInt($('tbb').value, 10) || 20),
      antePct: Math.max(0, parseInt($('tante').value, 10) || 0),
      levelMinutes: parseInt($('tdur').value, 10) || 10,
      growthPct: parseInt($('tgrowth').value, 10) || 100,
    };
    format = { type: 'tournament', structure };
    rebuySettings = { tournRebuys: parseInt($('tournRebuy').value, 10) || 0 };
  } else {
    format = {
      type: 'cash',
      sb: Math.max(1, parseInt($('sb').value, 10) || 5),
      bb: Math.max(2, parseInt($('bb').value, 10) || 10),
      ante: Math.max(0, parseInt($('ante').value, 10) || 0),
    };
    const cr = $('cashRebuy').value;
    rebuySettings = { cashRebuyMaxBB: cr === '' ? null : parseInt(cr, 10) };
  }
  return { type: 'create', name, variantId: 'holdem', format, settings: { startingStack: stack, dealSpeed: speed, turnTimerSec: parseInt($('turnTimer').value, 10) || 0, maxSeats: parseInt($('maxSeats').value, 10) || 9, feltTheme: $('feltTheme').value, cardBack: $('cardBack').value, publicHud: !!$('publicHud').checked, ...rebuySettings } };
}

$('mainBtn').addEventListener('click', () => {
  const name = $('nameInput').value.trim() || 'Игрок';
  if (roomFromUrl) socket.send(JSON.stringify({ type: 'join', roomId: roomFromUrl, name }));
  else socket.send(JSON.stringify(buildCreatePayload()));
});

$('nameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('mainBtn').click(); });

// ---------- переход на стол ----------
function showTable(roomId) {
  $('lobby').classList.add('hidden');
  $('table').classList.remove('hidden');
  $('roomCode').textContent = roomId;
  // зафиксировать комнату в URL — чтобы перезагрузка (в т.ч. у хоста) могла переподключиться
  try { history.replaceState(null, '', '?room=' + roomId); } catch (e) { /* ignore */ }
  $('copyBtn').onclick = () => {
    const link = `${location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(link).then(() => toast('Ссылка скопирована')).catch(() => toast(link));
  };
}

// ---------- рендер стола ----------
function renderTable(v) {
  const r = v.room || {};
  applyTheme(r.settings || {});
  // мета: вариант, формат, блайнды/уровень + плашка хоста
  let meta = `${r.variant || ''} · ${r.format === 'tournament' ? 'Турнир' : 'Кеш'}`;
  if (r.blinds) meta += ` · блайнды ${r.blinds.sb}/${r.blinds.bb}` + (r.blinds.ante ? ` (анте ${r.blinds.ante})` : '');
  if (r.format === 'tournament' && r.level) {
    meta += ` · уровень ${r.level}`;
    if (r.msToNextLevel != null) meta += ` · след. через <span id="levelTimer" class="level-timer">--:--</span>`;
  }
  $('meta').innerHTML = (amHost ? '<span class="host-pill">Вы — хост</span> ' : '') + `<span style="opacity:.85">${meta}</span>`;
  renderTopControls(v);

  // пауза
  const pb = $('pausedBanner');
  if (r.paused) { pb.classList.remove('hidden'); pb.textContent = '⏸ Перерыв (поставлен создателем)'; }
  else pb.classList.add('hidden');

  // банк и борд
  $('pot').textContent = v.pot != null ? `Банк: ${fmt(v.pot)}` : '';
  const board = $('board'); board.innerHTML = '';
  (v.board || []).forEach((c, i) => {
    const ce = cardEl(c, false);
    if (animEnabled && i >= boardAnimFrom) { ce.classList.add('anim-flip'); ce.style.animationDelay = ((i - boardAnimFrom) * 0.08) + 's'; }
    board.appendChild(ce);
  });
  boardAnimFrom = (v.board || []).length; // защита от повторного переворота при перерисовке

  const stageNames = { preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер', showdown: 'Вскрытие', complete: 'Раздача завершена', runout: 'Досдача', idle: 'Ожидание игроков' };
  $('stageLabel').textContent = stageNames[v.stage] || '';

  // единый овальный стол — и до раздачи, и во время
  renderOval(v);
  renderActions(v);
  renderResult(v);
  updateLevelTimerUI(); // первичная отрисовка таймера уровня сразу после рендера
}

// Зона места по экранной позиции pos (0 = низ по центру, далее по часовой).
// Триангуляция нужна только для распределения по зонам; размещение делает flex,
// поэтому наезда на банк быть не может.
function seatZone(pos, total) {
  const ang = Math.PI / 2 - (pos / total) * 2 * Math.PI; // 0 = низ
  const sin = Math.sin(ang), cos = Math.cos(ang);
  let zone;
  if (sin >= 0.7) zone = 'bottom';
  else if (sin <= -0.7) zone = 'top';
  else if (cos > 0) zone = 'right';
  else zone = 'left';
  return { zone, cos, sin };
}

// Единый рендер стола по РЕАЛЬНЫМ местам (tableSeats), разложенным во flex-зоны.
// Относительные позиции игроков сохраняются; viewRotation — только личный угол обзора.
function renderOval(v) {
  const zoneEls = { top: $('zoneTop'), right: $('zoneRight'), bottom: $('zoneBottom'), left: $('zoneLeft') };
  Object.values(zoneEls).forEach((z) => { if (z) z.innerHTML = ''; });
  const maxSeats = (v.room && v.room.settings && v.room.settings.maxSeats) || 9;
  const table = v.tableSeats || (v.players || []).map((p, i) => ({ ...p, seat: p.seat == null ? i : p.seat }));
  const inHand = !!(v.seats && v.seats.length);
  const handById = {};
  if (inHand) v.seats.forEach((s) => { handById[s.id] = s; });
  const buttonId = v.buttonId;

  const bySeat = {};
  table.forEach((p) => { if (p.seat != null) bySeat[p.seat] = p; });
  const me = table.find((p) => p.id === myPlayerId);
  const baseSeat = me ? me.seat : 0;
  const rot = ((viewRotation % maxSeats) + maxSeats) % maxSeats;

  // распределяем все места по зонам
  const buckets = { top: [], right: [], bottom: [], left: [] };
  for (let seatNo = 0; seatNo < maxSeats; seatNo++) {
    const pos = (((seatNo - baseSeat + rot) % maxSeats) + maxSeats) % maxSeats;
    const { zone, cos, sin } = seatZone(pos, maxSeats);
    buckets[zone].push({ seatNo, pos, cos, sin });
  }
  // порядок внутри зон: верх/низ — слева направо (по cos); бока — сверху вниз (по sin)
  buckets.top.sort((a, b) => a.cos - b.cos);
  buckets.bottom.sort((a, b) => a.cos - b.cos);
  buckets.right.sort((a, b) => a.sin - b.sin);
  buckets.left.sort((a, b) => a.sin - b.sin);

  ['top', 'right', 'bottom', 'left'].forEach((zone) => {
    buckets[zone].forEach(({ seatNo, pos }) => {
      const p = bySeat[seatNo];
      const el = p ? buildPod(p, handById[p.id], v, buttonId, inHand, pos) : buildEmpty(pos);
      if (zoneEls[zone]) zoneEls[zone].appendChild(el);
    });
  });
  dealAnimPending = false; // одноразово
}

// Свободный стул: клик поворачивает стол (визуально пересаживает меня сюда).
function buildEmpty(pos) {
  const el = document.createElement('div');
  el.className = 'seat empty seatable';
  el.textContent = 'Сесть сюда';
  el.title = 'Повернуть стол: смотреть с этого места (позиции игроков не меняются)';
  el.onclick = () => { viewRotation = pos; localStorage.setItem('viewRotation', String(pos)); renderTable(lastView); };
  return el;
}

// Под игрока.
function buildPod(p, h, v, buttonId, inHand, pos) {
  const folded = h ? h.folded : false;
  const allIn = h ? h.allIn : false;
  const el = document.createElement('div');
  el.className = 'seat'
    + (inHand && p.id === v.toAct ? ' turn' : '')
    + (folded ? ' folded' : '')
    + (p.id === myPlayerId ? ' me' : '');
  el.dataset.pid = p.id;

  const name = document.createElement('div'); name.className = 'name';
  const nameText = document.createElement('span');
  nameText.textContent = p.name;
  attachHud(nameText, p.id, p.name);
  name.appendChild(nameText);
  if (p.id === myPlayerId) name.appendChild(badge('Вы', 'me'));
  if (p.id === buttonId) name.appendChild(badge('D', 'd'));
  if (allIn) name.appendChild(badge('ALL-IN', 'allin'));
  if (p.sittingOut) name.appendChild(badge('сит', 'sb'));
  if (connectedIds && p.id !== myPlayerId && !connectedIds.includes(p.id)) name.appendChild(badge('off', 'off'));
  el.appendChild(name);

  const chips = document.createElement('div'); chips.className = 'chips'; chips.textContent = fmt(p.chips);
  el.appendChild(chips);

  if (h && h.streetBet > 0) {
    const b = document.createElement('div'); b.className = 'bet'; b.textContent = `ставка: ${fmt(h.streetBet)}`;
    el.appendChild(b);
  }

  if (h) {
    const hole = document.createElement('div'); hole.className = 'hole';
    (h.holeCards || []).forEach((c, ci) => {
      const ce = cardEl(c, true);
      if (dealAnimPending && animEnabled) { ce.classList.add('anim-deal'); ce.style.animationDelay = (pos * 0.06 + ci * 0.03) + 's'; }
      hole.appendChild(ce);
    });
    if ((h.holeCards || []).length) el.appendChild(hole);
  }

  const activeStage = v.stage && !['idle', 'complete', 'showdown'].includes(v.stage);
  if (h && p.id === myPlayerId && activeStage && !folded && (h.holeCards || []).every((c) => c != null) && h.holeCards.length) {
    h.revealedFlags = h.revealedFlags || [false, false];
    el.appendChild(revealRow(h));
  }

  if (h && p.id === v.toAct && turnDeadline && turnTimerSec > 0) {
    const bar = document.createElement('div'); bar.className = 'timerbar';
    const fill = document.createElement('i'); fill.dataset.seatTimer = '1';
    bar.appendChild(fill); el.appendChild(bar);
  }

  if ((p.id === myPlayerId) || amHost) {
    const gear = document.createElement('button'); gear.className = 'gear'; gear.textContent = '⚙';
    gear.title = 'Действия с местом';
    gear.onclick = (ev) => { ev.stopPropagation(); openSeatMenu(gear, p); };
    el.appendChild(gear);
  }
  return el;
}

// Всплывающее меню действий с местом (заменяет прежние кнопки на карточке).
function openSeatMenu(anchor, s) {
  closeSeatMenu();
  const menu = document.createElement('div'); menu.id = 'seatMenu';
  const addBtn = (label, cls, handler) => {
    const b = document.createElement('button'); b.className = cls; b.textContent = label;
    b.onclick = () => { handler(); closeSeatMenu(); };
    menu.appendChild(b);
  };
  // сит-аут / возврат — своё место (любой) или любое (хост)
  if (s.id === myPlayerId || amHost) {
    addBtn(s.sittingOut ? 'Вернуться в игру' : 'Сесть-аут (со след. раздачи)', 'btn-ghost',
      () => socket.send(JSON.stringify({ type: s.sittingOut ? 'sitIn' : 'sitOut', playerId: s.id })));
  }
  // правка стека — хост любому
  if (amHost) {
    addBtn('✎ Изменить стек', 'btn-ghost', () => {
      const val = prompt(`Новый стек для ${s.name} (в фишках):`, s.chips);
      const amount = parseInt(val, 10);
      if (amount >= 0) socket.send(JSON.stringify({ type: 'setStack', playerId: s.id, amount }));
    });
  }
  // удаление — хост, не себя
  if (amHost && s.id !== myPlayerId) {
    addBtn('Удалить со стола', 'btn-danger', () => {
      if (confirm(`Удалить игрока ${s.name} со стола?`)) socket.send(JSON.stringify({ type: 'removePlayer', playerId: s.id }));
    });
  }
  if (!menu.children.length) return;
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  let left = r.right - w; let top = r.bottom + 4;
  if (top + h > window.innerHeight - 8) top = r.top - h - 4;
  menu.style.position = 'fixed';
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
  setTimeout(() => {
    const off = (e) => { if (!menu.contains(e.target)) { closeSeatMenu(); document.removeEventListener('click', off); document.removeEventListener('keydown', kd); } };
    const kd = (e) => { if (e.key === 'Escape') { closeSeatMenu(); document.removeEventListener('click', off); document.removeEventListener('keydown', kd); } };
    document.addEventListener('click', off);
    document.addEventListener('keydown', kd);
  }, 0);
}
function closeSeatMenu() { const m = document.getElementById('seatMenu'); if (m) m.remove(); }

function badge(text, cls) { const b = document.createElement('span'); b.className = 'badge ' + cls; b.textContent = text; return b; }

function renderActions(v) {
  const box = $('actions'); box.innerHTML = '';

  // нет активной раздачи
  const noHand = !v.stage || v.stage === 'idle' || v.stage === 'complete';
  if (noHand && !v.room.paused) {
    if (!sessionStarted) {
      // первая раздача — вручную хостом, когда все зашли
      if (amHost) {
        const start = document.createElement('button');
        start.className = 'btn-gold'; start.textContent = 'Начать игру';
        const enough = ((v.players || v.seats || []).filter((p) => !p.sittingOut).length) >= 2;
        start.disabled = !enough;
        start.onclick = () => socket.send(JSON.stringify({ type: 'start' }));
        box.appendChild(start);
        if (!enough) { const s = document.createElement('span'); s.style.opacity = '.7'; s.textContent = ' нужно минимум 2 игрока'; box.appendChild(s); }
      } else {
        const s = document.createElement('span'); s.style.opacity = '.8'; s.textContent = 'Ожидаем, пока создатель начнёт игру…';
        box.appendChild(s);
      }
    } else if (nextHandAt) {
      const span = document.createElement('span');
      span.id = 'nextHandLabel'; span.style.opacity = '.85'; span.style.fontWeight = '700';
      box.appendChild(span);
      updateNextHandUI();
      if (amHost) {
        const now = document.createElement('button');
        now.className = 'btn-gold'; now.textContent = 'Начать сейчас';
        now.onclick = () => socket.send(JSON.stringify({ type: 'start' }));
        box.appendChild(now);
      }
    } else if (amHost) {
      const start = document.createElement('button');
      start.className = 'btn-gold'; start.textContent = 'Следующая раздача';
      start.onclick = () => socket.send(JSON.stringify({ type: 'start' }));
      box.appendChild(start);
    }
  }

  // хост: пропустить ход текущего игрока (если идёт раздача и сейчас не мой ход)
  if (amHost && !noHand && v.toAct && v.toAct !== myPlayerId && v.stage !== 'runout') {
    const skip = document.createElement('button');
    skip.className = 'btn-ghost';
    const who = (v.seats.find((s) => s.id === v.toAct) || {}).name || '';
    skip.textContent = `Пропустить ход${who ? ': ' + who : ''}`;
    skip.onclick = () => socket.send(JSON.stringify({ type: 'skipTurn' }));
    box.appendChild(skip);
  }

  // мой ход?
  if (v.toAct !== myPlayerId || v.room.paused) return;
  const me = (v.seats || []).find((s) => s.id === myPlayerId);
  if (!me) return;
  const toCall = (v.currentBet || 0) - (me.streetBet || 0);
  const callAmt = Math.min(toCall, me.chips);

  // --- блок рейза: пресеты + слайдер ---
  const minRaiseTo = (v.currentBet || 0) + (v.minRaise || v.room.blinds.bb);
  const maxTo = me.streetBet + me.chips; // ва-банк по сумме на улице
  const canRaise = maxTo > (v.currentBet || 0) && me.chips > toCall;

  // Fold
  box.appendChild(actionBtn('Фолд', 'btn-danger', { type: 'fold' }));
  // Check / Call
  if (toCall <= 0) box.appendChild(actionBtn('Чек', 'btn-ghost', { type: 'check' }));
  else box.appendChild(actionBtn(`Колл ${fmt(callAmt)}`, 'btn-ghost', { type: 'call' }));

  if (canRaise) {
    const container = document.createElement('div');
    container.style.display = 'flex'; container.style.flexDirection = 'column'; container.style.gap = '6px';

    // конвертеры между фишками (источник правды) и выбранными единицами отображения
    const inBB = displayUnit === 'bb';
    const bb = v.room.blinds.bb || 1;
    const toDisp = (chips) => inBB ? +(chips / bb).toFixed(1) : chips;
    const toChips = (disp) => inBB ? Math.max(0, Math.round(parseFloat(disp) * bb)) : Math.max(0, parseInt(disp, 10) || 0);
    const dispStep = inBB ? 0.1 : 1;

    // пресеты % от банка (после колла): target = currentBet + pct% * (pot + toCall)
    const presetRow = document.createElement('div'); presetRow.className = 'presets';
    const potAfterCall = (v.pot || 0) + toCall;
    betPresets.forEach((pct, idx) => {
      const pb = document.createElement('button');
      pb.className = 'preset' + (editingPresets ? ' edit' : '');
      pb.textContent = pct + '%';
      pb.onclick = () => {
        if (editingPresets) {
          const np = prompt(`Новый процент для кнопки ${idx + 1}:`, pct);
          const val = parseInt(np, 10);
          if (val > 0) { betPresets[idx] = val; localStorage.setItem('betPresets', JSON.stringify(betPresets)); renderActions(v); }
          return;
        }
        let targetChips = (v.currentBet || 0) + Math.round(potAfterCall * pct / 100);
        targetChips = Math.max(minRaiseTo, Math.min(targetChips, maxTo));
        num.value = toDisp(targetChips); range.value = num.value; updateHint();
      };
      presetRow.appendChild(pb);
    });
    // кнопка «банк» = ставка размером в банк после колла
    const potBtn = document.createElement('button');
    potBtn.className = 'preset'; potBtn.textContent = 'Банк';
    potBtn.onclick = () => {
      let targetChips = Math.max(minRaiseTo, Math.min((v.currentBet || 0) + potAfterCall, maxTo));
      num.value = toDisp(targetChips); range.value = num.value; updateHint();
    };
    presetRow.appendChild(potBtn);
    // карандаш — режим переназначения процентов
    const editBtn = document.createElement('button');
    editBtn.className = 'preset'; editBtn.textContent = editingPresets ? '✓' : '✎';
    editBtn.title = 'Изменить проценты';
    editBtn.onclick = () => { editingPresets = !editingPresets; renderActions(v); };
    presetRow.appendChild(editBtn);
    container.appendChild(presetRow);

    // слайдер + число + кнопка рейза (значения — в выбранных единицах)
    const rb = document.createElement('div'); rb.className = 'raisebox';
    const minTo = Math.min(minRaiseTo, maxTo);
    var range = document.createElement('input');
    range.type = 'range'; range.min = toDisp(minTo); range.max = toDisp(maxTo); range.step = dispStep; range.value = toDisp(minTo);
    var num = document.createElement('input');
    num.type = 'number'; num.min = range.min; num.max = range.max; num.step = dispStep; num.value = range.value;
    range.oninput = () => { num.value = range.value; updateHint(); };
    num.oninput = () => { range.value = num.value; updateHint(); };
    // колесо мыши над слайдером меняет ставку (шаг учитывает единицы)
    range.addEventListener('wheel', (e) => {
      e.preventDefault();
      const span = parseFloat(range.max) - parseFloat(range.min);
      const step = inBB ? Math.max(0.5, +(span / 50).toFixed(1)) : Math.max(1, Math.round(span / 50));
      let val = parseFloat(range.value) + (e.deltaY < 0 ? step : -step);
      val = Math.max(parseFloat(range.min), Math.min(parseFloat(range.max), val));
      if (inBB) val = +val.toFixed(1);
      range.value = val; num.value = val; updateHint();
    }, { passive: false });
    const go = document.createElement('button');
    go.className = 'btn-gold'; go.textContent = 'Рейз';
    go.onclick = () => {
      // на сервер всегда уходят фишки — источник правды
      let targetChips = toChips(num.value);
      targetChips = Math.max(minRaiseTo, Math.min(targetChips, maxTo));
      socket.send(JSON.stringify({ type: 'action', action: { type: 'raise', amount: targetChips } }));
    };
    rb.append(range, num, go);
    container.appendChild(rb);

    // подсказка: до какой суммы поднимаем и сколько реально уходит со стека
    const hint = document.createElement('div'); hint.className = 'raise-hint';
    container.appendChild(hint);
    function updateHint() {
      const targetChips = toChips(num.value);
      const spendChips = targetChips - me.streetBet;
      hint.textContent = `рейз до ${fmt(targetChips)} (со стека уйдёт ${fmt(spendChips)})`;
    }
    updateHint();

    box.appendChild(container);
  }

  // All-in отдельной кнопкой
  box.appendChild(actionBtn(`Ва-банк (${fmt(me.chips)})`, 'btn-ok', { type: 'allin' }));
}

function actionBtn(text, cls, action) {
  const b = document.createElement('button');
  b.className = cls; b.textContent = text;
  b.onclick = () => socket.send(JSON.stringify({ type: 'action', action }));
  return b;
}

function renderResult(v) {
  const box = $('result'); box.innerHTML = '';
  if (v.stage !== 'complete' || !v.result) return;
  const res = v.result;
  const el = document.createElement('div'); el.className = 'result';
  const names = {};
  (v.seats || []).forEach((s) => { names[s.id] = s.name; });

  const h = document.createElement('h2');
  if (res.uncontested) h.textContent = `${names[res.winnerIds[0]] || '—'} забирает банк`;
  else h.textContent = res.runsCount > 1 ? `Итог по ${res.runsCount} прогонам` : 'Вскрытие';
  el.appendChild(h);

  // выплаты
  Object.entries(res.payouts || {}).forEach(([id, amt]) => {
    const line = document.createElement('div'); line.className = 'line';
    const combo = res.results && res.results[id] ? ` — ${res.results[id].descr}` : '';
    line.textContent = `${names[id] || id}: +${fmt(amt)}${combo}`;
    el.appendChild(line);
  });

  if (res.premium) {
    const p = document.createElement('div'); p.className = 'line'; p.style.color = 'var(--gold)'; p.style.marginTop = '6px';
    p.textContent = '★ Премиальная рука!';
    el.appendChild(p);
  }
  box.appendChild(el);
}

// верхние кнопки: тумблер ББ, пауза/снятие (хост), итоги, докупка, журнал
function renderTopControls(v) {
  const box = $('topControls'); if (!box) return; box.innerHTML = '';

  // тумблер фишки ↔ ББ
  const unit = document.createElement('button');
  unit.className = 'unit-pill';
  unit.textContent = displayUnit === 'bb' ? 'BB' : '🪙 фишки';
  unit.title = 'Переключить единицы отображения: фишки ↔ большие блайнды';
  unit.onclick = () => {
    displayUnit = displayUnit === 'bb' ? 'chips' : 'bb';
    localStorage.setItem('displayUnit', displayUnit);
    if (lastView) renderTable(lastView);
  };
  box.appendChild(unit);

  if (amHost) {
    const p = document.createElement('button');
    if (v.room.paused) { p.className = 'btn-ok'; p.textContent = '▶ Продолжить'; p.onclick = () => socket.send(JSON.stringify({ type: 'resume' })); }
    else { p.className = 'btn-ghost'; p.textContent = '⏸ Перерыв'; p.onclick = () => socket.send(JSON.stringify({ type: 'pause' })); }
    box.appendChild(p);
  }
  const sum = document.createElement('button');
  sum.className = 'btn-ghost'; sum.textContent = '📊 Итоги';
  sum.onclick = () => socket.send(JSON.stringify({ type: 'summary' }));
  box.appendChild(sum);

  // докупка (если разрешена для меня). myRebuyMax: -1 = без ограничений, 0 = запрещено, >0 = лимит
  const myMax = v.room.myRebuyMax;
  if (myMax === -1 || myMax > 0) {
    const rb = document.createElement('button');
    rb.className = 'btn-ghost'; rb.textContent = '➕ Докупить';
    rb.onclick = () => requestRebuyDialog(v);
    box.appendChild(rb);
  }

  // журнал движения фишек — теперь в общем потоке, не fixed
  const led = document.createElement('button');
  led.className = 'btn-ghost'; led.textContent = '💰 Журнал';
  led.onclick = () => $('ledgerPanel').classList.toggle('open');
  box.appendChild(led);

  // настройки вида (личные, в localStorage): рассадка и анимации
  const view = document.createElement('button');
  view.className = 'btn-ghost'; view.textContent = '⚙ Вид';
  view.onclick = (ev) => { ev.stopPropagation(); openViewSettings(view); };
  box.appendChild(view);

  // оформление стола (только хост): сукно и рубашка
  if (amHost) {
    const th = document.createElement('button');
    th.className = 'btn-ghost'; th.textContent = '🎨 Стол';
    th.onclick = (ev) => { ev.stopPropagation(); openThemePopup(th, v); };
    box.appendChild(th);
  }

  renderLedger(v);
}

// Попап личных настроек отображения (видит только сам игрок).
function openViewSettings(anchor) {
  closeViewSettings();
  const pop = document.createElement('div'); pop.id = 'viewSettings';
  const row = (label, checked, onToggle) => {
    const r = document.createElement('label'); r.className = 'vs-row';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked;
    cb.onchange = () => onToggle(cb.checked);
    const sp = document.createElement('span'); sp.textContent = label;
    r.append(cb, sp); return r;
  };
  pop.appendChild(row('Анимации', animEnabled, (val) => {
    animEnabled = val; localStorage.setItem('animEnabled', val ? 'on' : 'off');
    document.body.classList.toggle('no-anim', !animEnabled);
  }));
  const reset = document.createElement('button');
  reset.className = 'btn-ghost'; reset.textContent = '↻ Сбросить поворот (я снизу)';
  reset.onclick = () => { viewRotation = 0; localStorage.setItem('viewRotation', '0'); closeViewSettings(); if (lastView) renderTable(lastView); };
  pop.appendChild(reset);
  const note = document.createElement('div'); note.className = 'vs-note';
  note.textContent = 'Поворот стола — личный и только визуальный: реальные позиции игроков (блайнды, кнопка) не меняются.';
  pop.appendChild(note);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  setTimeout(() => {
    const off = (e) => { if (!pop.contains(e.target)) { closeViewSettings(); document.removeEventListener('click', off); } };
    document.addEventListener('click', off);
  }, 0);
}
function closeViewSettings() { const p = document.getElementById('viewSettings'); if (p) p.remove(); }

// Применить тему сукна и рубашку (классы на body); вызывается на каждый рендер.
function applyTheme(settings) {
  const felt = settings.feltTheme || 'green';
  const back = settings.cardBack || 'classic';
  document.body.classList.forEach((c) => { if (c.startsWith('felt-') || c.startsWith('cb-')) document.body.classList.remove(c); });
  document.body.classList.add('felt-' + felt);
  document.body.classList.add('cb-' + back);
}

// Попап оформления (только хост): сукно + рубашка, применяется сразу всем.
function openThemePopup(anchor, v) {
  closeThemePopup();
  const cur = (v.room && v.room.settings) || {};
  const pop = document.createElement('div'); pop.id = 'themePopup';
  const mkSelect = (label, options, current, onPick) => {
    const wrap = document.createElement('div'); wrap.className = 'tp-row';
    const lab = document.createElement('div'); lab.className = 'tp-lab'; lab.textContent = label;
    const sel = document.createElement('select');
    options.forEach(([val, name]) => { const o = document.createElement('option'); o.value = val; o.textContent = name; if (val === current) o.selected = true; sel.appendChild(o); });
    sel.onchange = () => onPick(sel.value);
    wrap.append(lab, sel); return wrap;
  };
  let feltVal = cur.feltTheme || 'green';
  let backVal = cur.cardBack || 'classic';
  const send = () => socket.send(JSON.stringify({ type: 'setTheme', feltTheme: feltVal, cardBack: backVal }));
  pop.appendChild(mkSelect('Сукно', [['green', 'Зелёное'], ['blue', 'Синее'], ['red', 'Бордовое'], ['charcoal', 'Графит']], feltVal, (v2) => { feltVal = v2; send(); }));
  pop.appendChild(mkSelect('Рубашка карт', [['classic', 'Классика'], ['blue', 'Синяя'], ['green', 'Зелёная'], ['geo', 'Гео']], backVal, (v2) => { backVal = v2; send(); }));
  const note = document.createElement('div'); note.className = 'vs-note'; note.textContent = 'Применяется сразу для всех за столом.';
  pop.appendChild(note);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.left)) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  setTimeout(() => {
    const off = (e) => { if (!pop.contains(e.target)) { closeThemePopup(); document.removeEventListener('click', off); } };
    document.addEventListener('click', off);
  }, 0);
}
function closeThemePopup() { const p = document.getElementById('themePopup'); if (p) p.remove(); }

function requestRebuyDialog(v) {
  const max = v.room.myRebuyMax;
  const hint = max === -1 ? 'без ограничения' : `максимум ${fmt(max)}`;
  const def = v.room.blinds.bb * 100;
  const val = prompt(`Сколько фишек докупить? (${hint})\nЗапрос уйдёт на одобрение создателю.\nВводите в фишках.`, def);
  const amount = parseInt(val, 10);
  if (amount > 0) socket.send(JSON.stringify({ type: 'requestRebuy', amount }));
}

// журнал фишек + (для хоста) запросы на докупку
function renderLedger(v) {
  const panel = $('ledgerPanel'); panel.innerHTML = '';
  const head = document.createElement('div'); head.style.display = 'flex'; head.style.justifyContent = 'space-between'; head.style.alignItems = 'center'; head.style.marginBottom = '12px';
  const h = document.createElement('h2'); h.textContent = '💰 Движение фишек'; h.style.margin = '0';
  const x = document.createElement('button'); x.className = 'btn-ghost mini'; x.textContent = '✕ закрыть';
  x.onclick = () => $('ledgerPanel').classList.remove('open');
  head.append(h, x); panel.appendChild(head);

  // запросы на одобрение (только хост)
  if (amHost && v.room.rebuyRequests && v.room.rebuyRequests.length) {
    v.room.rebuyRequests.forEach((req) => {
      const d = document.createElement('div'); d.className = 'rebuy-req';
      d.innerHTML = `<div><b>${esc(req.name)}</b> просит докупить <b>${fmt(req.amount)}</b></div>`;
      const ra = document.createElement('div'); ra.className = 'ra';
      const ok = document.createElement('button'); ok.className = 'btn-ok mini'; ok.textContent = 'Одобрить';
      ok.onclick = () => socket.send(JSON.stringify({ type: 'resolveRebuy', playerId: req.id, approve: true }));
      const no = document.createElement('button'); no.className = 'btn-danger mini'; no.textContent = 'Отклонить';
      no.onclick = () => socket.send(JSON.stringify({ type: 'resolveRebuy', playerId: req.id, approve: false }));
      ra.append(ok, no); d.appendChild(ra); panel.appendChild(d);
    });
  }

  // движение фишек (новые сверху)
  const log = (v.room.chipLog || []).slice().reverse();
  const chipsHead = document.createElement('div'); chipsHead.className = 'ledger-section'; chipsHead.textContent = 'Движение фишек';
  panel.appendChild(chipsHead);
  if (!log.length) {
    const e = document.createElement('div'); e.style.opacity = '.6'; e.style.fontSize = '13px'; e.textContent = 'Пока нет операций';
    panel.appendChild(e);
  } else {
    log.forEach((it) => {
      const d = document.createElement('div'); d.className = 'ledger-item' + (it.type === 'rebuy_declined' ? ' declined' : '');
      const time = new Date(it.ts).toLocaleTimeString();
      let text;
      if (it.type === 'rebuy') text = `докупил +${fmt(it.amount)} (одобрено)`;
      else if (it.type === 'rebuy_declined') text = `докупка ${fmt(it.amount)} отклонена`;
      else if (it.type === 'host_set') text = `стек изменён хостом: ${fmt(it.from)} → ${fmt(it.to)}${it.deferred ? ' (со след. раздачи)' : ''}`;
      else text = it.type;
      d.innerHTML = `<div class="who">${esc(it.name || '')}</div><div>${text}</div><div class="when">${time}</div>`;
      panel.appendChild(d);
    });
  }

  // история последних раздач
  renderHandHistory(panel, v.room.recentHands || []);
}

// Мини-карта для журнала (текстом со значком масти).
function miniCardText(code) {
  if (!code) return '🂠';
  const SUITM = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const r = code.slice(0, -1), su = code.slice(-1);
  return (r === 'T' ? '10' : r) + (SUITM[su] || su);
}

function renderHandHistory(panel, hands) {
  const head = document.createElement('div'); head.className = 'ledger-section'; head.textContent = 'Последние раздачи';
  panel.appendChild(head);
  if (!hands.length) {
    const e = document.createElement('div'); e.style.opacity = '.6'; e.style.fontSize = '13px'; e.textContent = 'Раздач ещё не было';
    panel.appendChild(e);
    return;
  }
  hands.forEach((h) => {
    const d = document.createElement('div'); d.className = 'hand-item' + (h.premium ? ' premium' : '');
    const time = new Date(h.ts).toLocaleTimeString();
    const board = (h.board || []).map(miniCardText).join(' ') || '—';
    const wins = (h.winners || []).map((w) => {
      const combo = w.combo ? ` (${esc(w.combo)})` : '';
      const cards = w.comboCards && w.comboCards.length ? ` — ${w.comboCards.map(miniCardText).join(' ')}` : '';
      return `${esc(w.name)} +${fmt(w.amount)}${combo}${cards}`;
    }).join('<br>');
    const shown = (h.shown || []).map((s) => `${esc(s.name)}: ${(s.cards || []).map(miniCardText).join(' ')}${s.folded ? ' (фолд)' : ''}`).join('<br>');
    const actions = renderActionsHtml(h.actions || []);
    d.innerHTML =
      `<div class="hand-top"><b>Раздача #${h.n}</b><span class="when">${time}</span></div>` +
      `<div class="hand-board">Борд: ${board} · банк ${fmt(h.pot)}</div>` +
      `<div class="hand-win">${wins}</div>` +
      (shown ? `<div class="hand-shown">${shown}</div>` : '') +
      (actions ? `<div class="hand-actions">${actions}</div>` : '');
    panel.appendChild(d);
  });
}

// Компактный HTML действий по улицам.
function renderActionsHtml(streets) {
  if (!streets.length) return '';
  const stName = { preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер' };
  const actName = (a) => {
    if (a.type === 'fold') return 'фолд';
    if (a.type === 'check') return 'чек';
    if (a.type === 'call') return `колл${a.to != null ? ' ' + fmt(a.to) : ''}`;
    if (a.type === 'raise') return `рейз до ${fmt(a.to)}`;
    if (a.type === 'allin') return `ва-банк ${fmt(a.to)}`;
    return a.type;
  };
  return streets.map((s) => {
    const acts = s.acts.map((a) => `${esc(a.name)} ${actName(a)}`).join(', ');
    return `<div class="street-line"><span class="street-name">${stName[s.street] || s.street}:</span> ${acts}</div>`;
  }).join('');
}

// кнопки открытия своих карт по одной (с подтверждением)
function revealRow(seat) {
  const row = document.createElement('div'); row.className = 'reveal-row';
  seat.holeCards.forEach((c, i) => {
    if (c == null) return; // на всякий случай
    const b = document.createElement('button');
    const shown = seat.revealedFlags && seat.revealedFlags[i];
    b.className = 'reveal-btn' + (shown ? ' shown' : '');
    b.textContent = shown ? `Карта ${i + 1} открыта` : `Показать карту ${i + 1}`;
    if (!shown) b.onclick = () => {
      if (confirm(`Показать карту ${i + 1} всем игрокам? Это необратимо.`))
        socket.send(JSON.stringify({ type: 'reveal', cardIndex: i }));
    };
    row.appendChild(b);
  });
  return row;
}

// модалка голосования за число прогонов (run it twice/three)
function renderRunoutModal() {
  const root = $('modalRoot');
  const existing = document.getElementById('ritModal');
  if (!runoutVote) { if (existing) existing.remove(); myRitVote = null; return; }
  const amContender = runoutVote.contenders.includes(myPlayerId);
  if (existing) existing.remove();

  const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.id = 'ritModal';
  const m = document.createElement('div'); m.className = 'modal';
  const h = document.createElement('h2'); h.textContent = 'Сколько раз прогнать борд?';
  m.appendChild(h);
  const note = document.createElement('div'); note.style.opacity = '.85'; note.style.fontSize = '14px';
  note.textContent = amContender ? 'Все участники должны согласиться. Если хоть кто-то выберет «1 раз» — играем один прогон.' : 'Участники раздачи выбирают число прогонов…';
  m.appendChild(note);

  if (amContender) {
    const row = document.createElement('div'); row.className = 'vote-row';
    const opts = [1, 2]; if ((runoutVote.maxRuns || 2) >= 3) opts.push(3);
    opts.forEach((n) => {
      const b = document.createElement('button');
      b.className = myRitVote === n ? 'btn-gold' : 'btn-ghost';
      b.textContent = n === 1 ? '1 раз' : `${n} раза`;
      b.onclick = () => { myRitVote = n; socket.send(JSON.stringify({ type: 'ritVote', times: n })); renderRunoutModal(); };
      row.appendChild(b);
    });
    m.appendChild(row);
  }
  // статус: кто уже проголосовал
  const st = document.createElement('div'); st.className = 'vote-status';
  const voted = Object.keys(runoutVote.votes || {}).length;
  st.textContent = `Проголосовало: ${voted} из ${runoutVote.contenders.length}`;
  m.appendChild(st);

  bg.appendChild(m); root.appendChild(bg);
}

// модалка итогов (кеш-сводка или турнирная таблица)
function showSummaryModal(msg) {
  const root = $('modalRoot');
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  const m = document.createElement('div'); m.className = 'modal';
  const h = document.createElement('h2'); h.textContent = msg.kind === 'tournament' ? 'Турнирная таблица' : 'Итоги сессии (кеш)';
  m.appendChild(h);

  const table = document.createElement('table');
  if (msg.kind === 'tournament') {
    table.innerHTML = '<tr><th>Место</th><th>Игрок</th><th>Фишки</th><th>Статус</th></tr>';
    msg.rows.forEach((r) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${r.place}</td><td>${esc(r.name)}</td><td>${fmt(r.chips)}</td><td>${r.eliminated ? 'выбыл' : 'в игре'}</td>`;
      table.appendChild(tr);
    });
  } else {
    table.innerHTML = '<tr><th>Игрок</th><th>Закуплено</th><th>Стек</th><th>Итог</th></tr>';
    msg.rows.forEach((r) => {
      const tr = document.createElement('tr');
      const cls = r.net > 0 ? 'pos' : (r.net < 0 ? 'neg' : '');
      const sign = r.net > 0 ? '+' : '';
      tr.innerHTML = `<td>${esc(r.name)}</td><td>${fmt(r.buyIn)}</td><td>${fmt(r.stack)}</td><td class="${cls}">${sign}${fmt(r.net)}</td>`;
      table.appendChild(tr);
    });
  }
  m.appendChild(table);

  const row = document.createElement('div'); row.className = 'close-row';
  const exp = document.createElement('button'); exp.className = 'btn-ghost'; exp.textContent = 'Скачать лог сессии';
  exp.onclick = () => socket.send(JSON.stringify({ type: 'export' }));
  const close = document.createElement('button'); close.className = 'btn-gold'; close.textContent = 'Закрыть';
  close.onclick = () => bg.remove();
  row.append(exp, close);
  m.appendChild(row);

  bg.appendChild(m); root.appendChild(bg);
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
}

// выгрузка лога сессии в файл
function downloadExport(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `poker-session-${data.roomId}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Лог сессии скачан');
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// обновление таймер-бара активного места (по абсолютному дедлайну)
// ---------- анимации 5.2 ----------

// Сравнить предыдущий и новый вид, выставить флаги для анимаций.
function computeAnimDiff(prev, next) {
  if (!animEnabled || !next) {
    dealAnimPending = false;
    boardAnimFrom = (next && next.board) ? next.board.length : 0;
    pendingChipMoves = []; pendingPayouts = null;
    return;
  }
  // новая раздача: стадия из «покоя» перешла в префлоп
  const wasIdle = !prev || ['idle', 'complete', 'showdown'].includes(prev.stage);
  dealAnimPending = wasIdle && next.stage === 'preflop';

  // переворот борда: с какого индекса карты новые
  const prevLen = (prev && prev.board) ? prev.board.length : 0;
  const nextLen = (next.board || []).length;
  boardAnimFrom = (nextLen > prevLen && !dealAnimPending) ? prevLen : nextLen;

  // ставки в банк: у кого streetBet вырос
  pendingChipMoves = [];
  if (prev && prev.seats && next.seats) {
    const prevBet = {}; prev.seats.forEach((s) => { prevBet[s.id] = s.streetBet || 0; });
    next.seats.forEach((s) => {
      const before = prevBet[s.id] || 0;
      if ((s.streetBet || 0) > before) pendingChipMoves.push(s.id);
    });
  }

  // выплаты из банка победителям — один раз на раздачу
  pendingPayouts = null;
  const res = next.result;
  if (res && res.payouts && (next.stage === 'showdown' || next.stage === 'complete')) {
    const sig = JSON.stringify(res.payouts) + '|' + (next.board || []).join(',');
    if (sig !== lastPayoutSig) {
      lastPayoutSig = sig;
      pendingPayouts = { winners: Object.keys(res.payouts), premium: !!res.premium };
    }
  }
}

// Найти под игрока по id (для координат анимаций).
function seatElById(pid) { return document.querySelector(`.seat[data-pid="${cssEscape(pid)}"]`); }
function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

// Запустить фишечные анимации после построения DOM.
function runChipAnimations() {
  if (!animEnabled) return;
  const potEl = $('pot');
  if (!potEl) return;
  const potRect = potEl.getBoundingClientRect();
  const potC = { x: potRect.left + potRect.width / 2, y: potRect.top + potRect.height / 2 };

  // ставки -> банк
  pendingChipMoves.forEach((pid) => {
    const el = seatElById(pid); if (!el) return;
    const r = el.getBoundingClientRect();
    flyToken({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, potC);
  });
  pendingChipMoves = [];

  // банк -> победители + подсветка
  if (pendingPayouts) {
    pendingPayouts.winners.forEach((pid) => {
      const el = seatElById(pid); if (!el) return;
      const r = el.getBoundingClientRect();
      flyToken(potC, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      el.classList.add('win');
      if (pendingPayouts.premium) el.classList.add('premium');
    });
    pendingPayouts = null;
  }
}

// Летящая фишка от a к b (координаты экрана).
function flyToken(a, b) {
  const t = document.createElement('div'); t.className = 'fly-token';
  t.style.left = a.x + 'px'; t.style.top = a.y + 'px';
  t.style.transform = 'translate(-50%, -50%)';
  document.body.appendChild(t);
  requestAnimationFrame(() => {
    t.style.transform = `translate(-50%, -50%) translate(${b.x - a.x}px, ${b.y - a.y}px)`;
    t.style.opacity = '0.2';
  });
  setTimeout(() => t.remove(), 650);
}

function updateTimerUI() {
  const fill = document.querySelector('[data-seat-timer]');
  if (!fill || !turnDeadline || !turnTimerSec) return;
  const remain = Math.max(0, turnDeadline - Date.now());
  const frac = Math.max(0, Math.min(1, remain / (turnTimerSec * 1000)));
  fill.style.width = (frac * 100) + '%';
  fill.classList.toggle('low', frac < 0.25);
}

function updateNextHandUI() {
  const label = document.getElementById('nextHandLabel');
  if (!label) return;
  const remain = Math.max(0, Math.ceil((nextHandAt - Date.now()) / 1000));
  label.textContent = `Следующая раздача через ${remain} с`;
}

// ---------- HUD-попап игрока ----------

// Сделать элемент-имя кликабельным под HUD. Если HUD недоступен — клик молча игнорируется
// для чужих и работает только для себя; для чужих с publicHud=true — показывает попап.
function attachHud(el, playerId, name) {
  const isMe = playerId === myPlayerId;
  const allowed = isMe || (lastView && lastView.room && lastView.room.publicHud);
  if (!allowed) return; // никаких визуальных подсказок и кликов для приватного режима у чужих
  el.classList.add('clickable');
  el.onclick = (ev) => {
    ev.stopPropagation();
    const hud = (lastView && lastView.room && lastView.room.hud) || {};
    const metrics = hud[playerId];
    if (!metrics) { toast(isMe ? 'Стата ещё пуста — сыграй раздачу' : 'HUD ещё не собрана'); return; }
    showHudPopup(el, metrics, name);
  };
}

function showHudPopup(anchor, metrics, seatName) {
  closeHudPopup();
  const pop = document.createElement('div'); pop.id = 'hudPopup';
  const fmtPct = (v) => v == null ? '—' : `${v}%`;
  pop.innerHTML = `
    <div class="hud-head">${esc(seatName)}</div>
    <div class="hud-grid">
      <span>Раздач</span><b>${metrics.hands}</b>
      <span>VPIP</span><b>${fmtPct(metrics.vpip)}</b>
      <span>PFR</span><b>${fmtPct(metrics.pfr)}</b>
      <span>ATS</span><b>${fmtPct(metrics.ats)}</b>
      <span>CB</span><b>${fmtPct(metrics.cb)}</b>
      <span>AF</span><b>${metrics.af === 'inf' ? '∞' : (metrics.af != null ? metrics.af : '—')}</b>
    </div>
    ${metrics.hands < 30 ? '<div class="hud-note">мало раздач — стата нестабильна</div>' : ''}
  `;
  document.body.appendChild(pop);
  // позиционируем под якорь, с прижимом к границам окна
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = r.left;
  let top = r.bottom + 6;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (top + h > window.innerHeight - 8) top = r.top - h - 6;
  pop.style.position = 'fixed';
  pop.style.left = Math.max(8, left) + 'px';
  pop.style.top = Math.max(8, top) + 'px';
  // закрытие по клику вне попапа и по Esc
  setTimeout(() => {
    const off = (e) => { if (!pop.contains(e.target)) { closeHudPopup(); document.removeEventListener('click', off); document.removeEventListener('keydown', kd); } };
    const kd = (e) => { if (e.key === 'Escape') { closeHudPopup(); document.removeEventListener('click', off); document.removeEventListener('keydown', kd); } };
    document.addEventListener('click', off);
    document.addEventListener('keydown', kd);
  }, 0);
}
function closeHudPopup() { const p = document.getElementById('hudPopup'); if (p) p.remove(); }

// ---------- турнирный таймер уровня ----------
function updateLevelTimerUI() {
  const el = document.getElementById('levelTimer');
  if (!el) return;
  let remainMs;
  if (levelEndPaused) remainMs = levelPausedMs;
  else if (levelEndAt) remainMs = levelEndAt - Date.now();
  else { el.textContent = '--:--'; return; }
  remainMs = Math.max(0, remainMs);
  const m = Math.floor(remainMs / 60000);
  const s = Math.floor((remainMs % 60000) / 1000);
  el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  el.classList.toggle('low', remainMs < 60000);
}

if (!animEnabled) document.body.classList.add('no-anim');
connect();
