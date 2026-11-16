import type { BotFlag } from '../calc/botTable'

export type BotFlags = Record<BotFlag, boolean>

// Галочки стола с ботами — у нового стола на «Играть» и в «⚙ Стол» за ним (#243): только для экрана человека,
// ботам не виднее и ходят они так же
export function BotFlagFields({ flags, onChange }: { flags: BotFlags; onChange: (flag: BotFlag, on: boolean) => void }) {
  const check = (flag: BotFlag, label: string, note: string) => (
    <>
      <label className="check">
        <input type="checkbox" checked={flags[flag]} onChange={(e) => onChange(flag, e.target.checked)} />
        {label}
      </label>
      <p className="muted">{note}</p>
    </>
  )
  return (
    <>
      {check('open', 'Карты ботов открыты', 'Только на вашем экране — учиться на их решениях. Боты ваших карт не видят.')}
      {check('showStyles', 'Стиль ботов виден', 'Выключите — стиль придётся угадывать по игре.')}
      {/* #196: HUD у мест ботов — учиться читать соперника; выключено — только у своего места */}
      {check('hudAll', 'HUD у всех мест', 'Строка HUD у каждого бота, касание — подробно. Выключено — HUD только у вашего места.')}
      {/* #194: сбросили — раздача между ботами доигрывается мгновенно; выключено — кнопкой «Доиграть сразу» */}
      {check(
        'autoFinish',
        'После паса — сразу доигрывать',
        'Сбросили — боты доигрывают раздачу без пауз. Выключено — внизу кнопка «Доиграть сразу».',
      )}
    </>
  )
}
