import { useRef, useState, type ReactNode } from 'react'
import {
  DECK_LABELS,
  deckOf,
  FACE_LABELS,
  faceOf,
  MY_BACK_LABELS,
  MY_FELT_LABELS,
  drawnAvatar,
  drawnBack,
  OWN_BACK,
  type MyLook,
} from '../calc/pokerLook'
import { OWN_AVATAR, type AvatarChoice } from '../poker/avatar'
import { Avatar, AVATAR_LABELS } from './Avatar'
import { compressAvatar, compressOwnBack, setOwnBack } from './ownBackImage'
import {
  DOCK_SIZE_DEFAULT,
  DOCK_SIZE_LABELS,
  TABLE_SIZE_DEFAULT,
  TABLE_SIZE_MAX,
  TABLE_SIZE_MIN,
  TABLE_SIZE_STEP,
} from '../calc/tableFit'
import { PlayingCard, useLookVersion } from './PokerRoom'
import {
  hasOwnBack,
  loadAvatarPicture,
  loadAvatarsShown,
  loadDockSizeChoice,
  loadTableSizeChoice,
  saveAvatarPicture,
  saveAvatarsShown,
  saveDockSize,
  saveMyLook,
  saveTableSize,
} from './pokerStorage'
import { useWide } from './useWide'

// Поля личного «Вида стола» (Р-61) — одни на «Настройки» и «⚙» за столом (#243): сукно, рубашка (и своя картинкой, #220),
// колода, лицо карт, аватарка (#298);
// на широком окне (Р-63) — размер стола покера и панели ставок. Сохраняется сразу (saveMyLook) и действует
// на всех столах этого телефона; onChange — новый вид для того, кто его показывает
export function MyLookFields({ look, onChange }: { look: MyLook; onChange: (look: MyLook) => void }) {
  const wide = useWide()
  useLookVersion() // своя картинка появилась или удалена — «Своя» и «Удалить» показываются сразу
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [ownError, setOwnError] = useState('')
  const own = hasOwnBack()
  const back = drawnBack(look, own) // «Своя» без картинки — «Как у стола»

  function update(change: Partial<MyLook>) {
    const next = { ...look, ...change }
    saveMyLook(next)
    onChange(next)
  }

  // Своя рубашка (#220): файл сжимается здесь же; новый заменяет прежний; ошибка — строкой, прежняя рубашка остаётся
  async function pickOwn(file: File) {
    setBusy(true)
    setOwnError('')
    try {
      const r = await compressOwnBack(file)
      if (!r.ok) setOwnError(r.error)
      else if (!setOwnBack(r.url)) setOwnError('Не хватило места на устройстве — рубашка не сохранена')
      else update({ cardBack: OWN_BACK })
    } finally {
      setBusy(false)
    }
  }

  // Удалили — картинки нет, рубашка «Как у стола»; выбранная встроенная остаётся
  function removeOwn() {
    setOwnError('')
    if (!setOwnBack(null)) {
      setOwnError('Не удалось удалить — попробуйте ещё раз')
      return
    }
    if (look.cardBack === OWN_BACK) update({ cardBack: null })
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
          <LookChoice on={back === null} onPick={() => update({ cardBack: null })}>
            Как у стола
          </LookChoice>
          {MY_BACK_LABELS.map(([id, label]) => (
            <LookChoice key={id} on={back === id} onPick={() => update({ cardBack: id })}>
              <span className={`look-back back-${id}`} aria-hidden="true">
                <span className="playing-card small back" />
              </span>
              {label}
            </LookChoice>
          ))}
          {own && (
            <LookChoice on={back === OWN_BACK} onPick={() => update({ cardBack: OWN_BACK })}>
              <span className="look-back back-own" aria-hidden="true">
                <span className="playing-card small back" />
              </span>
              Своя
            </LookChoice>
          )}
          <button type="button" className="big" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Сжимаю…' : 'Своя картинка…'}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="own-back-file"
          aria-label="Картинка для своей рубашки"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = '' // тот же файл ещё раз — снова сработает
            if (file) void pickOwn(file)
          }}
        />
        {ownError && <p className="warn">{ownError}</p>}
        {own && (
          <button type="button" className="big wide danger-text" onClick={removeOwn}>
            Удалить свою рубашку
          </button>
        )}
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
      <AvatarFields look={look} onPick={(avatar) => update({ avatar })} />
      {wide && <TableFitFields />}
    </>
  )
}

// Своя аватарка (#298): «По умолчанию» (рисунок по имени — у всех телефонов один), один из 10 рисунков или своя
// картинка с устройства — сжимается здесь же в 96 × 96; новая заменяет прежнюю. Картинка — только на этом телефоне
// и в комнате, где сидишь; в копию идёт только выбор из набора
function AvatarFields({ look, onPick }: { look: MyLook; onPick: (avatar: AvatarChoice | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const picture = loadAvatarPicture()
  const chosen = drawnAvatar(look, picture !== null) // «Своя» без картинки — по умолчанию

  async function pickOwn(file: File) {
    setBusy(true)
    setError('')
    try {
      const r = await compressAvatar(file)
      if (!r.ok) setError(r.error)
      else if (!saveAvatarPicture(r.url)) setError('Не хватило места на устройстве — аватарка не сохранена')
      else onPick(OWN_AVATAR)
    } finally {
      setBusy(false)
    }
  }

  function removeOwn() {
    setError('')
    if (!saveAvatarPicture(null)) {
      setError('Не удалось удалить — попробуйте ещё раз')
      return
    }
    if (look.avatar === OWN_AVATAR) onPick(null)
  }

  return (
    <fieldset className="players-pick">
      <legend className="muted">Аватарка</legend>
      <div className="amounts">
        <LookChoice on={chosen === null} onPick={() => onPick(null)}>
          По умолчанию
        </LookChoice>
        {AVATAR_LABELS.map(([id, label]) => (
          <LookChoice key={id} on={chosen === id} onPick={() => onPick(id)}>
            <Avatar value={id} className="look-avatar" />
            {label}
          </LookChoice>
        ))}
        {picture && (
          <LookChoice on={chosen === OWN_AVATAR} onPick={() => onPick(OWN_AVATAR)}>
            <Avatar value={picture} className="look-avatar" />
            Своя
          </LookChoice>
        )}
        <button type="button" className="big" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'Сжимаю…' : 'Своя картинка…'}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="own-back-file"
        aria-label="Картинка для своей аватарки"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // тот же файл ещё раз — снова сработает
          if (file) void pickOwn(file)
        }}
      />
      {error && <p className="warn">{error}</p>}
      {picture && (
        <button type="button" className="big wide danger-text" onClick={removeOwn}>
          Удалить свою аватарку
        </button>
      )}
      <p className="muted">
        По умолчанию — рисунок по имени, у всех телефонов одинаковый. Своя картинка — только с этого телефона: в
        копию не идёт, в комнату уходит, когда садишься за стол.
      </p>
    </fieldset>
  )
}

// «Аватарки: показывать / не показывать» (#298) — в «⚙» за столом: этого устройства, за всеми столами
export function AvatarsShownField() {
  useLookVersion()
  const shown = loadAvatarsShown()
  const options: [boolean, string][] = [
    [true, 'Показывать'],
    [false, 'Не показывать'],
  ]
  return (
    <fieldset className="players-pick">
      <legend className="muted">Аватарки</legend>
      <div className="row">
        {options.map(([value, label]) => (
          <button
            key={label}
            type="button"
            className={shown === value ? 'big primary grow' : 'big grow'}
            aria-pressed={shown === value}
            onClick={() => saveAvatarsShown(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted">
        {shown
          ? 'У имени каждого места — маленькая аватарка. Только на этом устройстве, за всеми столами.'
          : 'Места — без аватарок. Только на этом устройстве, за всеми столами; свою другие игроки видят как прежде.'}
      </p>
    </fieldset>
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
