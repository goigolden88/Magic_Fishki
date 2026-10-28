import type { HudView } from '../calc/pokerView'

// HUD вечера (#79): строка у места, подробно — по касанию строки (не по картам: свои карты
// подсматривают пальцем), выбор ведущего «HUD видят»

// Короткая строка у места: VPIP/PFR и раздачи; мало раздач — приглушена
export function HudLine({ hud, onOpen }: { hud: HudView; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={hud.few ? 'seat-hud few' : 'seat-hud'}
      aria-label={`Статистика: VPIP ${hud.vpip}%, PFR ${hud.pfr}%, раздач ${hud.hands} — подробно`}
      onClick={onOpen}
    >
      {hud.vpip}/{hud.pfr} · {hud.hands}
    </button>
  )
}

const pct = (n: number | null) => (n === null ? '—' : `${n}%`)

// Подробно — поверх стола, «Закрыть» или касание карточки
export function HudCard({ name, hud, onClose }: { name: string; hud: HudView; onClose: () => void }) {
  const rows: [string, string, string][] = [
    ['VPIP', pct(hud.vpip), 'входит в раздачу'],
    ['PFR', pct(hud.pfr), 'рейз до флопа'],
    ['AF', hud.af, 'агрессия: рейзы к коллам'],
    ['ATS', pct(hud.ats), 'крадёт блайнды'],
    ['CB', pct(hud.cb), 'ставка на флопе после рейза'],
  ]
  return (
    <div className="hud-pop" role="dialog" aria-label={`Статистика: ${name}`} onClick={onClose}>
      <strong className="hud-name">{name}</strong>
      <span className="muted">
        Раздач за вечер: {hud.hands}
        {hud.few && <span className="hud-few"> · мало раздач</span>}
      </span>
      <dl className="hud-rows">
        {rows.map(([label, value, hint]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <strong>{value}</strong> <span className="muted">{hint}</span>
            </dd>
          </div>
        ))}
      </dl>
      <button type="button" className="big wide" onClick={onClose}>
        Закрыть
      </button>
    </div>
  )
}

// «HUD видят»: все или каждый только свою — у новой комнаты и в «Настройках стола» ведущего
export function HudFields({ all, onChange, disabled }: { all: boolean; onChange: (all: boolean) => void; disabled?: boolean }) {
  const options: [boolean, string][] = [
    [false, 'Только свою'],
    [true, 'Все'],
  ]
  return (
    <fieldset className="players-pick">
      <legend className="muted">Статистику игроков (HUD) видят</legend>
      <div className="row">
        {options.map(([value, label]) => (
          <button
            key={label}
            type="button"
            className={all === value ? 'big primary grow' : 'big grow'}
            aria-pressed={all === value}
            disabled={disabled}
            onClick={() => onChange(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted">
        {all ? 'Каждый видит статистику всех за столом.' : 'Каждый видит только свою статистику, у чужих мест — ничего.'}
      </p>
    </fieldset>
  )
}
