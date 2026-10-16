// Детерминированный прогон полной раздачи (хедз-ап) с фиксированной колодой.
// Запуск: node test/run-hand.js
const engine = require('../src/poker/engine');
const holdem = require('../src/poker/variants/holdem');

// Порядок раздачи (2 игрока): deck[0]=p0c1, deck[1]=p1c1, deck[2]=p0c2, deck[3]=p1c2,
// затем burn, flop(3), burn, turn, burn, river.
// p0 = As Ah (тузы), p1 = Kd Kc (короли). Борд: 2c 7d 9s | Jh | Ad.
// На ривере приходит Ad -> p0 собирает сет тузов и побеждает.
const deck = [
  'As', 'Kd', 'Ah', 'Kc',       // личные
  '3c', '2c', '7d', '9s',       // burn + flop
  '4c', 'Jh',                   // burn + turn
  '5c', 'Ad',                   // burn + river
  '6c', '8d',                   // запас
];

const game = engine.createGame(holdem);
engine.addPlayer(game, { id: 'p0', name: 'Алиса', chips: 1000 });
engine.addPlayer(game, { id: 'p1', name: 'Борис', chips: 1000 });

function show(label) {
  const v = engine.viewFor(game, 'p0');
  const seats = v.seats
    .map((s) => `${s.name}: ${s.chips}ф bet=${s.streetBet}${s.folded ? ' FOLD' : ''}${s.allIn ? ' ALLIN' : ''}`)
    .join(' | ');
  console.log(`\n[${label}] stage=${v.stage} pot=${v.pot} toAct=${v.toAct ?? '-'} board=[${v.board.join(' ')}]`);
  console.log('  ' + seats);
}

function act(pid, action) {
  const r = engine.applyAction(game, pid, action);
  if (!r.ok) {
    console.log(`  !! отклонено (${pid}): ${r.error}`);
    process.exitCode = 1;
  }
  return r;
}

engine.startHand(game, { sb: 5, bb: 10, deckOverride: deck });
show('Старт префлоп'); // SB=Алиса(кнопка,хедз-ап) 5, BB=Борис 10, ход Алисы

act('p0', { type: 'call' });          // Алиса уравнивает до 10
act('p1', { type: 'check' });         // Борис (BB) чек -> флоп
show('Флоп');

act('p1', { type: 'check' });         // постфлоп первый ход у Бориса (не кнопка)
act('p0', { type: 'check' });         // -> тёрн
show('Тёрн');

act('p1', { type: 'check' });
act('p0', { type: 'raise', amount: 20 }); // Алиса ставит 20
act('p1', { type: 'call' });              // Борис уравнивает -> ривер
show('Ривер');

act('p1', { type: 'check' });
act('p0', { type: 'check' });             // -> вскрытие
show('После вскрытия');

const res = game.hand.result;
console.log('\n=== РЕЗУЛЬТАТ ===');
console.log('Победитель(и):', res.winnerIds.join(', '));
console.log('Комбинации:', JSON.stringify(res.results));
console.log('Премиальная рука:', res.premium);
console.log('Выплаты:', JSON.stringify(res.payouts));

const alice = game.players.find((p) => p.id === 'p0').chips;
const boris = game.players.find((p) => p.id === 'p1').chips;
console.log(`\nИтоговые стеки: Алиса=${alice}, Борис=${boris}`);

const ok = res.winnerIds.length === 1 && res.winnerIds[0] === 'p0' && alice === 1030 && boris === 970;
console.log(ok ? '\n✅ ТЕСТ ПРОЙДЕН' : '\n❌ ТЕСТ ПРОВАЛЕН (ожидалось Алиса=1030, Борис=970)');
if (!ok) process.exitCode = 1;
