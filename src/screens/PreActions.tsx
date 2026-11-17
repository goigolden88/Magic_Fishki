import { useEffect, useRef, useState } from 'react'
import type { ActionsView } from '../calc/pokerView'
import { preActionNow, togglePreAction, type PreAction, type PreActionMark } from '../calc/preAction'
import type { BetAction } from '../poker/protocol'

// Ход заранее (#115) — общий для комнаты и стола с ботами (#299); у стола на одном телефоне его нет: телефон
// передают из рук в руки. Флажок держится до конца улицы; пришла очередь (turn — метка хода, myTurnMark)
// и ход можно сделать (canSend: в комнате — есть связь) — ход уходит сам, один раз на очередь, и флажок
// снимается. Нельзя — ждёт. autoMove не null — ход сейчас уйдёт: кнопки хода не показывать
export function usePreAction(
  view: { handNumber: number; stage: string | null; actions: ActionsView | null },
  turn: string | null,
  canSend: boolean,
  send: (move: BetAction) => void,
) {
  const [mark, setMark] = useState<PreActionMark | null>(null)
  const { street, pre, move } = preActionNow(mark, view)
  const autoMove = canSend ? move : null
  const sent = useRef<string | null>(null)
  useEffect(() => {
    if (autoMove === null || turn === null || sent.current === turn) return
    sent.current = turn
    setMark(null)
    send(autoMove)
  }, [turn, autoMove?.type])
  const toggle = (kind: PreAction) => {
    const next = togglePreAction(pre, kind)
    setMark(next !== null && street !== null ? { kind: next, street } : null)
  }
  return { pre, autoMove, toggle }
}

// Ход не мой, а я в раздаче (#115) — вместо полосы «Ждём хода» она же строкой и два флажка хода заранее:
// «Чек/пас» и «Колл любой». Отмечен — подсвечен; тап снимает, отмечен только один
export function PreActionsDock(props: { line: string; pre: PreAction | null; onToggle: (kind: PreAction) => void }) {
  const { line, pre, onToggle } = props
  const flag = (kind: PreAction, label: string) => (
    <button
      type="button"
      className={pre === kind ? 'big primary grow' : 'big grow'}
      aria-pressed={pre === kind}
      onClick={() => onToggle(kind)}
    >
      {pre === kind ? '✓ ' : ''}
      {label}
    </button>
  )
  return (
    <section className="dock pre-actions">
      <p className="dock-title muted">{line}</p>
      <div className="dock-row">
        {flag('checkFold', 'Чек/пас')}
        {flag('callAny', 'Колл любой')}
      </div>
    </section>
  )
}
