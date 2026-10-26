import { formatRub } from '../calc/format'
import { clockText, type TournamentView } from '../calc/pokerView'
import { tournamentResults } from '../calc/pokerGame'
import { levelText, prizeRuleText, prizesSum, SCHEME_LABELS, type TournamentForm } from '../calc/tournamentForm'
import type { TableState } from '../poker/table'
import { defaultPrizes, LEVEL_COUNT, MAX_PRIZE_PLACES } from '../poker/tournament'

// Турнир (#78): форма «Кэш» / «Турнир» у новой комнаты и стола на телефоне, часы и места за столом

const rub = (n: number) => formatRub(n * 100)

type Change = (form: TournamentForm) => void

// players — сколько за столом сейчас (у комнаты — отмеченных): по нему призы по умолчанию
export function FormatFields({ form, players, onChange }: { form: TournamentForm; players: number; onChange: Change }) {
  return (
    <fieldset className="players-pick">
      <legend className="muted">Игра</legend>
      <div className="row">
        {(
          [
            ['cash', 'Кэш'],
            ['tournament', 'Турнир'],
          ] as const
        ).map(([format, label]) => (
          <button
            key={format}
            type="button"
            className={form.format === format ? 'big primary grow' : 'big grow'}
            aria-pressed={form.format === format}
            onClick={() => onChange({ ...form, format })}
          >
            {label}
          </button>
        ))}
      </div>
      {form.format === 'cash' ? (
        <label className="field">
          Анте, фишек — 0, если нет
          <input inputMode="numeric" pattern="[0-9 ]*" value={form.ante} onChange={(e) => onChange({ ...form, ante: e.target.value })} />
          <span className="muted">Анте ставят все в раздаче до блайндов, в банк.</span>
        </label>
      ) : (
        <TournamentFields form={form} players={players} onChange={onChange} />
      )}
    </fieldset>
  )
}

function TournamentFields({ form, players, onChange }: { form: TournamentForm; players: number; onChange: Change }) {
  const field = (key: 'buyIn' | 'growth' | 'minutes' | 'antePct' | 'rebuyLevels', label: string) => (
    <label className="field">
      {label}
      <input inputMode="numeric" pattern="[0-9 ]*" value={form[key]} onChange={(e) => onChange({ ...form, [key]: e.target.value })} />
    </label>
  )
  return (
    <>
      <p className="muted">Блайнды выше — стартовые, стек — стартовый. Итог ляжет в «Фишки» игрой по курсу 1 ₽ за фишку.</p>
      {field('buyIn', 'Бай-ин, ₽')}
      <p className="muted">Уровни блайндов</p>
      <div className="row">
        {SCHEME_LABELS.map(([scheme, label]) => (
          <button
            key={scheme}
            type="button"
            className={form.scheme === scheme ? 'big primary grow' : 'big grow'}
            aria-pressed={form.scheme === scheme}
            onClick={() => onChange({ ...form, scheme })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted">
        {form.scheme === 'classic'
          ? 'Классика: ×1,5, ×2, ×3, ×4, ×5… от стартовых, как в покер-румах.'
          : 'Проценты: каждый уровень больше прошлого на заданный процент.'}
      </p>
      <div className="draft-grid">
        {form.scheme === 'percent' && field('growth', 'Рост за уровень, %')}
        {field('minutes', 'Минут на уровень')}
        {field('antePct', 'Анте, % большого блайнда')}
      </div>
      <label className="check">
        <input type="checkbox" checked={form.rebuy} onChange={(e) => onChange({ ...form, rebuy: e.target.checked })} />
        Ребай — выбывший покупает стартовый стек за бай-ин
      </label>
      {form.rebuy && field('rebuyLevels', `До конца уровня (1–${LEVEL_COUNT})`)}
      <PrizeFields
        own={form.prizesOwn}
        prizes={form.prizes}
        players={players}
        onChange={(prizesOwn, prizes) => onChange({ ...form, prizesOwn, prizes })}
      />
    </>
  )
}

// Призы по местам: по числу игроков (по умолчанию) или свои проценты — сумма 100
export function PrizeFields(props: {
  own: boolean
  prizes: string[]
  players: number
  disabled?: boolean
  onChange: (own: boolean, prizes: string[]) => void
}) {
  const { own, prizes, players, disabled, onChange } = props
  const sum = prizesSum(prizes)
  const set = (i: number, text: string) => onChange(true, prizes.map((p, k) => (k === i ? text : p)))
  return (
    <>
      <p className="muted">Призы по местам</p>
      <div className="row">
        <button
          type="button"
          className={!own ? 'big primary grow' : 'big grow'}
          aria-pressed={!own}
          disabled={disabled}
          onClick={() => onChange(false, prizes)}
        >
          По числу игроков
        </button>
        <button
          type="button"
          className={own ? 'big primary grow' : 'big grow'}
          aria-pressed={own}
          disabled={disabled}
          onClick={() => onChange(true, own ? prizes : defaultPrizes(players).map(String))}
        >
          Свои
        </button>
      </div>
      {!own ? (
        <p className="muted">
          {prizeRuleText()} (%). Сейчас — {defaultPrizes(players).join('/')}.
        </p>
      ) : (
        <>
          <div className="draft-grid">
            {prizes.map((p, i) => (
              <label key={i} className="field">
                {i + 1} место, %
                <input inputMode="numeric" pattern="[0-9]*" value={p} disabled={disabled} onChange={(e) => set(i, e.target.value)} />
              </label>
            ))}
          </div>
          <div className="row">
            <button
              type="button"
              className="big grow"
              disabled={disabled || prizes.length >= MAX_PRIZE_PLACES}
              onClick={() => onChange(true, [...prizes, '0'])}
            >
              + место
            </button>
            <button
              type="button"
              className="big grow"
              disabled={disabled || prizes.length <= 1}
              onClick={() => onChange(true, prizes.slice(0, -1))}
            >
              − место
            </button>
          </div>
          <p className={sum === 100 ? 'muted' : 'warn'}>Сумма: {sum} %{sum === 100 ? '' : ' — нужно 100'}</p>
        </>
      )}
    </>
  )
}

// Под столом: уровень, отсчёт, следующий уровень, ребай и призы. Окончен — места и призы
export function TournamentPanel({ view: t }: { view: TournamentView }) {
  return (
    <section className="card tournament">
      {t.ended ? (
        <h2>Турнир окончен</h2>
      ) : (
        <>
          <h2>
            Уровень {t.level}: {levelText(t.blinds)}
          </h2>
          {t.next && t.nextLeft !== null ? (
            <p>
              {t.started ? 'До следующего' : 'Уровень идёт'} <strong className="num">{clockText(t.nextLeft)}</strong>
              {' · '}дальше {levelText(t.next)}
            </p>
          ) : (
            <p className="muted">Последний уровень — блайнды больше не растут</p>
          )}
          {!t.started && <p className="muted">Часы пойдут, когда ведущий нажмёт «Начать турнир».</p>}
          {t.stopped && <p className="warn">Перерыв — часы стоят у всех</p>}
          {t.rebuyLevels > 0 && (
            <p className="muted">{t.rebuyOpen || !t.started ? `Ребай — до конца уровня ${t.rebuyLevels}` : 'Ребай закрыт'}</p>
          )}
        </>
      )}
      <p className="muted">
        Бай-ин {rub(t.buyIn)} · фонд {rub(t.pool)} · призы:{' '}
        {t.prizes.map((p) => `${p.place} — ${rub(p.amount)} (${p.pct} %)`).join(', ')}
      </p>
    </section>
  )
}

// Итог турнира: место, имя, приз и итог против бай-инов — у ведущего перед записью и в конце комнаты
export function TournamentResults({ table }: { table: TableState }) {
  const rows = tournamentResults(table)
  if (rows.length === 0) return null
  return (
    <>
      <table className="totals">
        <tbody>
          {rows.map((r) => (
            <tr key={r.place}>
              <td>{r.place}</td>
              <td>
                {r.name}
                {r.buyIns > 1 && <span className="muted"> · бай-инов {r.buyIns}</span>}
              </td>
              <td className="num">{r.prize > 0 ? rub(r.prize) : ''}</td>
              <td className={r.net > 0 ? 'num plus' : r.net < 0 ? 'num minus' : 'num'}>{formatRub(r.net * 100, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Место, приз и итог: приз минус все бай-ины</p>
    </>
  )
}
