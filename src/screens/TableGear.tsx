import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { HudDetailField } from './Hud'
import { MyLookFields } from './MyLookFields'
import { useLookVersion } from './PokerRoom'
import { loadMyLook } from './pokerStorage'

// «⚙» за столом (#243): карточка поверх стола — менять, не выходя из-за него. «Готово» и Esc закрывают;
// игра на это время идёт как шла. Карточка — вне обёртки стола: сукно и рубашка стола не красят образцы выбора.
// done — надпись кнопки закрытия («Что нового», #261: «Понятно»)
export function GearPop(props: { title: string; onClose: () => void; children: ReactNode; done?: string }) {
  const { title, onClose, children, done = 'Готово' } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="gear-shade" onClick={onClose}>
      <section className="card gear-pop" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="gear-body">{children}</div>
        <button type="button" className="big primary wide" onClick={onClose}>
          {done}
        </button>
      </section>
    </div>,
    document.body,
  )
}

// «Мой вид стола» — те же поля, что «Вид стола» в «Настройках», и «HUD у мест: коротко / подробно»:
// всё — этого устройства, на всех столах сразу. heading — свой заголовок части (у стола с ботами частей две)
export function MyLookPart({ heading = false }: { heading?: boolean }) {
  useLookVersion() // вид сменили — поля показывают новый
  return (
    <>
      {heading && <h3>Мой вид стола</h3>}
      <p className="muted">Только на этом телефоне — за всеми столами; то же, что «Вид стола» в «Настройках».</p>
      <MyLookFields look={loadMyLook()} onChange={() => undefined} />
      <HudDetailField />
    </>
  )
}

// Комната и стол на телефоне (#243): «⚙» — только свой вид и HUD; настройки стола ведущего — где были
export function LookGear() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="big wide" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        ⚙ Мой вид стола
      </button>
      {open && (
        <GearPop title="Мой вид стола" onClose={() => setOpen(false)}>
          <MyLookPart />
        </GearPop>
      )}
    </>
  )
}
