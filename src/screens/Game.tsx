import { useEffect, useState, type FormEvent } from 'react'
import { balanceText, formatChips, formatNumber, formatRate, formatRub, parseChips, parseRate } from '../calc/format'
import { balance, playerTotals, type PlayerTotal } from '../calc/totals'
import { transfers } from '../calc/transfers'
import { formatDate, formatTime } from '../dates'
import type { Entry, EntryKind, Game, Player } from '../model'
import { getGame, saveGame } from '../store/db'
import { ulid } from '../ulid'

const KIND_LABEL: Record<EntryKind, string> = { buyin: 'Закуп', rebuy: 'Докуп', cashout: 'Выход' }
const KINDS: EntryKind[] = ['buyin', 'rebuy', 'cashout']

export function GameScreen({ id }: { id: string }) {
  const [game, setGame] = useState<Game | null | undefined>(undefined)
  const [newPlayer, setNewPlayer] = useState('')
  const [rateText, setRateText] = useState<string | null>(null) // не null — курс правится

  useEffect(() => {
    void getGame(id).then((g) => setGame(g ?? null))
  }, [id])

  if (game === undefined) return <main className="screen" />
  if (game === null) {
    return (
      <main className="screen">
        <BackBar />
        <p className="muted center">Игра не найдена</p>
      </main>
    )
  }

  const current = game
  function update(next: Game) {
    setGame(next)
    void saveGame(next)
  }

  const totals = playerTotals(current.players, current.entries, current.rate)
  const totalById = new Map(totals.map((t) => [t.playerId, t]))
  const nameById = new Map(current.players.map((p) => [p.id, p.name]))
  const b = balance(totals)
  const list = transfers(totals, current.rate)
  const lastBuyin = [...current.entries].reverse().find((e) => e.kind === 'buyin')?.chips

  function addPlayer(e: FormEvent) {
    e.preventDefault()
    const name = newPlayer.trim()
    if (!name || current.players.some((p) => p.name === name)) return
    update({ ...current, players: [...current.players, { id: ulid(), name }] })
    setNewPlayer('')
  }

  function addEntry(playerId: string, kind: EntryKind, chips: number) {
    const entry: Entry = { id: ulid(), playerId, kind, chips, at: new Date().toISOString() }
    update({ ...current, entries: [...current.entries, entry] })
  }

  function deleteEntry(entry: Entry) {
    const who = nameById.get(entry.playerId) ?? ''
    if (!confirm(`Удалить запись «${KIND_LABEL[entry.kind]} ${formatNumber(entry.chips)}» у ${who}?`)) return
    update({ ...current, entries: current.entries.filter((e) => e.id !== entry.id) })
  }

  const newRate = rateText === null ? null : parseRate(rateText)
  function saveRate(e: FormEvent) {
    e.preventDefault()
    if (newRate === null) return
    update({ ...current, rate: newRate })
    setRateText(null)
  }

  const duplicate = current.players.some((p) => p.name === newPlayer.trim())
  const sorted = [...totals].sort((x, y) => y.chips - x.chips)

  return (
    <main className="screen">
      <BackBar />
      <h1>{current.name}</h1>
      <p className="muted">
        {formatDate(current.date)}
        {current.closed && ' · игра закрыта'}
      </p>

      {rateText === null ? (
        <p className="rate">
          Курс: {formatRate(current.rate)} ₽ за фишку
          {!current.closed && (
            <button className="link" onClick={() => setRateText(formatRate(current.rate))}>
              Изменить
            </button>
          )}
        </p>
      ) : (
        <form className="card" onSubmit={saveRate}>
          <label className="field">
            Курс, ₽ за фишку
            <input autoFocus inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} />
          </label>
          {newRate === null && <p className="warn">Курс — число больше нуля, например 0,5</p>}
          <div className="row">
            <button className="big primary" disabled={newRate === null}>
              Сохранить
            </button>
            <button type="button" className="big" onClick={() => setRateText(null)}>
              Отмена
            </button>
          </div>
        </form>
      )}

      <ul className="list">
        {current.players.map((p) => (
          <PlayerCard
            key={p.id}
            player={p}
            total={totalById.get(p.id)!}
            entries={current.entries.filter((e) => e.playerId === p.id)}
            closed={!!current.closed}
            suggestIn={lastBuyin}
            onAdd={(kind, chips) => addEntry(p.id, kind, chips)}
            onDelete={deleteEntry}
          />
        ))}
      </ul>

      {!current.closed && (
        <form className="card row" onSubmit={addPlayer}>
          <input
            className="grow"
            placeholder="Имя участника"
            value={newPlayer}
            onChange={(e) => setNewPlayer(e.target.value)}
          />
          <button className="big primary" disabled={!newPlayer.trim() || duplicate}>
            Добавить
          </button>
        </form>
      )}
      {duplicate && <p className="warn">Такой участник уже есть</p>}

      <section className="card summary">
        <h2>Итог</h2>
        <p className={b.ok ? 'ok' : 'warn'}>{balanceText(b)}</p>
        {current.players.length > 0 && (
          <table className="totals">
            <tbody>
              {sorted.map((t) => (
                <tr key={t.playerId}>
                  <td>{nameById.get(t.playerId)}</td>
                  <td className="num">{formatChips(t.chips, true)}</td>
                  <td className={'num ' + (t.kopecks > 0 ? 'plus' : t.kopecks < 0 ? 'minus' : '')}>
                    {formatRub(t.kopecks, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2>Переводы</h2>
        {!b.ok ? (
          <p className="muted">Появятся, когда игра сойдётся</p>
        ) : list.length === 0 ? (
          <p className="muted">Переводить никому не нужно</p>
        ) : (
          <ul className="transfers">
            {list.map((t, i) => (
              <li key={i}>
                <span>
                  {nameById.get(t.from)} → {nameById.get(t.to)}
                </span>
                <strong>{formatRub(t.kopecks)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button className="big wide" onClick={() => update({ ...current, closed: !current.closed })}>
        {current.closed ? 'Открыть снова' : 'Закрыть игру'}
      </button>
    </main>
  )
}

function BackBar() {
  return (
    <header className="bar">
      <a className="bar-link" href="#/">
        ← Игры
      </a>
    </header>
  )
}

type PlayerCardProps = {
  player: Player
  total: PlayerTotal
  entries: Entry[]
  closed: boolean
  suggestIn?: number
  onAdd: (kind: EntryKind, chips: number) => void
  onDelete: (entry: Entry) => void
}

function PlayerCard({ player, total, entries, closed, suggestIn, onAdd, onDelete }: PlayerCardProps) {
  const [kind, setKind] = useState<EntryKind | null>(null)
  const [text, setText] = useState('')
  const chips = parseChips(text)

  function start(k: EntryKind) {
    setKind(k)
    setText(k !== 'cashout' && suggestIn ? String(suggestIn) : '')
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (kind === null || chips === null) return
    onAdd(kind, chips)
    setKind(null)
  }

  return (
    <li className="card player">
      <div className="player-head">
        <strong>{player.name}</strong>
        <span className={total.chips > 0 ? 'plus' : total.chips < 0 ? 'minus' : ''}>
          {formatChips(total.chips, true)} · {formatRub(total.kopecks, true)}
        </span>
      </div>
      <p className="muted">
        закуп {formatNumber(total.chipsIn)} · {total.hasCashout ? `выход ${formatNumber(total.chipsOut)}` : 'выхода нет'}
      </p>

      {entries.length > 0 && (
        <ul className="entries">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="muted">{formatTime(e.at)}</span>
              <span>{KIND_LABEL[e.kind]}</span>
              <span className="num">{formatNumber(e.chips)}</span>
              {!closed && (
                <button className="del" aria-label="Удалить запись" onClick={() => onDelete(e)}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!closed &&
        (kind === null ? (
          <div className="row">
            {KINDS.map((k) => (
              <button key={k} className={'big grow ' + k} onClick={() => start(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        ) : (
          <form className="row" onSubmit={submit}>
            <input
              className="grow"
              autoFocus
              inputMode="numeric"
              pattern="[0-9 ]*"
              placeholder={`${KIND_LABEL[kind]}, фишек`}
              aria-label={`${KIND_LABEL[kind]}, фишек`}
              value={text}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setText(e.target.value)}
            />
            <button className="big primary" disabled={chips === null}>
              {KIND_LABEL[kind]}
            </button>
            <button type="button" className="big" onClick={() => setKind(null)}>
              ✕
            </button>
          </form>
        ))}
    </li>
  )
}
