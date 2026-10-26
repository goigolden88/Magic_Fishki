import { AUTO_START_LABELS, autoStartNote, TURN_PRESETS, turnChoiceOf, turnSecondsOf, type TurnChoice } from '../calc/pokerTimer'
import { TURN_MAX_S, TURN_MIN_S, type AutoStart } from '../poker/table'

// «Время на ход» и «Следующая раздача сама» (#75) — у новой комнаты и в настройках стола ведущего
export type TimerForm = { choice: TurnChoice; text: string; autoStart: AutoStart }

export function timerForm(turnSeconds: number | null, autoStart: AutoStart): TimerForm {
  return { ...turnChoiceOf(turnSeconds), autoStart }
}

const TURN_OPTIONS: [TurnChoice, string][] = [
  ['off', 'Выкл'],
  ...TURN_PRESETS.map((s): [TurnChoice, string] => [s, `${s} с`]),
  ['custom', 'Своё'],
]

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
      <fieldset className="players-pick">
        <legend className="muted">Следующая раздача сама</legend>
        <div className="amounts">
          {AUTO_START_LABELS.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={form.autoStart === mode ? 'big primary' : 'big'}
              aria-pressed={form.autoStart === mode}
              onClick={() => onChange({ ...form, autoStart: mode })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="muted">{autoStartNote(form.autoStart)}.</p>
      </fieldset>
    </>
  )
}
