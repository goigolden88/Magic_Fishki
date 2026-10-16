// Диагностика: проверяет, что файлы 3c обновлены. Запуск: node test/check-3c.js
const fs = require('fs');
const path = require('path');

function fileHas(file, marker) {
  try { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8').includes(marker); }
  catch { return null; } // null = файл не найден
}
function tryReq(p) { try { return require(p); } catch { return null; } }

const engine = tryReq('../src/poker/engine');
const room = tryReq('../src/poker/room');

const checks = [
  ['engine.js: функция runOut', engine && typeof engine.runOut === 'function'],
  ['room.js: функция runOut', room && typeof room.runOut === 'function'],
  ['room.js: настройка maxRuns', !!(room && room.DEFAULT_SETTINGS && room.DEFAULT_SETTINGS.maxRuns)],
  ["server.js: обработка 'runout' (afterEngineResult)", fileHas('server.js', 'afterEngineResult')],
  ["server.js: голосование 'ritVote'", fileHas('server.js', 'ritVote')],
  ["server.js: ожидание прогонов (pendingRunout)", fileHas('server.js', 'pendingRunout')],
];

let stale = 0;
console.log('\nПроверка файлов 3c:\n');
for (const [name, ok] of checks) {
  console.log((ok ? '✅' : '❌') + ' ' + name);
  if (!ok) stale++;
}
console.log(stale === 0
  ? '\n✅ Все файлы 3c на месте — можно запускать node test/runittwice.js'
  : `\n❌ Устаревших/недостающих мест: ${stale}. Замените отмеченные ❌ файлы свежими версиями из последних двух шагов.`);
