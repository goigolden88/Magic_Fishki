import { CARD_BACK_LABELS, FELT_LABELS, type Look } from '../calc/pokerLook'

// «Сукно» и «Рубашка карт» (#77) — у новой комнаты, нового стола на телефоне и у ведущего за столом.
// backs — показывать ли рубашку: на одном телефоне карты живые (Р-21), рубашек там нет
export function LookFields(props: { look: Look; backs: boolean; onChange: (look: Partial<Look>) => void; disabled?: boolean }) {
  const { look, backs, onChange, disabled } = props
  return (
    <>
      <fieldset className="players-pick">
        <legend className="muted">Сукно</legend>
        <div className="amounts">
          {FELT_LABELS.map(([felt, label]) => (
            <button
              key={felt}
              type="button"
              className={look.felt === felt ? 'big primary' : 'big'}
              aria-pressed={look.felt === felt}
              disabled={disabled}
              onClick={() => onChange({ felt })}
            >
              <span className={`look-swatch felt-${felt}`} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      {backs && (
        <fieldset className="players-pick">
          <legend className="muted">Рубашка карт</legend>
          <div className="amounts">
            {CARD_BACK_LABELS.map(([back, label]) => (
              <button
                key={back}
                type="button"
                className={look.cardBack === back ? 'big primary' : 'big'}
                aria-pressed={look.cardBack === back}
                disabled={disabled}
                onClick={() => onChange({ cardBack: back })}
              >
                <span className={`look-back back-${back}`} aria-hidden="true">
                  <span className="playing-card small back" />
                </span>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </>
  )
}
