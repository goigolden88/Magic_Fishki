// Диагностика файлов UI-1.2. Запуск: node test/check-ui12.js
const fs = require('fs');
const path = require('path');
function has(file, marker) {
  try { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8').includes(marker); }
  catch { return null; }
}
function tryReq(p) { try { return require(p); } catch { return null; } }
const room = tryReq('../src/poker/room');

const checks = [
  ['room.js: настройка turnTimerSec', !!(room && room.DEFAULT_SETTINGS && 'turnTimerSec' in room.DEFAULT_SETTINGS)],
  ['room.js: функция removePlayer', !!(room && typeof room.removePlayer === 'function')],
  ['server.js: таймер хода (manageTurnTimer)', has('server.js', 'manageTurnTimer')],
  ['server.js: дедлайн в рассылке (turnDeadline)', has('server.js', 'turnDeadline')],
  ['server.js: удаление игрока (removePlayer)', has('server.js', "msg.type === 'removePlayer'")],
  ['server.js: автозапуск (maybeAutoStart)', has('server.js', 'maybeAutoStart')],
  ['client.js: отсчёт таймера (updateTimerUI)', has('public/client.js', 'updateTimerUI')],
  ['client.js: автозапуск (nextHandAt)', has('public/client.js', 'nextHandAt')],
  ['index.html: настройка таймера (turnTimer)', has('public/index.html', 'turnTimer')],
];

let bad = 0;
console.log('\nПроверка файлов UI-1.2:\n');
for (const [name, ok] of checks) { console.log((ok ? '✅' : '❌') + ' ' + name); if (!ok) bad++; }
console.log(bad === 0
  ? '\n✅ Все файлы UI-1.2 на месте.'
  : `\n❌ Устаревших/недостающих: ${bad}. Замените отмеченные ❌ файлы свежими версиями.`);