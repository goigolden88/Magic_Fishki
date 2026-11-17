import { parseChips } from '../calc/format'
import type { Look } from '../calc/pokerLook'
import { timeBankOf, turnSecondsOf } from '../calc/pokerTimer'
import { ownGameLine } from '../calc/ownGameForm'
import {
  GAME_CHOICES,
  MAX_RUNS_CHOICES,
  MIX_SHARE_CHOICES,
  ownSeatsNote,
  roomGameChoice,
  roomOwnGames,
  type GameChoice,
  type QuickRoom,
  type RoomChoice,
} from '../calc/quickRoom'
import type { OwnGame } from '../poker/ownGame'
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
  liveHand: boolean // ход раздачи по касанию банка (#258)
  mix: MixShare | null
  maxRuns: MaxRuns
}

// Форма из уже разобранного выбора; stack — строкой (пусто — пока не прочитан закуп по умолчанию).
// own — свои игры телефона (#225): выбранной своей там нет или карты живые — холдем
export function roomFormOf(room: QuickRoom, stack: string, players: number, own: OwnGame[]): RoomForm {
  return {
    sb: String(room.sb),
    bb: String(room.bb),
    stack,
    cards: room.cards,
    variant: roomGameChoice(room.cards, room.variant, own),
    timer: timerForm(room.turnSeconds, room.autoStart, room.timeBank ?? null),
    look: room.look,
    format: tournamentFormOf(room.format, players),
    publicHud: room.publicHud,
    liveHand: room.liveHand !== false,
    mix: room.mix ?? null,
    maxRuns: room.maxRuns ?? 1,
  }
}

// Разбор формы — как у «Создать комнату»; что-то не годится — null (подсказки показывают поля).
// Своей игры уже нет на телефоне (own) — холдем (#225)
export function roomChoiceOf(form: RoomForm, own: OwnGame[]): RoomChoice | null {
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
    variant: roomGameChoice(form.cards, form.variant, own),
    turnSeconds: turn.seconds,
    timeBank: timeBankOf(turn.seconds, form.timer.bank),
    autoStart: form.timer.autoStart,
    look: form.look,
    format: game.settings,
    publicHud: form.publicHud,
    ...(form.liveHand ? {} : { liveHand: false }),
    mix: form.mix,
    maxRuns: form.maxRuns,
  }
}

// players — сколько играют: призы турнира по умолчанию — по ним; own — свои игры телефона (#225)
export function RoomFields(props: { form: RoomForm; players: number; own: OwnGame[]; onChange: (form: RoomForm) => void }) {
  const { form, players, own, onChange } = props
  const set = (change: Partial<RoomForm>) => onChange({ ...form, ...change })
  const game = formSettings(form.format)
  const cards = form.cards
  const variant = roomGameChoice(cards, form.variant, own)
  // #225: мест меньше обычного — из-за какой своей игры
  const seatsNote = ownSeatsNote(roomOwnGames({ cards, variant, mix: form.mix }, own))
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
              onClick={() => set({ cards: mode, variant: roomGameChoice(mode, form.variant, own) })}
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

      {/* #225: свои игры — только с картами на телефонах */}
      <GameFields
        choice={variant}
        phones={cards === 'phones'}
        own={cards === 'phones' ? own : undefined}
        onChange={(variant) => set({ variant })}
      />
      {/* #166: «Микс» — только карты на телефонах */}
      {cards === 'phones' && <MixFields mix={form.mix} onChange={(mix) => set({ mix })} />}
      {seatsNote && <p className="muted">{seatsNote}</p>}
      {/* #167: «Прогнать несколько раз» — только карты на телефонах, кэш и турнир */}
      {cards === 'phones' && <RunsFields max={form.maxRuns} onChange={(maxRuns) => set({ maxRuns })} />}

      {/* #75: стол на одном телефоне — без таймера и раздачи «сама»; запас времени (#223) — тоже только здесь */}
      <TimerFields form={form.timer} onChange={(timer) => set({ timer })} />

      <LookFields look={form.look} backs onChange={(l) => set({ look: { ...form.look, ...l } })} />
      {/* Р-59: вид стола — для всех за этим столом; свой на этом телефоне — «Вид стола» в «Настройках» */}
      <p className="muted">
        {cards === 'live' ? 'Карты живые — рубашка на экране не видна. ' : ''}Вид этого стола у всех за ним; свой — в
        «Настройках», «Вид стола».
      </p>

      {/* #79: стол на одном телефоне — HUD видят все, выбора там нет */}
      <HudFields all={form.publicHud} onChange={(publicHud) => set({ publicHud })} />
      <LiveHandField on={form.liveHand} onChange={(liveHand) => set({ liveHand })} />
    </>
  )
}

// «Ход раздачи по касанию банка» (#258): галочка стола — у комнаты при создании и в «Настройках стола» ведущего,
// у стола с ботами — в «⚙ Стол», у стола на одном телефоне — при создании. Выкл скрывает только панель
export function LiveHandField(props: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  const { on, onChange, disabled } = props
  return (
    <fieldset className="players-pick">
      <legend className="muted">Ход раздачи</legend>
      <label className="check">
        <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        Ход раздачи по касанию банка
      </label>
      <p className="muted">
        {on
          ? 'Касание банка за столом — кто что сделал по улицам в этой раздаче. Подсказка для удобства, не тайна: те же ходы — в истории раздач.'
          : 'Касание банка панель не открывает. Ходы всё равно записываются — в истории раздач и для HUD.'}
      </p>
    </fieldset>
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

// own (#225) — свои игры телефона после трёх встроенных; нет поля — своих игр здесь не бывает (стол на этом
// телефоне, живые карты)
export function GameFields(props: { choice: GameChoice; phones: boolean; own?: OwnGame[]; onChange: (c: GameChoice) => void }) {
  const { choice, phones, own, onChange } = props
  const omaha = choice.game === 'omaha'
  const mine = own?.find((g) => g.id === choice.game)
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
        {own?.map((g) => (
          <button
            key={g.id}
            type="button"
            className={choice.game === g.id ? 'big primary' : 'big'}
            aria-pressed={choice.game === g.id}
            onClick={() => onChange({ ...choice, game: g.id })}
          >
            {g.name}
          </button>
        ))}
      </div>
      {own?.length === 0 && <p className="muted">Свои игры — «Настройки» → «Свои игры»</p>}
      {mine && <p className="muted">{ownGameLine(mine)}</p>}
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
      {!mine && (
        <p className="muted">
          {choice.game === 'shortdeck'
            ? `Колода 36 карт, без двоек–пятёрок; флеш старше фулл-хауса, A-6-7-8-9 — стрит${phones ? '' : ' (карты живые)'}. Две карты на руках, ставки без лимита.`
            : !omaha
            ? 'Две карты на руках, ставки без лимита.'
            : `Четыре карты на руках, рука — ровно две свои и три со стола${phones ? '' : ' (карты живые)'}. ${
                choice.limit === 'pot' ? 'Рейз — не больше банка.' : 'Ставки без лимита.'
              }`}
        </p>
      )}
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
