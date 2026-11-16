import { AUTO_START_LABELS, autoStartNote, timeBankNote, TURN_PRESETS, turnChoiceOf, turnSecondsOf, type TurnChoice } from '../calc/pokerTimer'
import { TIME_BANK_PRESETS, TURN_MAX_S, TURN_MIN_S, type AutoStart } from '../poker/table'

// «Время на ход», «Запас времени» (#223) и «Следующая раздача сама» (#75) — у новой комнаты и в настройках стола ведущего.
// bank — запас, секунд; null — выкл. При «Время на ход: Выкл» поля запаса нет и он не уходит (timeBankOf)
export type TimerForm = { choice: TurnChoice; text: string; bank: number | null; autoStart: AutoStart }

export function timerForm(turnSeconds: number | null, autoStart: AutoStart, timeBank: number | null = null): TimerForm {
  return { ...turnChoiceOf(turnSeconds), bank: timeBank, autoStart }
}

const TURN_OPTIONS: [TurnChoice, string][] = [
  ['off', 'Выкл'],
  ...TURN_PRESETS.map((s): [TurnChoice, string] => [s, `${s} с`]),
  ['custom', 'Своё'],
]

const BANK_OPTIONS: [number | null, string][] = [[null, 'Выкл'], ...TIME_BANK_PRESETS.map((s): [number, string] => [s, `${s} с`])]

export function TimerFields({ form, onChange }: { form: TimerForm; onChange: (form: TimerForm) => void }) {
  const turn = turnSecondsOf(form.choice, form.text)
  return (
    <>
      <fieldset className="players-pick">
        <legend className="muted">Время на ход</legend>
        <div className="amounts">
          {TURN_OPTIONS.map(([choice, label]) => (
            <button
              key={label}
              type="button"
              className={form.choice === choice ? 'big primary' : 'big'}
              aria-pressed={form.choice === choice}
              onClick={() => onChange({ ...form, choice })}
            >
              {label}
            </button>
          ))}
        </div>
        {form.choice === 'custom' && (
          <label className="field">
            Своё, секунд — от {TURN_MIN_S} до {TURN_MAX_S}
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              value={form.text}
              onChange={(e) => onChange({ ...form, text: e.target.value })}
            />
          </label>
        )}
        {!turn.ok && form.text.trim() !== '' && <p className="warn">{turn.error}</p>}
        <p className="muted">
          {form.choice === 'off'
            ? 'Без таймера: ход за отошедшего пропускает ведущий.'
            : 'Время вышло — за игрока чек, если можно, иначе пас; два раза подряд — он пропускает раздачи.'}
        </p>
      </fieldset>
      {form.choice !== 'off' && (
        <fieldset className="players-pick">
          <legend className="muted">Запас времени</legend>
          <div className="amounts">
            {BANK_OPTIONS.map(([bank, label]) => (
              <button
                key={label}
                type="button"
                className={form.bank === bank ? 'big primary' : 'big'}
                aria-pressed={form.bank === bank}
                onClick={() => onChange({ ...form, bank })}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="muted">{timeBankNote(form.bank)}.</p>
        </fieldset>
      )}
      <AutoStartField value={form.autoStart} onChange={(autoStart) => onChange({ ...form, autoStart })} />
    </>
  )
}

// «Следующая раздача сама» — у комнаты и у стола «Против ботов» (#156)
export function AutoStartField({ value, onChange }: { value: AutoStart; onChange: (mode: AutoStart) => void }) {
  return (
    <fieldset className="players-pick">
      <legend className="muted">Следующая раздача сама</legend>
      <div className="amounts">
        {AUTO_START_LABELS.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={value === mode ? 'big primary' : 'big'}
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted">{autoStartNote(value)}.</p>
    </fieldset>
  )
}
