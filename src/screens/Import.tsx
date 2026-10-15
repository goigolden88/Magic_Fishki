import { useEffect, useState, type FormEvent } from 'react'
import { parseRound } from '../calc/casino'
import { balanceText, formatNumber, formatRate, formatRub, parseChips, parseRate } from '../calc/format'
import {
  addCasinoPlayer,
  addDraftPlayer,
  assignRegular,
  badRounds,
  casinoNames,
  casinoOnly,
  casinoPlayer,
  cashoutTotal,
  draftFromChat,
  duplicateNames,
  gameFromDraft,
  linkCasinoName,
  mergeDraftPlayers,
  nameKey,
  parseChat,
  removeRound,
  setCashout,
  setRebuyCount,
  setRoundText,
  type CasinoName,
  type Draft,
  type DraftPlayer,
  type DraftRound,
} from '../calc/telegram'
import { balance, playerTotals } from '../calc/totals'
import { formatDate, formatTime } from '../dates'
import { playerByName, type Regular } from '../model'
import { getSettings, saveGame } from '../store/db'
import { ulid } from '../ulid'

// Игра из Телеграма (Р-10): вставка текста → сверка → обычная игра
export function ImportScreen() {
  const [text, setText] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [unparsed, setUnparsed] = useState<string[]>([])
  const [name, setName] = useState('')
  const [rateText, setRateText] = useState('')
  const [regularList, setRegularList] = useState<Regular[]>([]) // постоянные игроки: подсказка имён и связь (Р-12)
  const [newPlayer, setNewPlayer] = useState('')

  useEffect(() => {
    void getSettings().then((s) => {
      setRegularList(s.players)
      setRateText(formatRate(s.defaultRate))
    })
  }, [])

  async function parse() {
    const settings = await getSettings()
    const chat = parseChat(text)
    const next = draftFromChat(chat, settings.defaultBuyin, () => ulid())
    setNotFound(next === null)
    if (!next) return
    setDraft(next)
    setUnparsed(chat.unparsed)
    setName(formatDate(next.date))
    window.scrollTo(0, 0)
  }

  if (draft === null) {
    return (
      <main className="screen">
        <BackBar />
        <h1>Из Телеграма</h1>
        <p className="muted">
          Выделите в чате сообщения #rebuy, #cashout, раунды казино и #debt, нажмите «Копировать» и вставьте сюда.
        </p>
        <textarea
          className="paste"
          placeholder="[05.06.2026 22:10] Аня: #rebuy Гоша"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setNotFound(false)
          }}
        />
        {notFound && <p className="warn">Не нашёл записей #rebuy, #cashout и раундов казино</p>}
        <button className="big primary wide" disabled={!text.trim()} onClick={() => void parse()}>
          Разобрать
        </button>
      </main>
    )
  }

  const current = draft
  const regulars = regularList.map((r) => r.name)
  const preview = gameFromDraft(current, { name: '', rate: 1, now: '' }, counter(), [])
  const b = balance(playerTotals(preview.players, preview.entries, preview.rate))
  const dups = duplicateNames(current)
  const empty = current.players.some((p) => !p.name.trim())
  const rate = parseRate(rateText)
  const names = casinoNames(current)
  const unresolved = names.filter((n) => n.player === null)
  const bad = badRounds(current)
  const canCreate =
    rate !== null && current.players.length > 0 && dups.length === 0 && !empty && unresolved.length === 0 && bad.length === 0

  // С кем из постоянных участник свяжется при сохранении — то же правило, что в gameFromDraft (Р-12)
  function linkedRegular(p: DraftPlayer): string | undefined {
    const { regularId } = playerByName(p.name.trim(), regularList, p.id)
    return regularList.find((r) => r.id === regularId)?.name
  }

  function updatePlayer(id: string, fn: (p: DraftPlayer) => DraftPlayer) {
    setDraft({ ...current, players: current.players.map((p) => (p.id === id ? fn(p) : p)) })
  }

  function remove(p: DraftPlayer) {
    if (!confirm(`Убрать ${p.name || 'игрока'} из игры?`)) return
    setDraft({ ...current, players: current.players.filter((x) => x.id !== p.id) })
  }

  const newName = newPlayer.trim()
  const taken = current.players.some((p) => p.name.trim().toLowerCase() === newName.toLowerCase())
  function addPlayer(e: FormEvent) {
    e.preventDefault()
    if (!newName || taken) return
    setDraft(addDraftPlayer(current, newName, () => ulid()))
    setNewPlayer('')
  }

  async function create() {
    if (!canCreate || rate === null) return
    const game = gameFromDraft(
      current,
      { name: name.trim() || formatDate(current.date), rate, now: new Date().toISOString() },
      () => ulid(),
      regularList,
    )
    await saveGame(game)
    location.hash = `#/game/${game.id}`
  }

  return (
    <main className="screen">
      <BackBar />
      <h1>Сверка</h1>
      <p className="muted">
        {formatDate(current.date)} · докуп — {formatNumber(current.rebuy)} фишек
      </p>

      <section className="card">
        <label className="field">
          Название
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Курс, ₽ за фишку
          <input inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} />
        </label>
        {rate === null && <p className="warn">Курс — число больше нуля, например 0,5</p>}
      </section>

      <datalist id="regulars">
        {regulars.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>

      <ul className="list">
        {current.players.map((p) => (
          <DraftCard
            key={p.id}
            player={p}
            others={current.players.filter((x) => x.id !== p.id)}
            regulars={regulars}
            regular={linkedRegular(p)}
            onChange={(fn) => updatePlayer(p.id, fn)}
            onRebuys={(n) => updatePlayer(p.id, (x) => setRebuyCount(x, n, current.end))}
            onCashout={(chips) => updatePlayer(p.id, (x) => setCashout(x, chips, current.end))}
            onMerge={(intoId) => setDraft(mergeDraftPlayers(current, p.id, intoId))}
            onRegular={(regular) => setDraft(assignRegular(current, p.id, regular))}
            onRemove={() => remove(p)}
          />
        ))}
      </ul>

      <form className="card row" onSubmit={addPlayer}>
        <input
          className="grow"
          list="regulars"
          placeholder="Кого нет в тексте"
          value={newPlayer}
          onChange={(e) => setNewPlayer(e.target.value)}
        />
        <button className="big primary" disabled={!newName || taken}>
          Добавить игрока
        </button>
      </form>
      {taken && <p className="warn">Такой игрок уже есть</p>}

      {current.rounds.length > 0 && (
        <>
          <section className="card casino">
            <h2>Казино: кто есть кто</h2>
            <p className="muted">Имена из раундов — как в чате; у каждого — участник игры</p>
            <ul className="list casino-names">
              {names.map((n) => (
                <CasinoNameRow
                  key={nameKey(n.name)}
                  item={n}
                  players={current.players}
                  onLink={(id) => setDraft(linkCasinoName(current, n.name, id))}
                  onNew={() => setDraft(addCasinoPlayer(current, n.name, () => ulid()))}
                />
              ))}
            </ul>
          </section>

          <h2>Раунды казино: {current.rounds.length}</h2>
          <ul className="list">
            {current.rounds.map((r) => (
              <RoundCard
                key={r.id}
                round={r}
                draft={current}
                onText={(text) => setDraft(setRoundText(current, r.id, text))}
                onRemove={() => {
                  if (confirm('Убрать раунд из игры?')) setDraft(removeRound(current, r.id))
                }}
              />
            ))}
          </ul>
        </>
      )}

      <section className="card summary">
        <h2>Проверка</h2>
        <p className={b.ok ? 'ok' : 'warn'}>{balanceText(b)}</p>
        {current.rounds.length > 0 && bad.length === 0 && (
          <p className="ok">Казино: все раунды сходятся ({current.rounds.length})</p>
        )}
        {bad.length > 0 && <p className="warn">Казино: раундов с ошибкой — {bad.length}; поправьте или уберите</p>}
        {unresolved.length > 0 && (
          <p className="warn">Не разобраны имена: {unresolved.map((n) => n.name).join(', ')} — выберите, кто это</p>
        )}
        {dups.length > 0 && <p className="warn">Одинаковые имена: {dups.join(', ')} — объедините или переименуйте</p>}
        {empty && <p className="warn">У игрока нет имени</p>}
      </section>

      {unparsed.length > 0 && (
        <section className="card">
          <h2>Не разобрано: {unparsed.length} {linesWord(unparsed.length)}</h2>
          <ul className="unparsed">
            {unparsed.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      <button className="big primary wide" disabled={!canCreate} onClick={() => void create()}>
        Создать игру
      </button>
      <button className="big wide" onClick={() => setDraft(null)}>
        Назад к тексту
      </button>
    </main>
  )
}

// Для проверки на лету id записей не нужны настоящие
function counter() {
  let n = 0
  return () => String(n++)
}

// «1 строка», «2 строки», «5 строк»
function linesWord(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'строка'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'строки'
  return 'строк'
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

type DraftCardProps = {
  player: DraftPlayer
  others: DraftPlayer[]
  regulars: string[]
  regular?: string // постоянный, с кем участник будет связан; нет — гость
  onChange: (fn: (p: DraftPlayer) => DraftPlayer) => void
  onRebuys: (count: number) => void
  onCashout: (chips: number) => void
  onMerge: (intoId: string) => void
  onRegular: (name: string) => void
  onRemove: () => void
}

function DraftCard({ player, others, regulars, regular, onChange, onRebuys, onCashout, onMerge, onRegular, onRemove }: DraftCardProps) {
  const rebuys = player.rebuys.length
  function pick(value: string) {
    if (value.startsWith('r:')) onRegular(value.slice(2))
    else if (value.startsWith('m:')) onMerge(value.slice(2))
  }
  return (
    <li className="card player">
      <div className="row draft-name">
        <input
          className="grow"
          list="regulars"
          aria-label="Имя игрока"
          value={player.name}
          onChange={(e) => onChange((p) => ({ ...p, name: e.target.value }))}
        />
        <button className="big" aria-label="Убрать игрока" onClick={onRemove}>
          ✕
        </button>
      </div>

      <div className="draft-grid">
        <label className="field">
          Закуп
          <ChipsInput value={player.buyin} onChange={(n) => onChange((p) => ({ ...p, buyin: n }))} />
        </label>
        <label className="field">
          Выход
          <ChipsInput value={cashoutTotal(player)} onChange={onCashout} />
        </label>
        <div className="field rebuys">
          Докупов
          <div className="stepper">
            <button className="big icon" aria-label="Докупом меньше" disabled={rebuys === 0} onClick={() => onRebuys(rebuys - 1)}>
              −
            </button>
            <strong>{rebuys}</strong>
            <button className="big icon" aria-label="Докупом больше" onClick={() => onRebuys(rebuys + 1)}>
              +
            </button>
          </div>
        </div>
      </div>

      {/* Полный список, без оглядки на набранное в поле имени: r: — постоянный игрок, m: — игрок сверки.
          Выбранным показан постоянный, с кем участник свяжется при сохранении */}
      <select className="merge" value={regular === undefined ? '' : `r:${regular}`} onChange={(e) => pick(e.target.value)}>
        <option value="">Это тот же, что…</option>
        {regulars.length > 0 ? (
          <optgroup label="Постоянный игрок">
            {regulars.map((r) => (
              <option key={r} value={`r:${r}`}>
                {r}
              </option>
            ))}
          </optgroup>
        ) : (
          <option disabled>Постоянных игроков нет — их задают в настройках</option>
        )}
        {others.length > 0 && (
          <optgroup label="Игрок этой игры — объединить">
            {others.map((o) => (
              <option key={o.id} value={`m:${o.id}`}>
                {o.name || 'без имени'}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {regular === undefined && <p className="muted guest">Гость — не из постоянных игроков</p>}
      {casinoOnly(player) && <p className="muted guest">Только казино — без закупа и выхода</p>}
    </li>
  )
}

type CasinoNameRowProps = {
  item: CasinoName
  players: DraftPlayer[]
  onLink: (playerId: string) => void
  onNew: () => void
}

// Имя из раундов → участник: подошёл один — выбран сам; двое или никого — выбрать руками
function CasinoNameRow({ item, players, onLink, onNew }: CasinoNameRowProps) {
  const { name, player, candidates } = item
  return (
    <li>
      <strong>{name}</strong>
      <select
        className="merge"
        aria-label={`Кто это: ${name}`}
        value={player?.id ?? ''}
        onChange={(e) => (e.target.value === 'new' ? onNew() : e.target.value && onLink(e.target.value))}
      >
        <option value="">Кто это?</option>
        {players.length > 0 && (
          <optgroup label="Игрок этой игры">
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || 'без имени'}
              </option>
            ))}
          </optgroup>
        )}
        <option value="new">Новый участник, только казино: {name}</option>
      </select>
      {player === null && (
        <p className="warn">
          {candidates.length > 1
            ? `Подходит к ${candidates.length}: ${candidates.map((p) => p.name).join(', ')} — выберите`
            : 'Нет такого игрока — выберите или добавьте нового'}
        </p>
      )}
    </li>
  )
}

type RoundCardProps = {
  round: DraftRound
  draft: Draft
  onText: (text: string) => void
  onRemove: () => void
}

// Раунд казино: доли с участником для каждого имени; не сходится — пометка, правка строками или «Убрать»
function RoundCard({ round, draft, onText, onRemove }: RoundCardProps) {
  const [editing, setEditing] = useState(false)
  const parsed = parseRound(round.text)
  return (
    <li className="card">
      <div className="row round-head">
        <span className="muted grow">{formatTime(round.at)}</span>
        <button className="big" onClick={() => setEditing(!editing)}>
          {editing ? 'Готово' : 'Править'}
        </button>
        <button className="big" aria-label="Убрать раунд" onClick={onRemove}>
          ✕
        </button>
      </div>
      {editing && (
        <textarea
          className="round"
          aria-label="Раунд казино"
          placeholder={'Гоша, Дима +150\nКатя -300'}
          value={round.text}
          onChange={(e) => onText(e.target.value)}
        />
      )}
      {parsed.amounts.length > 0 && (
        <ul className="transfers">
          {parsed.amounts.map((a) => {
            const p = casinoPlayer(draft, a.name)
            return (
              <li key={a.name}>
                <span>
                  {p ? p.name || 'без имени' : a.name}
                  {p && nameKey(p.name) !== nameKey(a.name) && <span className="muted"> · в чате «{a.name}»</span>}
                  {!p && <span className="warn"> · кто это?</span>}
                </span>
                <strong className={a.kopecks > 0 ? 'plus' : 'minus'}>{formatRub(a.kopecks, true)}</strong>
              </li>
            )
          })}
        </ul>
      )}
      {parsed.amounts.length === 0 && <p className="warn">Раунд пустой — уберите или впишите строки</p>}
      {parsed.bad.length > 0 && <p className="warn">Не разобрано: {parsed.bad.map((l) => `«${l}»`).join(', ')}</p>}
      {parsed.sum !== 0 && <p className="warn">Не сходится на {formatRub(Math.abs(parsed.sum))}</p>}
    </li>
  )
}

// Целое число фишек; пусто — 0. Правка на лету, пока набирают — текст свой
function ChipsInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(value ? String(value) : '')
  const parsed = text.trim() === '' ? 0 : parseChips(text)

  // Значение поменялось снаружи (объединили игроков) — поле показывает новое
  useEffect(() => {
    if (parsed !== value) setText(value ? String(value) : '')
  }, [value])

  return (
    <input
      inputMode="numeric"
      pattern="[0-9 ]*"
      placeholder="0"
      className={parsed === null ? 'bad' : ''}
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        setText(e.target.value)
        const n = e.target.value.trim() === '' ? 0 : parseChips(e.target.value)
        if (n !== null) onChange(n)
      }}
    />
  )
}
