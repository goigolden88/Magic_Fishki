import { useSyncExternalStore } from 'react'
import type { HudView } from '../calc/pokerView'
import { loadHudDetailed, saveHudDetailed, subscribeHudDetailed } from './pokerStorage'

// HUD вечера (#79): строка у места, подробно — по касанию строки (не по картам: свои карты
// подсматривают пальцем), выбор ведущего «HUD видят»

// Строка у места: VPIP/PFR и раздачи; подробно (detailed, #241) — ещё 3-бет: «VPIP/PFR/3B · N», случаев
// 3-бета не было — «—». Мало раздач — приглушена
export function HudLine({ hud, onOpen, detailed = false }: { hud: HudView; onOpen: () => void; detailed?: boolean }) {
  const threeBet = hud.threeBet === null ? '—' : String(hud.threeBet)
  const label = `Статистика: VPIP ${hud.vpip}%, PFR ${hud.pfr}%${detailed ? `, 3-бет ${pct(hud.threeBet)}` : ''}, раздач ${hud.hands} — подробно`
  return (
    <button type="button" className={hud.few ? 'seat-hud few' : 'seat-hud'} aria-label={label} onClick={onOpen}>
      {hud.vpip}/{hud.pfr}
      {detailed && `/${threeBet}`} · {hud.hands}
    </button>
  )
}

const pct = (n: number | null) => (n === null ? '—' : `${n}%`)

// Числа с пояснениями — в карточке у стола и в «Покер за всё время» карточки игрока (#164, #241)
export function HudRows({ hud }: { hud: HudView }) {
  const rows: [string, string, string][] = [
    ['VPIP', pct(hud.vpip), 'входит в раздачу'],
    ['PFR', pct(hud.pfr), 'рейз до флопа'],
    ['AF', hud.af, 'агрессия: рейзы к коллам'],
    ['ATS', pct(hud.ats), 'крадёт блайнды'],
    ['CB', pct(hud.cb), 'ставка на флопе после рейза'],
    ['3-бет', pct(hud.threeBet), 'перерейз до флопа'],
    ['Фолд на 3-бет', pct(hud.foldTo3Bet), 'сбрасывает на перерейз'],
    ['WTSD', pct(hud.wtsd), 'до вскрытия после флопа'],
    ['W$SD', pct(hud.wsd), 'выигрывает на вскрытии'],
    ['bb/100', hud.bb100 ?? '—', 'ББ на сто раздач'],
  ]
  return (
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
  )
}

// Подробно — поверх стола, «Закрыть» или касание карточки; за столом с ботами — «Боты читают: …» (#240)
export function HudCard({ name, hud, onClose }: { name: string; hud: HudView; onClose: () => void }) {
  return (
    <div className="hud-pop" role="dialog" aria-label={`Статистика: ${name}`} onClick={onClose}>
      <strong className="hud-name">{name}</strong>
      <span className="muted">
        Раздач за вечер: {hud.hands}
        {hud.few && <span className="hud-few"> · мало раздач</span>}
      </span>
      <HudRows hud={hud} />
      {hud.read && <span className="muted">Боты читают: {hud.read}</span>}
      <button type="button" className="big wide" onClick={onClose}>
        Закрыть
      </button>
    </div>
  )
}

// «HUD у мест: коротко / подробно» (#243): выбор в «⚙» за столом — на всех столах этого устройства сразу
export function useHudDetailed(): boolean {
  return useSyncExternalStore(subscribeHudDetailed, loadHudDetailed)
}

export function HudDetailField() {
  const detailed = useHudDetailed()
  const options: [boolean, string][] = [
    [false, 'Коротко'],
    [true, 'Подробно'],
  ]
  return (
    <fieldset className="players-pick">
      <legend className="muted">HUD у мест</legend>
      <div className="row">
        {options.map(([value, label]) => (
          <button
            key={label}
            type="button"
            className={detailed === value ? 'big primary grow' : 'big grow'}
            aria-pressed={detailed === value}
            onClick={() => saveHudDetailed(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted">
        {detailed
          ? 'У места — VPIP, PFR, 3-бет и число раздач: «22/18/7 · 45». Только на этом устройстве, за всеми столами.'
          : 'У места — VPIP, PFR и число раздач: «22/18 · 45». Только на этом устройстве, за всеми столами.'}
      </p>
    </fieldset>
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
