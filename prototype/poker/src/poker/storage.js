// Хранение на диск: снимок состояния комнаты, журнал завершённых раздач,
// экспорт и автоочистка файлов старше 3 дней. Файлы лежат в poker/sessions/.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'sessions');
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

const snapPath = (id) => path.join(DIR, `room-${id}.snapshot.json`);
const logPath = (id) => path.join(DIR, `room-${id}.log.jsonl`);

// Снимок полного состояния (для восстановления — будет задействован в Фазе 4).
function saveSnapshot(id, obj) {
  ensureDir();
  fs.writeFileSync(snapPath(id), JSON.stringify(obj));
}
function loadSnapshot(id) {
  try { return JSON.parse(fs.readFileSync(snapPath(id), 'utf8')); }
  catch { return null; }
}

// Журнал: по строке JSON на каждую завершённую раздачу (формат JSON Lines).
function appendHand(id, rec) {
  ensureDir();
  fs.appendFileSync(logPath(id), JSON.stringify(rec) + '\n');
}
function readJournal(id) {
  try {
    return fs.readFileSync(logPath(id), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

// Экспорт сессии для анализа: вся история раздач + итоговая сводка.
function exportSession(id, summary) {
  return { roomId: id, exportedAt: new Date().toISOString(), summary, hands: readJournal(id) };
}

function deleteRoomFiles(id) {
  for (const p of [snapPath(id), logPath(id)]) {
    try { fs.unlinkSync(p); } catch {}
  }
}

// Удаляет файлы старше maxAgeMs. Вызывается при старте сервера и раз в сутки.
function cleanupOld(maxAgeMs = THREE_DAYS_MS, now = Date.now()) {
  ensureDir();
  let removed = 0;
  for (const f of fs.readdirSync(DIR)) {
    const fp = path.join(DIR, f);
    try {
      const st = fs.statSync(fp);
      if (now - st.mtimeMs > maxAgeMs) { fs.unlinkSync(fp); removed += 1; }
    } catch {}
  }
  return removed;
}

module.exports = {
  DIR, THREE_DAYS_MS, ensureDir,
  saveSnapshot, loadSnapshot, appendHand, readJournal,
  exportSession, deleteRoomFiles, cleanupOld, snapPath, logPath,
};
