// Переподключение игрока к своему месту после обрыва/перезагрузки.
// Чистый модуль без сети — server.js хранит карту токенов и зовёт canRejoin.
//
// Контракт безопасности: токен — секрет, известный только владельцу места.
// Знания playerId недостаточно для захвата чужого места: нужен совпадающий токен,
// и место должно всё ещё существовать за столом (не удалено хостом, игрок не вылетел).

const crypto = require('crypto');

// Непредсказуемый токен сессии игрока (для localStorage клиента).
function issueToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Можно ли пустить игрока обратно на его место.
// tokens  — карта { playerId -> token } для комнаты
// players — core.game.players (массив с .id)
function canRejoin(tokens, players, playerId, token) {
  if (!playerId || !token) return { ok: false, reason: 'no_creds' };
  const expected = tokens[playerId];
  if (!expected) return { ok: false, reason: 'unknown_player' };
  if (expected !== token) return { ok: false, reason: 'bad_token' };
  const seated = players.some((p) => p.id === playerId);
  if (!seated) return { ok: false, reason: 'not_seated' };
  return { ok: true };
}

module.exports = { issueToken, canRejoin };
