import { useEffect, useState, type FormEvent } from 'react'
import { addRound, gameResult, newNames, parseRound, type PlayerResult } from '../calc/casino'
import { balanceText, formatChips, formatNumber, formatRate, formatRub, parseChips, parseRate } from '../calc/format'
import { shareText } from '../calc/share'
import { formatDate, formatTime } from '../dates'
import {
  playerByName,
  type CasinoRound,
  type Entry,
  type EntryKind,
  type Game,
  type Player,
  type Regular,
} from '../model'
import { deleteGame, getGame, getSettings, saveGame } from '../store/db'
import { ulid } from '../ulid'

const KIND_LABEL: Record<EntryKind, string> = { buyin: 'Закуп', rebuy: 'Докуп', cashout: 'Выход' }
const KINDS: EntryKind[] = ['buyin', 'rebuy', 'cashout']

const sign = (n: number) => (n > 0 ? 'plus' : n < 0 ? 'minus' : '')

export function GameScreen({ id }: { id: string }) {
  const [game, setGame] = useState<Game | null | undefined>(undefined)
  const [newPlayer, setNewPlayer] = useState('')
  const [rateText, setRateText] = useState<string | null>(null) // не null — курс правится
  const [quickAmounts, setQuickAmounts] = useState<number[]>([])
  const [regulars, setRegulars] = useState<Regular[]>([]) // постоянные игроки — для связи с участником (Р-12)
  const [shareNote, setShareNote] = useState<string | null>(null) // «Скопировано» под кнопкой
  const [deleting, setDeleting] = useState(false) // первое нажатие «Удалить игру» — ждём второго

  useEffect(() => {
    void getGame(id).then((g) => setGame(g ?? null))
    void getSettings().then((s) => {
      setQuickAmounts(s.quickAmounts)
      setRegulars(s.players)
    })
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

  const result = gameResult(current)
  const resultById = new Map(result.players.map((r) => [r.playerId, r]))
  const nameById = new Map(current.players.map((p) => [p.id, p.name]))
  const b = result.balance
  const list = result.transfers
  const rounds = current.casino ?? []
  const lastBuyin = [...current.entries].reverse().find((e) => e.kind === 'buyin')?.chips

  function addPlayer(e: FormEvent) {
    e.preventDefault()
    const name = newPlayer.trim()
    if (!name || current.players.some((p) => p.name === name)) return
    update({ ...current, players: [...current.players, playerByName(name, regulars, ulid())] })
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

  // Телефон — системное «Поделиться» (Телеграм и т. п.); где его нет — в буфер обмена
  async function share() {
    const text = shareText(current)
    if ('share' in navigator) {
      try {
        await navigator.share({ text })
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return // передумали
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      setShareNote('Скопировано')
    } catch {
      setShareNote('Не удалось скопировать')
    }
    setTimeout(() => setShareNote(null), 3000)
  }

  async function remove() {
    await deleteGame(current.id)
    location.hash = '#/'
  }

  // Раунд казино (Р-13): новые имена — участниками только казино, после подтверждения
  function saveRound(text: string): boolean {
    const round = parseRound(text)
    const fresh = newNames(round, current.players)
    if (fresh.length > 0 && !confirm(`Нет в игре: ${fresh.join(', ')}. Добавить участниками только казино?`)) {
      return false
    }
    update(addRound(current, round, regulars, ulid, new Date().toISOString()))
    return true
  }

  function deleteRound(round: CasinoRound) {
    update({ ...current, casino: rounds.filter((r) => r.id !== round.id) })
  }

  const duplicate = current.players.some((p) => p.name === newPlayer.trim())
  // С казино — по «итого», без него — по фишкам, как было
  const sorted = result.hasCasino
    ? [...result.players].sort((x, y) => y.kopecks - x.kopecks)
    : [...result.players].sort((x, y) => y.poker.chips - x.poker.chips)
  const onlyCasino = result.hasCasino && current.entries.length === 0

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
            result={resultById.get(p.id)!}
            entries={current.entries.filter((e) => e.playerId === p.id)}
            closed={!!current.closed}
            suggestIn={lastBuyin}
            quickAmounts={quickAmounts}
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

      {(!current.closed || rounds.length > 0) && (
        <CasinoBlock
          rounds={rounds}
          nameById={nameById}
          players={current.players}
          closed={!!current.closed}
          onAdd={saveRound}
          onDelete={deleteRound}
          onDeal={() => (location.hash = `#/game/${encodeURIComponent(current.id)}/deal`)}
        />
      )}

      <section className="card summary">
        <h2>Итог</h2>
        {!onlyCasino && <p className={b.ok ? 'ok' : 'warn'}>{balanceText(b)}</p>}
        {result.hasCasino && (
          <p className={result.casinoOk ? 'ok' : 'warn'}>
            {result.casinoOk
              ? `Казино сходится: все раунды в ноль (раундов: ${formatNumber(rounds.length)})`
              : 'Казино не сходится — проверьте раунды'}
          </p>
        )}
        {current.players.length > 0 &&
          (result.hasCasino ? (
            <table className="totals three">
              <thead>
                <tr>
                  <th />
                  <th className="num">покер</th>
                  <th className="num">казино</th>
                  <th className="num">итого</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.playerId}>
                    <td>{nameById.get(r.playerId)}</td>
                    <td className="num">{r.inPoker ? formatRub(r.poker.kopecks, true) : '—'}</td>
                    <td className="num">{r.inCasino ? formatRub(r.casino, true) : '—'}</td>
                    <td className={'num ' + sign(r.kopecks)}>
                      <strong>{formatRub(r.kopecks, true)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="totals">
              <tbody>
                {sorted.map(({ poker: t }) => (
                  <tr key={t.playerId}>
                    <td>{nameById.get(t.playerId)}</td>
                    <td className="num">{formatChips(t.chips, true)}</td>
                    <td className={'num ' + sign(t.kopecks)}>{formatRub(t.kopecks, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        <h2>Переводы</h2>
        {!result.ok ? (
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

      <button className="big primary wide" onClick={() => void share()}>
        Поделиться итогом
      </button>
      {shareNote && <p className={shareNote === 'Скопировано' ? 'ok center' : 'warn center'}>{shareNote}</p>}

      <button className="big wide" onClick={() => update({ ...current, closed: !current.closed })}>
        {current.closed ? 'Открыть снова' : 'Закрыть игру'}
      </button>

      {/* Удаление — вторым нажатием, окончательно (Р-09) */}
      {deleting ? (
        <div className="row">
          <button className="big danger grow" onClick={() => void remove()}>
            Точно удалить: {current.name}?
          </button>
          <button className="big" onClick={() => setDeleting(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <button className="big wide danger-text" onClick={() => setDeleting(true)}>
          Удалить игру
        </button>
      )}
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

// Доли раунда одной строкой: «Эрик +150 ₽ · Арман −250 ₽»
function roundText(round: CasinoRound, nameById: Map<string, string>): string {
  return round.amounts.map((a) => `${nameById.get(a.playerId) ?? '?'} ${formatRub(a.kopecks, true)}`).join(' · ')
}

type CasinoBlockProps = {
  rounds: CasinoRound[]
  nameById: Map<string, string>
  players: Player[]
  closed: boolean
  onAdd: (text: string) => boolean // false — передумали добавлять новых участников
  onDelete: (round: CasinoRound) => void
  onDeal: () => void // «Раздать раунд» — экран раунда с картами
}

// Казино (Р-13): раунды строками «Эрик, Артём +150» — каждый названный получает число в рублях
function CasinoBlock({ rounds, nameById, players, closed, onAdd, onDelete, onDeal }: CasinoBlockProps) {
  const [text, setText] = useState<string | null>(null) // не null — вводится раунд
  const [deleting, setDeleting] = useState<string | null>(null) // id раунда после первого нажатия (Р-09)

  const parsed = text === null ? null : parseRound(text)
  const fresh = parsed === null ? [] : newNames(parsed, players)
  const canAdd = parsed !== null && parsed.amounts.length > 0 && parsed.sum === 0 && parsed.bad.length === 0

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!canAdd || text === null) return
    if (onAdd(text)) setText(null)
  }

  return (
    <section className="card casino">
      <h2>Казино</h2>
      {rounds.length > 0 && (
        <ul className="entries rounds">
          {rounds.map((r) =>
            deleting === r.id && !closed ? (
              <li key={r.id} className="row">
                <button className="big danger grow" onClick={() => onDelete(r)}>
                  Точно удалить раунд?
                </button>
                <button className="big" onClick={() => setDeleting(null)}>
                  Отмена
                </button>
              </li>
            ) : (
              <li key={r.id}>
                <span className="muted">{formatTime(r.at)}</span>
                <span>{roundText(r, nameById)}</span>
                {!closed && (
                  <button className="del" aria-label="Удалить раунд" onClick={() => setDeleting(r.id)}>
                    ✕
                  </button>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {rounds.length === 0 && text === null && <p className="muted">Раундов нет</p>}

      {!closed &&
        (text === null ? (
          <div className="row">
            <button className="big grow" onClick={() => setText('')}>
              Добавить раунд
            </button>
            {/* #76: раунд с картами от программы — свой экран, итог — тем же раундом */}
            <button className="big grow" onClick={onDeal}>
              Раздать раунд
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <textarea
              className="round"
              autoFocus
              aria-label="Раунд казино"
              placeholder={'Эрик, Артём +150\nЭдик 550\nАрман, Аскар -250'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <p className="muted">Каждый названный получает число строки в рублях; без знака — плюс</p>
            {parsed !== null && parsed.amounts.length > 0 && (
              <ul className="transfers">
                {parsed.amounts.map((a) => (
                  <li key={a.name}>
                    <span>
                      {a.name}
                      {fresh.includes(a.name) && <span className="muted"> · новый, только казино</span>}
                    </span>
                    <strong className={sign(a.kopecks)}>→ {formatRub(a.kopecks, true)}</strong>
                  </li>
                ))}
              </ul>
            )}
            {parsed !== null && parsed.bad.length > 0 && (
              <p className="warn">Не разобрано: {parsed.bad.map((l) => `«${l}»`).join(', ')}</p>
            )}
            {parsed !== null && parsed.sum !== 0 && (
              <p className="warn">Раунд не сходится на {formatRub(Math.abs(parsed.sum))}</p>
            )}
            <div className="row">
              <button className="big primary grow" disabled={!canAdd}>
                Добавить раунд
              </button>
              <button type="button" className="big" aria-label="Отмена" onClick={() => setText(null)}>
                ✕
              </button>
            </div>
          </form>
        ))}
    </section>
  )
}

type PlayerCardProps = {
  player: Player
  result: PlayerResult
  entries: Entry[]
  closed: boolean
  suggestIn?: number
  quickAmounts: number[]
  onAdd: (kind: EntryKind, chips: number) => void
  onDelete: (entry: Entry) => void
}

function PlayerCard({ player, result, entries, closed, suggestIn, quickAmounts, onAdd, onDelete }: PlayerCardProps) {
  const total = result.poker
  const onlyCasino = !result.inPoker && result.inCasino // покерных записей нет — без «выхода нет» (Р-13)
  const [kind, setKind] = useState<EntryKind | null>(null)
  const [custom, setCustom] = useState(false) // открыто поле своего числа
  const [text, setText] = useState('')
  const chips = parseChips(text)

  // У «Выхода» поле открыто сразу: выход обычно не круглый (Р-07); без быстрых сумм — тоже
  function start(k: EntryKind) {
    setKind(k)
    setCustom(k === 'cashout' || quickAmounts.length === 0)
    setText(k !== 'cashout' && suggestIn ? String(suggestIn) : '')
  }

  function add(k: EntryKind, n: number) {
    onAdd(k, n)
    setKind(null)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (kind === null || chips === null) return
    add(kind, chips)
  }

  return (
    <li className="card player">
      <div className="player-head">
        <strong>{player.name}</strong>
        {onlyCasino ? (
          <span className={sign(result.casino)}>{formatRub(result.casino, true)}</span>
        ) : (
          <span className={sign(total.chips)}>
            {formatChips(total.chips, true)} · {formatRub(total.kopecks, true)}
          </span>
        )}
      </div>
      {onlyCasino ? (
        <p className="muted">только казино</p>
      ) : (
        <p className="muted">
          закуп {formatNumber(total.chipsIn)} · {total.hasCashout ? `выход ${formatNumber(total.chipsOut)}` : 'выхода нет'}
        </p>
      )}

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
          <>
            <p className="pick-title">{KIND_LABEL[kind]}, фишек:</p>
            {quickAmounts.length > 0 && (
              <div className="amounts">
                {quickAmounts.map((a) => (
                  <button key={a} className={'big ' + kind} onClick={() => add(kind, a)}>
                    {formatNumber(a)}
                  </button>
                ))}
              </div>
            )}
            {custom ? (
              <form className="row" onSubmit={submit}>
                <input
                  className="grow"
                  autoFocus
                  inputMode="numeric"
                  pattern="[0-9 ]*"
                  placeholder="Своё число"
                  aria-label={`${KIND_LABEL[kind]}, фишек`}
                  value={text}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setText(e.target.value)}
                />
                <button className="big primary" disabled={chips === null}>
                  {KIND_LABEL[kind]}
                </button>
                <button type="button" className="big" aria-label="Отмена" onClick={() => setKind(null)}>
                  ✕
                </button>
              </form>
            ) : (
              <div className="row">
                <button className="big grow" onClick={() => setCustom(true)}>
                  Другое…
                </button>
                <button className="big" aria-label="Отмена" onClick={() => setKind(null)}>
                  ✕
                </button>
              </div>
            )}
          </>
        ))}
    </li>
  )
}
