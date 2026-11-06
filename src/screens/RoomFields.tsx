import { parseChips } from '../calc/format'
import type { Look } from '../calc/pokerLook'
import { turnSecondsOf } from '../calc/pokerTimer'
import { GAME_CHOICES, MAX_RUNS_CHOICES, MIX_SHARE_CHOICES, type GameChoice, type QuickRoom, type RoomChoice } from '../calc/quickRoom'
import { formSettings, tournamentFormOf, type TournamentForm } from '../calc/tournamentForm'
import type { CardsMode, Limit } from '../poker/game'
import { MIX_SHARE_DEFAULT, MIX_VOTE_MS, type MixShare } from '../poker/mix'
import { RUN_VOTE_MS, type MaxRuns } from '../poker/runs'
import { HudFields } from './Hud'
import { LookFields } from './LookFields'
import { TimerFields, timerForm, type TimerForm } from './TimerFields'
import { FormatFields } from './Tournament'

// Поля стола «Новой комнаты» (#127) — одни у формы и у своей «Быстрой комнаты» в «Настройках» (Р-62):
// всё, кроме игроков, «Вы за столом» и пароля. Числа — строками, как их набрал ведущий
export type RoomForm = {
  sb: string
  bb: string
  stack: string
  cards: CardsMode
  variant: GameChoice
  timer: TimerForm
  look: Look
  format: TournamentForm
  publicHud: boolean
  mix: MixShare | null
  maxRuns: MaxRuns
}

// Форма из уже разобранного выбора; stack — строкой (пусто — пока не прочитан закуп по умолчанию)
export function roomFormOf(room: QuickRoom, stack: string, players: number): RoomForm {
  return {
    sb: String(room.sb),
    bb: String(room.bb),
    stack,
    cards: room.cards,
    variant: room.variant,
    timer: timerForm(room.turnSeconds, room.autoStart),
    look: room.look,
    format: tournamentFormOf(room.format, players),
    publicHud: room.publicHud,
    mix: room.mix ?? null,
    maxRuns: room.maxRuns ?? 1,
  }
}

// Разбор формы — как у «Создать комнату»; что-то не годится — null (подсказки показывают поля)
export function roomChoiceOf(form: RoomForm): RoomChoice | null {
  const sb = parseChips(form.sb)
  const bb = parseChips(form.bb)
  const stack = parseChips(form.stack)
  const turn = turnSecondsOf(form.timer.choice, form.timer.text)
  const game = formSettings(form.format)
  if (sb === null || bb === null || sb > bb || stack === null || !turn.ok || !game.ok) return null
  return {
    sb,
    bb,
    startingStack: stack,
    cards: form.cards,
    variant: form.variant,
    turnSeconds: turn.seconds,
    autoStart: form.timer.autoStart,
    look: form.look,
    format: game.settings,
    publicHud: form.publicHud,
    mix: form.mix,
    maxRuns: form.maxRuns,
  }
}

// players — сколько играют: призы турнира по умолчанию — по ним
export function RoomFields({ form, players, onChange }: { form: RoomForm; players: number; onChange: (form: RoomForm) => void }) {
  const set = (change: Partial<RoomForm>) => onChange({ ...form, ...change })
  const game = formSettings(form.format)
  const cards = form.cards
  return (
    <>
      <TableFields
        sb={[form.sb, (sb) => set({ sb })]}
        bb={[form.bb, (bb) => set({ bb })]}
        stack={[form.stack, (stack) => set({ stack })]}
        tournament={form.format.format === 'tournament'}
      />
      {/* #78: кэш с анте или турнир; призы по умолчанию — по отмеченным, гостей до входа не видно */}
      <FormatFields form={form.format} players={players} onChange={(format) => set({ format })} />
      {!game.ok && <p className="warn">{game.error}</p>}

      {/* Р-23: стол на одном телефоне — только живые, выбора там нет */}
      <fieldset className="players-pick">
        <legend className="muted">Карты</legend>
        <div className="row">
          {CARDS_MODES.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              className={cards === mode ? 'big primary grow' : 'big grow'}
              aria-pressed={cards === mode}
              onClick={() => set({ cards: mode })}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="muted">
          {cards === 'live'
            ? 'Настоящая колода на столе; банк после торгов отдаёт ведущий.'
            : 'Программа тасует и раздаёт: у каждого свои карты на своём телефоне, банк раздаётся сам.'}
        </p>
      </fieldset>

      <GameFields choice={form.variant} phones={cards === 'phones'} onChange={(variant) => set({ variant })} />
      {/* #166: «Микс» — только карты на телефонах */}
      {cards === 'phones' && <MixFields mix={form.mix} onChange={(mix) => set({ mix })} />}
      {/* #167: «Прогнать несколько раз» — только карты на телефонах, кэш и турнир */}
      {cards === 'phones' && <RunsFields max={form.maxRuns} onChange={(maxRuns) => set({ maxRuns })} />}

      {/* #75: стол на одном телефоне — без таймера и раздачи «сама» */}
      <TimerFields form={form.timer} onChange={(timer) => set({ timer })} />

      <LookFields look={form.look} backs onChange={(l) => set({ look: { ...form.look, ...l } })} />
      {/* Р-59: вид стола — для всех за этим столом; свой на этом телефоне — «Вид стола» в «Настройках» */}
      <p className="muted">
        {cards === 'live' ? 'Карты живые — рубашка на экране не видна. ' : ''}Вид этого стола у всех за ним; свой — в
        «Настройках», «Вид стола».
      </p>

      {/* #79: стол на одном телефоне — HUD видят все, выбора там нет */}
      <HudFields all={form.publicHud} onChange={(publicHud) => set({ publicHud })} />
    </>
  )
}

const CARDS_MODES: [CardsMode, string][] = [
  ['live', 'Живые'],
  ['phones', 'На телефонах'],
]

// «Покер» — игра (GAME_CHOICES) и лимит омахи (#80); «Игра» в форме уже есть — кэш или турнир (#78)
const LIMIT_CHOICES: [Limit, string][] = [
  ['pot', 'Пот-лимит'],
  ['nolimit', 'Без лимита'],
]

export function GameFields({ choice, phones, onChange }: { choice: GameChoice; phones: boolean; onChange: (c: GameChoice) => void }) {
  const omaha = choice.game === 'omaha'
  return (
    <fieldset className="players-pick">
      <legend className="muted">Покер</legend>
      <div className="amounts">
        {GAME_CHOICES.map(([game, label]) => (
          <button
            key={game}
            type="button"
            className={choice.game === game ? 'big primary' : 'big'}
            aria-pressed={choice.game === game}
            onClick={() => onChange({ ...choice, game })}
          >
            {label}
          </button>
        ))}
      </div>
      {omaha && (
        <>
          <p className="muted">Лимит</p>
          <div className="row">
            {LIMIT_CHOICES.map(([limit, label]) => (
              <button
                key={limit}
                type="button"
                className={choice.limit === limit ? 'big primary grow' : 'big grow'}
                aria-pressed={choice.limit === limit}
                onClick={() => onChange({ ...choice, limit })}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="muted">
        {choice.game === 'shortdeck'
          ? `Колода 36 карт, без двоек–пятёрок; флеш старше фулл-хауса, A-6-7-8-9 — стрит${phones ? '' : ' (карты живые)'}. Две карты на руках, ставки без лимита.`
          : !omaha
          ? 'Две карты на руках, ставки без лимита.'
          : `Четыре карты на руках, рука — ровно две свои и три со стола${phones ? '' : ' (карты живые)'}. ${
              choice.limit === 'pot' ? 'Рейз — не больше банка.' : 'Ставки без лимита.'
            }`}
      </p>
    </fieldset>
  )
}

// «Микс» (#166, Р-57): батон предлагает игру перед раздачей, остальные голосуют; смена — если «против»
// не больше выбранной доли. mix — доля или null (выкл)
function MixFields({ mix, onChange }: { mix: MixShare | null; onChange: (m: MixShare | null) => void }) {
  return (
    <fieldset className="players-pick">
      <legend className="muted">Микс</legend>
      <label className="check">
        <input type="checkbox" checked={mix !== null} onChange={(e) => onChange(e.target.checked ? MIX_SHARE_DEFAULT : null)} />
        Батон предлагает игру перед раздачей
      </label>
      {mix !== null && (
        <>
          <p className="muted">Сменить игру, если против не больше …</p>
          <div className="row">
            {MIX_SHARE_CHOICES.map(([share, label]) => (
              <button
                key={share}
                type="button"
                className={mix === share ? 'big primary grow' : 'big grow'}
                aria-pressed={mix === share}
                onClick={() => onChange(share)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="muted">
            Остальные голосуют «За» или «Против» {MIX_VOTE_MS / 1000} секунд, не ответил — «За». Новая игра держится, пока
            следующий батон не предложит другую.
          </p>
        </>
      )}
    </fieldset>
  )
}

// «Прогнать несколько раз» (#167, Р-58): нет / до двух / до трёх; в кэше и в турнире
function RunsFields({ max, onChange }: { max: MaxRuns; onChange: (m: MaxRuns) => void }) {
  return (
    <fieldset className="players-pick">
      <legend className="muted">Прогнать несколько раз</legend>
      <div className="row">
        {MAX_RUNS_CHOICES.map(([runs, label]) => (
          <button
            key={runs}
            type="button"
            className={max === runs ? 'big primary grow' : 'big grow'}
            aria-pressed={max === runs}
            onClick={() => onChange(runs)}
          >
            {label}
          </button>
        ))}
      </div>
      {max > 1 && (
        <p className="muted">
          Все в олл-ине до ривера — каждый выбирает, сколько раз раздать оставшиеся карты, {RUN_VOTE_MS / 1000} секунд; не
          ответил — один раз. Раздают наименьшее из выбранного, каждый банк делится по бордам.
        </p>
      )}
    </fieldset>
  )
}

type Field = [string, (text: string) => void]

// Блайнды и стартовый стек — одни у комнаты и у стола на телефоне; в турнире блайнды — стартовые
export function TableFields({ sb, bb, stack, tournament }: { sb: Field; bb: Field; stack: Field; tournament: boolean }) {
  const sbN = parseChips(sb[0])
  const bbN = parseChips(bb[0])
  const blindsOk = sbN !== null && bbN !== null && sbN <= bbN
  return (
    <>
      <div className="draft-grid">
        <label className="field">
          {tournament ? 'Малый блайнд, старт' : 'Малый блайнд'}
          <input inputMode="numeric" pattern="[0-9 ]*" value={sb[0]} onChange={(e) => sb[1](e.target.value)} />
        </label>
        <label className="field">
          {tournament ? 'Большой блайнд, старт' : 'Большой блайнд'}
          <input inputMode="numeric" pattern="[0-9 ]*" value={bb[0]} onChange={(e) => bb[1](e.target.value)} />
        </label>
        <label className="field rebuys">
          Стартовый стек, фишек
          <input inputMode="numeric" pattern="[0-9 ]*" value={stack[0]} onChange={(e) => stack[1](e.target.value)} />
        </label>
      </div>
      {!blindsOk && <p className="warn">Блайнды — целые числа больше нуля, малый не больше большого</p>}
      {parseChips(stack[0]) === null && <p className="warn">Стек — целое число фишек больше нуля</p>}
    </>
  )
}
