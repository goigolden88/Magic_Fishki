import { useState, type ReactNode } from 'react'
import { DECK_LABELS, deckOf, FACE_LABELS, faceOf, MY_BACK_LABELS, MY_FELT_LABELS, type MyLook } from '../calc/pokerLook'
import {
  DOCK_SIZE_DEFAULT,
  DOCK_SIZE_LABELS,
  TABLE_SIZE_DEFAULT,
  TABLE_SIZE_MAX,
  TABLE_SIZE_MIN,
  TABLE_SIZE_STEP,
} from '../calc/tableFit'
import { PlayingCard } from './PokerRoom'
import { loadDockSizeChoice, loadTableSizeChoice, saveDockSize, saveMyLook, saveTableSize } from './pokerStorage'
import { useWide } from './useWide'

// Поля личного «Вида стола» (Р-61) — одни на «Настройки» и «⚙» за столом (#243): сукно, рубашка, колода, лицо карт;
// на широком окне (Р-63) — размер стола покера и панели ставок. Сохраняется сразу (saveMyLook) и действует
// на всех столах этого телефона; onChange — новый вид для того, кто его показывает
export function MyLookFields({ look, onChange }: { look: MyLook; onChange: (look: MyLook) => void }) {
  const wide = useWide()

  function update(change: Partial<MyLook>) {
    const next = { ...look, ...change }
    saveMyLook(next)
    onChange(next)
  }

  return (
    <>
      <fieldset className="players-pick">
        <legend className="muted">Сукно</legend>
        <div className="amounts">
          <LookChoice on={look.felt === null} onPick={() => update({ felt: null })}>
            Как у стола
          </LookChoice>
          {MY_FELT_LABELS.map(([felt, label]) => (
            <LookChoice key={felt} on={look.felt === felt} onPick={() => update({ felt })}>
              <span className={`look-swatch felt-${felt}`} aria-hidden="true" />
              {label}
            </LookChoice>
          ))}
        </div>
      </fieldset>
      <fieldset className="players-pick">
        <legend className="muted">Рубашка</legend>
        <div className="amounts">
          <LookChoice on={look.cardBack === null} onPick={() => update({ cardBack: null })}>
            Как у стола
          </LookChoice>
          {MY_BACK_LABELS.map(([back, label]) => (
            <LookChoice key={back} on={look.cardBack === back} onPick={() => update({ cardBack: back })}>
              <span className={`look-back back-${back}`} aria-hidden="true">
                <span className="playing-card small back" />
              </span>
              {label}
            </LookChoice>
          ))}
        </div>
      </fieldset>
      <fieldset className="players-pick">
        <legend className="muted">Колода</legend>
        <div className="amounts">
          {DECK_LABELS.map(([deck, label]) => (
            <LookChoice key={deck} on={deckOf(look) === deck} onPick={() => update({ deck })}>
              {label}
            </LookChoice>
          ))}
        </div>
        <div className="card-row deck-sample" aria-hidden="true">
          {DECK_SAMPLE.map((c) => (
            <PlayingCard key={c} card={c} size="mid" />
          ))}
        </div>
      </fieldset>
      <fieldset className="players-pick">
        <legend className="muted">Лицо карт</legend>
        <div className="amounts">
          {FACE_LABELS.map(([face, label]) => (
            <LookChoice key={face} on={faceOf(look) === face} onPick={() => update({ face })}>
              {label}
            </LookChoice>
          ))}
        </div>
      </fieldset>
      {wide && <TableFitFields />}
    </>
  )
}

// Размер стола покера и панели ставок (Р-63) — только на широком окне: на телефоне и планшете маленький стол
// с девятью–десятью местами наезжал бы местами, а маленькая панель — кнопками меньше пальца.
// Сохраняется сразу и действует на всех столах этого устройства; «Сбросить» — во всё место и «Средняя»
function TableFitFields() {
  const [size, setSize] = useState(loadTableSizeChoice)
  const [dock, setDock] = useState(loadDockSizeChoice)
  const shown = size ?? TABLE_SIZE_DEFAULT

  return (
    <>
      <fieldset className="players-pick">
        <legend className="muted">Размер стола</legend>
        <label className="field">
          {shown} %{shown === TABLE_SIZE_MAX ? ' — во всё место' : ''}
          <input
            type="range"
            className="bet-range"
            min={TABLE_SIZE_MIN}
            max={TABLE_SIZE_MAX}
            step={TABLE_SIZE_STEP}
            value={shown}
            onChange={(e) => {
              const next = Number(e.target.value)
              setSize(next)
              saveTableSize(next)
            }}
          />
        </label>
        <p className="muted">
          Доля места, которое стол занимает на экране: 100 % — всё, что есть, меньше — стол по центру. Больше 100 % нельзя —
          стол перестал бы помещаться в окно.
        </p>
      </fieldset>
      <fieldset className="players-pick">
        <legend className="muted">Панель ставок</legend>
        <div className="amounts">
          {DOCK_SIZE_LABELS.map(([id, label]) => (
            <LookChoice
              key={id}
              on={(dock ?? DOCK_SIZE_DEFAULT) === id}
              onPick={() => {
                setDock(id)
                saveDockSize(id)
              }}
            >
              {label}
            </LookChoice>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        className="big wide"
        disabled={size === null && dock === null}
        onClick={() => {
          setSize(null)
          setDock(null)
          saveTableSize(null)
          saveDockSize(null)
        }}
      >
        Сбросить размер стола и панели
      </button>
    </>
  )
}

// Образец колоды: по карте каждой масти
const DECK_SAMPLE = ['As', 'Kh', 'Qd', 'Jc']

export function LookChoice(props: { on: boolean; onPick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={props.on ? 'big primary' : 'big'} aria-pressed={props.on} onClick={props.onPick}>
      {props.children}
    </button>
  )
}
