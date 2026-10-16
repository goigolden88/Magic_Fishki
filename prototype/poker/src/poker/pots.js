// Построение банков (основной + боковые) из вкладов игроков.
// Вход: [{ id, committed, folded }]. Выход: [{ amount, eligible:[id,...] }].
//
// Идея слоёв: сортируем уровни вкладов по возрастанию. Каждый слой между
// соседними уровнями оплачивают все, кто вложил не меньше этого уровня; бороться
// за слой могут только не сбросившие карты. Непокрытая ставка автоматически
// возвращается через слой, где претендент один. Деньги фолдеров остаются
// в банке (мёртвые), но фолдеры не претендуют на выигрыш.

function sameSet(a, b) {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

// Сливаем соседние банки с одинаковым составом претендентов; слой без
// претендентов (все сбросили) присоединяем к предыдущему банку.
function mergePots(pots) {
  const out = [];
  for (const p of pots) {
    if (p.eligible.length === 0) {
      if (out.length) out[out.length - 1].amount += p.amount;
      else out.push({ amount: p.amount, eligible: [] });
      continue;
    }
    const last = out[out.length - 1];
    if (last && sameSet(last.eligible, p.eligible)) last.amount += p.amount;
    else out.push({ amount: p.amount, eligible: p.eligible.slice() });
  }
  return out;
}

function buildPots(seats) {
  const levels = [...new Set(seats.filter((s) => s.committed > 0).map((s) => s.committed))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const L of levels) {
    const contributors = seats.filter((s) => s.committed >= L);
    const amount = (L - prev) * contributors.length;
    const eligible = contributors.filter((s) => !s.folded).map((s) => s.id);
    pots.push({ amount, eligible });
    prev = L;
  }
  return mergePots(pots);
}

module.exports = { buildPots, mergePots, sameSet };
