// Модуль "формат" (ось экономики стола): кеш и турнир.
// Добавлена пауза: для турнира она замораживает часы уровней, сдвигая startedAt
// на длительность перерыва, чтобы блайнды не перескочили. serialize() даёт
// конфиг для восстановления формата из снимка на диске.

function cashFormat({ sb, bb, ante = 0 }) {
  return {
    type: 'cash',
    blinds() {
      return { sb, bb, ante, level: null, msToNext: null };
    },
    pause() {},   // в кеше часов нет — перерыв обслуживается флагом комнаты
    resume() {},
    startClock() {}, // в кеше часов нет
    serialize() {
      return { type: 'cash', sb, bb, ante };
    },
  };
}

function tournamentFormat({ levels, startedAt = null, pausedAt = null }) {
  return {
    type: 'tournament',
    levels,
    startedAt,    // null = часы ещё не запущены (стол не стартовал)
    pausedAt,
    // Запустить часы уровней (вызывается при первой раздаче).
    startClock(now = Date.now()) {
      if (this.startedAt == null) this.startedAt = now;
    },
    blinds(now = Date.now()) {
      // часы ещё не запущены — показываем первый уровень целиком, без отсчёта
      if (this.startedAt == null) {
        const l0 = this.levels[0];
        return { sb: l0.sb, bb: l0.bb, ante: l0.ante || 0, level: 1, msToNext: l0.durationSec * 1000 };
      }
      // во время паузы считаем время "замороженным" на момент паузы
      const ref = this.pausedAt != null ? this.pausedAt : now;
      let elapsed = (ref - this.startedAt) / 1000;
      for (let i = 0; i < this.levels.length; i++) {
        const lvl = this.levels[i];
        if (elapsed < lvl.durationSec) {
          return {
            sb: lvl.sb, bb: lvl.bb, ante: lvl.ante || 0,
            level: i + 1,
            msToNext: Math.ceil((lvl.durationSec - elapsed) * 1000),
          };
        }
        elapsed -= lvl.durationSec;
      }
      const last = this.levels[this.levels.length - 1];
      return { sb: last.sb, bb: last.bb, ante: last.ante || 0, level: this.levels.length, msToNext: null };
    },
    pause(now = Date.now()) {
      if (this.startedAt == null) return; // часы не идут — нечего замораживать
      if (this.pausedAt == null) this.pausedAt = now;
    },
    resume(now = Date.now()) {
      if (this.pausedAt != null) {
        this.startedAt += now - this.pausedAt; // сдвигаем старт на длительность перерыва
        this.pausedAt = null;
      }
    },
    serialize() {
      return { type: 'tournament', levels: this.levels, startedAt: this.startedAt, pausedAt: this.pausedAt };
    },
  };
}

// Классическая рум-шкала блайндов (малый/большой), масштабируется от стартового ББ.
const CLASSIC_SCALE = [
  [0.5, 1], [0.75, 1.5], [1, 2], [1.5, 3], [2, 5], [3, 6], [5, 10], [7.5, 15],
  [10, 20], [15, 30], [20, 40], [30, 60], [50, 100], [75, 150], [100, 200],
];

// Построить расписание уровней турнира из настроек лобби.
//   scheme: 'classic' | 'percent'
//   startSB, startBB, antePct (% от ББ), levelMinutes, growthPct (для percent)
function buildTournamentLevels({ scheme = 'percent', startSB = 10, startBB = 20, antePct = 0, levelMinutes = 10, growthPct = 100, count = 15 }) {
  const durationSec = Math.max(1, levelMinutes) * 60;
  const levels = [];
  if (scheme === 'classic') {
    // привязываем шкалу к стартовому ББ: множитель = startBB / базовый ББ первого уровня с таким же отношением
    const baseBB = 20; // опорный ББ в шкале (строка [10,20])
    const k = startBB / baseBB;
    for (const [sb, bb] of CLASSIC_SCALE) {
      const big = Math.round(bb * k);
      const small = Math.round(sb * k);
      if (big < startBB) continue; // начинаем не ниже заданного старта
      levels.push({ sb: small, bb: big, ante: Math.round(big * antePct / 100), durationSec });
      if (levels.length >= count) break;
    }
    if (!levels.length) levels.push({ sb: startSB, bb: startBB, ante: Math.round(startBB * antePct / 100), durationSec });
  } else {
    // проценты: каждый уровень = предыдущий × (1 + growthPct/100)
    let sb = startSB, bb = startBB;
    const factor = 1 + growthPct / 100;
    for (let i = 0; i < count; i++) {
      levels.push({ sb: Math.round(sb), bb: Math.round(bb), ante: Math.round(bb * antePct / 100), durationSec });
      sb *= factor; bb *= factor;
    }
  }
  return levels;
}

function createFormat(config = {}) {
  if (config.type === 'tournament') {
    // если переданы параметры структуры — строим уровни; иначе берём готовые levels
    if (config.structure) config = { ...config, levels: buildTournamentLevels(config.structure) };
    return tournamentFormat(config);
  }
  return cashFormat({ sb: config.sb ?? 5, bb: config.bb ?? 10, ante: config.ante ?? 0 });
}

module.exports = { createFormat, cashFormat, tournamentFormat, buildTournamentLevels };
