// Тесты модуля переподключения.
// Запуск: node test/reconnect.js  (или рядом, если положить туда же)

let reconnect;
try { reconnect = require('../src/poker/reconnect'); }
catch (e) { reconnect = require('./reconnect'); }

let failed = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`✗ ${label}: got ${a}, expected ${e}`); failed++; }
  else console.log(`✓ ${label}`);
}

// --- issueToken ---
{
  const t1 = reconnect.issueToken();
  const t2 = reconnect.issueToken();
  eq(typeof t1, 'string', 'токен — строка');
  eq(t1.length, 32, 'токен 32 hex-символа (16 байт)');
  eq(t1 !== t2, true, 'два токена различны');
}

const players = [{ id: 'pAAA' }, { id: 'pBBB' }];
const tokens = { pAAA: 'tok-alice', pBBB: 'tok-bob' };

// --- успешный возврат ---
eq(reconnect.canRejoin(tokens, players, 'pAAA', 'tok-alice'), { ok: true }, 'верный токен + место на месте → ok');

// --- неверный токен (попытка захвата места) ---
eq(reconnect.canRejoin(tokens, players, 'pAAA', 'tok-bob'), { ok: false, reason: 'bad_token' }, 'чужой токен → bad_token');

// --- неизвестный игрок ---
eq(reconnect.canRejoin(tokens, players, 'pZZZ', 'whatever'), { ok: false, reason: 'unknown_player' }, 'нет токена для id → unknown_player');

// --- место удалено / игрок вылетел ---
eq(reconnect.canRejoin(tokens, [{ id: 'pBBB' }], 'pAAA', 'tok-alice'), { ok: false, reason: 'not_seated' }, 'место исчезло → not_seated даже с верным токеном');

// --- пустые креды ---
eq(reconnect.canRejoin(tokens, players, null, null), { ok: false, reason: 'no_creds' }, 'нет credentials → no_creds');
eq(reconnect.canRejoin(tokens, players, 'pAAA', ''), { ok: false, reason: 'no_creds' }, 'пустой токен → no_creds');

console.log(failed === 0 ? '\n✓ Все тесты прошли' : `\n✗ Провалено: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
