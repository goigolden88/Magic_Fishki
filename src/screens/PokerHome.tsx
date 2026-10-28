import { useEffect, useState, type FormEvent } from 'react'
import { parseChips } from '../calc/format'
import { localStartError, startLocalTable } from '../calc/localTable'
import { allPicked, toggleAll } from '../calc/pick'
import { createFailure, DEFAULT_SERVER, NO_CONNECTION, parseRoomLink, roomHash, roomsUrl, serverBase } from '../calc/pokerLink'
import { lookOf, type Look } from '../calc/pokerLook'
import { turnSecondsOf } from '../calc/pokerTimer'
import { formSettings, tournamentForm, type TournamentForm } from '../calc/tournamentForm'
import type { Regular } from '../model'
import type { CardsMode, GameId, Limit } from '../poker/game'
import { PROTOCOL_VERSION, type CreateRoomRequest, type CreateRoomResponse } from '../poker/protocol'
import { DEFAULT_SETTINGS, type Felt, type Settings } from '../poker/table'
import { getSettings } from '../store/db'
import { ulid } from '../ulid'
import { HudFields } from './Hud'
import { LookFields } from './LookFields'
import { LOCAL_HASH, NO_STORAGE } from './PokerLocal'
import {
  clearLocalTable,
  loadLocalTable,
  loadMe,
  loadPassword,
  loadSeats,
  loadServer,
  saveLocalTable,
  saveMe,
  savePassword,
  saveSeat,
  storageWorks,
} from './pokerStorage'
import { TimerFields, timerForm, type TimerForm } from './TimerFields'
import { FormatFields } from './Tournament'

const GUEST = '' // «Вы за столом» — не из постоянных

// «Покер онлайн» (Р-14, Р-19): новая комната, вход по ссылке или коду, свои комнаты.
// Учёт вечера от этого экрана не зависит: нет сети — он работает как раньше
export function PokerHomeScreen() {
  const [creating, setCreating] = useState<'room' | 'local' | null>(null)
  const [local, setLocal] = useState(() => loadLocalTable() !== null)
  const [linkText, setLinkText] = useState('')
  const rooms = Object.keys(loadSeats())
  const link = parseRoomLink(linkText)

  // Стол на телефоне один: идёт — второй не начать, пока не закончен или не удалён
  function removeLocal() {
    if (!confirm('Удалить стол на этом телефоне? Игра в историю не запишется.')) return
    clearLocalTable()
    setLocal(false)
  }

  function enter(e: FormEvent) {
    e.preventDefault()
    if (!link) return
    if (link.seat) saveSeat(link.code, link.seat)
    location.hash = roomHash(link.code)
  }

  return (
    <main className="screen">
      <header className="bar">
        <a className="bar-link" href="#/">
          ← Игры
        </a>
        <a className="bar-link" href="#/help" aria-label="Справка">
          ?
        </a>
      </header>
      <h1>Покер онлайн</h1>
      <p className="muted">
        Ставки — с телефонов; карты — настоящие на столе или на телефонах, это выбирается в новой комнате. Ведущий заводит
        комнату и кидает ссылку в чат. Все за одним столом — «Стол на этом телефоне»: ведущий ходит за каждого, сеть не
        нужна, карты живые.
      </p>

      {local && (
        <section className="card">
          <h2>Стол на этом телефоне идёт</h2>
          <a className="big primary wide button-link" href={LOCAL_HASH}>
            Продолжить стол
          </a>
          <button type="button" className="big wide danger-text" onClick={removeLocal}>
            Удалить стол
          </button>
        </section>
      )}

      {creating === 'room' ? (
        <NewRoomCard onCancel={() => setCreating(null)} />
      ) : creating === 'local' ? (
        <NewLocalCard onCancel={() => setCreating(null)} />
      ) : (
        <div className="row">
          <button type="button" className="big primary grow" onClick={() => setCreating('room')}>
            Новая комната
          </button>
          {!local && (
            <button type="button" className="big primary grow" onClick={() => setCreating('local')}>
              Стол на этом телефоне
            </button>
          )}
        </div>
      )}

      {rooms.length > 0 && (
        <section className="card">
          <h2>Мои столы</h2>
          {rooms.map((code) => (
            <a key={code} className="big wide button-link" href={roomHash(code)}>
              Стол {code}
            </a>
          ))}
        </section>
      )}

      <form className="card" onSubmit={enter}>
        <h2>Войти по ссылке</h2>
        <label className="field">
          Ссылка или код комнаты
          <input value={linkText} onChange={(e) => setLinkText(e.target.value)} placeholder="Например, KQ7MZP" />
        </label>
        {linkText.trim() !== '' && !link && <p className="warn">Не похоже на ссылку на стол или код из 6 знаков</p>}
        <button className="big primary wide" disabled={!link}>
          Войти
        </button>
      </form>
    </main>
  )
}

function NewRoomCard({ onCancel }: { onCancel: () => void }) {
  const [regulars, setRegulars] = useState<Regular[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [meId, setMeId] = useState(GUEST)
  const [myName, setMyName] = useState('')
  const [hasPassword, setHasPassword] = useState(() => loadPassword() !== '')
  const [password, setPassword] = useState('')
  const [sbText, setSbText] = useState(String(DEFAULT_SETTINGS.sb))
  const [bbText, setBbText] = useState(String(DEFAULT_SETTINGS.bb))
  const [stackText, setStackText] = useState('')
  const [cards, setCards] = useState<CardsMode>(DEFAULT_SETTINGS.cards)
  const [variant, setVariant] = useState<GameChoice>(DEFAULT_GAME)
  const [timer, setTimer] = useState<TimerForm>(() =>
    timerForm(DEFAULT_SETTINGS.turnSeconds ?? null, DEFAULT_SETTINGS.autoStart ?? 'off'),
  )
  const [look, setLook] = useState<Look>(() => lookOf(DEFAULT_SETTINGS))
  const [format, setFormat] = useState<TournamentForm>(() => tournamentForm(0))
  const [publicHud, setPublicHud] = useState(false) // HUD (#79): по умолчанию — каждый только свою
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getSettings().then((s) => {
      setRegulars(s.players)
      setPicked(new Set(s.players.map((r) => r.id)))
      setStackText(String(s.defaultBuyin))
      const me = loadMe()
      setMeId(s.players.some((r) => r.id === me) ? me : (s.players[0]?.id ?? GUEST))
    })
  }, [])

  function toggle(id: string) {
    const next = new Set(picked)
    if (!next.delete(id)) next.add(id)
    setPicked(next)
    if (id === meId && !next.has(id)) setMeId(GUEST)
  }

  // «Выбрать всех» / «Снять все»; снятый ведущий — как при снятии одной галочки
  function toggleEveryone() {
    const next = toggleAll(regularIds, picked)
    setPicked(next)
    if (!next.has(meId)) setMeId(GUEST)
  }

  const sb = parseChips(sbText)
  const bb = parseChips(bbText)
  const stack = parseChips(stackText)
  const roster = (regulars ?? []).filter((r) => picked.has(r.id))
  const regularIds = (regulars ?? []).map((r) => r.id)
  const me = roster.find((r) => r.id === meId)
  const name = me ? me.name : myName.trim()
  const blindsOk = sb !== null && bb !== null && sb <= bb
  const turn = turnSecondsOf(timer.choice, timer.text)
  const game = formSettings(format)
  const ready = name !== '' && blindsOk && stack !== null && turn.ok && game.ok && (hasPassword || password !== '') && !busy

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!ready || sb === null || bb === null || stack === null || !turn.ok || !game.ok) return
    const secret = hasPassword ? loadPassword() : password
    const body: CreateRoomRequest = {
      v: PROTOCOL_VERSION,
      password: secret,
      name,
      ...(me ? { regularId: me.id } : {}),
      roster,
      settings: {
        sb,
        bb,
        startingStack: stack,
        cards,
        ...gameSettings(variant),
        turnSeconds: turn.seconds,
        autoStart: timer.autoStart,
        ...look,
        ...game.settings,
        publicHud,
      },
    }
    setBusy(true)
    setError(null)
    let res: CreateRoomResponse
    try {
      const r = await fetch(roomsUrl(serverBase(loadServer()) ?? DEFAULT_SERVER), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      res = (await r.json()) as CreateRoomResponse
    } catch {
      setBusy(false)
      setError(NO_CONNECTION)
      return
    }
    setBusy(false)
    if ('error' in res) {
      const f = createFailure(res.error)
      if (f.kind === 'password') {
        savePassword('')
        setHasPassword(false)
        setPassword('')
      }
      setError(f.text)
      return
    }
    // Пароль верный — телефон его запомнил; место ведущего — как у всех, по коду комнаты
    savePassword(secret)
    saveMe(me ? me.id : '')
    saveSeat(res.code, { playerId: res.playerId, token: res.token })
    location.hash = roomHash(res.code)
  }

  if (regulars === null) return null
  return (
    <form className="card" onSubmit={(e) => void create(e)}>
      <h2>Новая комната</h2>

      {hasPassword ? (
        <p className="muted">
          Пароль компании запомнен на этом телефоне.
          <button
            type="button"
            className="link"
            onClick={() => {
              savePassword('')
              setHasPassword(false)
            }}
          >
            Ввести другой
          </button>
        </p>
      ) : (
        <label className="field">
          Пароль компании
          <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          <span className="muted">Его знает только ведущий; телефон запомнит его после первой комнаты.</span>
        </label>
      )}

      {regulars.length > 0 && (
        <fieldset className="players-pick">
          <legend className="muted">
            Играют: {picked.size} из {regulars.length}
          </legend>
          <button type="button" className="big wide" onClick={toggleEveryone}>
            {allPicked(regularIds, picked) ? 'Снять все' : 'Выбрать всех'}
          </button>
          {regulars.map((r) => (
            <label key={r.id} className="check">
              <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
              {r.name}
            </label>
          ))}
          <p className="muted">Отмеченные выберут себя из списка по ссылке; остальные войдут гостями.</p>
        </fieldset>
      )}

      <label className="field">
        Вы за столом
        <select className="merge" value={meId} onChange={(e) => setMeId(e.target.value)}>
          {roster.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
          <option value={GUEST}>Другое имя…</option>
        </select>
      </label>
      {!me && (
        <label className="field">
          Ваше имя
          <input value={myName} onChange={(e) => setMyName(e.target.value)} />
        </label>
      )}

      <TableFields
        sb={[sbText, setSbText]}
        bb={[bbText, setBbText]}
        stack={[stackText, setStackText]}
        tournament={format.format === 'tournament'}
      />
      {/* #78: кэш с анте или турнир; призы по умолчанию — по отмеченным, гостей до входа не видно */}
      <FormatFields form={format} players={roster.length} onChange={setFormat} />
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
              onClick={() => setCards(mode)}
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

      <GameFields choice={variant} phones={cards === 'phones'} onChange={setVariant} />

      {/* #75: стол на одном телефоне — без таймера и раздачи «сама» */}
      <TimerFields form={timer} onChange={setTimer} />

      <LookFields look={look} backs onChange={(l) => setLook({ ...look, ...l })} />
      {cards === 'live' && <p className="muted">Карты живые — рубашка на экране не видна.</p>}

      {/* #79: стол на одном телефоне — HUD видят все, выбора там нет */}
      <HudFields all={publicHud} onChange={setPublicHud} />

      {error && <p className="warn">{error}</p>}
      <div className="row">
        <button className="big primary grow" disabled={!ready}>
          {busy ? 'Создаём…' : 'Создать комнату'}
        </button>
        <button type="button" className="big" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  )
}

const CARDS_MODES: [CardsMode, string][] = [
  ['live', 'Живые'],
  ['phones', 'На телефонах'],
]

// Игра и лимит стола (#80): холдем — без лимита; у омахи — пот-лимит (по умолчанию) или без лимита
type GameChoice = { game: GameId; limit: Limit }

const GAME_CHOICES: [GameId, string][] = [
  ['holdem', 'Холдем'],
  ['omaha', 'Омаха'],
]

const LIMIT_CHOICES: [Limit, string][] = [
  ['pot', 'Пот-лимит'],
  ['nolimit', 'Без лимита'],
]

const DEFAULT_GAME: GameChoice = { game: 'holdem', limit: 'pot' }

// В настройки стола: лимит — только у омахи
function gameSettings(c: GameChoice): Pick<Settings, 'game' | 'limit'> {
  return c.game === 'omaha' ? { game: c.game, limit: c.limit } : { game: c.game }
}

function GameFields({ choice, phones, onChange }: { choice: GameChoice; phones: boolean; onChange: (c: GameChoice) => void }) {
  const omaha = choice.game === 'omaha'
  return (
    <fieldset className="players-pick">
      <legend className="muted">Игра</legend>
      <div className="row">
        {GAME_CHOICES.map(([game, label]) => (
          <button
            key={game}
            type="button"
            className={choice.game === game ? 'big primary grow' : 'big grow'}
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
        {!omaha
          ? 'Две карты на руках, ставки без лимита.'
          : `Четыре карты на руках, рука — ровно две свои и три со стола${phones ? '' : ' (карты живые)'}. ${
              choice.limit === 'pot' ? 'Рейз — не больше банка.' : 'Ставки без лимита.'
            }`}
      </p>
    </fieldset>
  )
}

type Field = [string, (text: string) => void]

// Блайнды и стартовый стек — одни у комнаты и у стола на телефоне; в турнире блайнды — стартовые
function TableFields({ sb, bb, stack, tournament }: { sb: Field; bb: Field; stack: Field; tournament: boolean }) {
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

// Стол на этом телефоне (Р-21): кто играет — постоянные и гости по имени; без пароля и сервера
function NewLocalCard({ onCancel }: { onCancel: () => void }) {
  const [regulars, setRegulars] = useState<Regular[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [guests, setGuests] = useState<string[]>([])
  const [guestName, setGuestName] = useState('')
  const [sbText, setSbText] = useState(String(DEFAULT_SETTINGS.sb))
  const [bbText, setBbText] = useState(String(DEFAULT_SETTINGS.bb))
  const [stackText, setStackText] = useState('')
  const [felt, setFelt] = useState<Felt>(() => lookOf(DEFAULT_SETTINGS).felt)
  const [variant, setVariant] = useState<GameChoice>(DEFAULT_GAME)
  const [format, setFormat] = useState<TournamentForm>(() => tournamentForm(0))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void getSettings().then((s) => {
      setRegulars(s.players)
      setPicked(new Set(s.players.map((r) => r.id)))
      setStackText(String(s.defaultBuyin))
    })
  }, [])

  function toggle(id: string) {
    const next = new Set(picked)
    if (!next.delete(id)) next.add(id)
    setPicked(next)
  }

  function addGuest(e: FormEvent) {
    e.preventDefault()
    const name = guestName.trim()
    if (!name) return
    setGuests([...guests, name])
    setGuestName('')
  }

  const sb = parseChips(sbText)
  const bb = parseChips(bbText)
  const stack = parseChips(stackText)
  const regularIds = (regulars ?? []).map((r) => r.id)
  const players = [
    ...(regulars ?? []).filter((r) => picked.has(r.id)).map((r) => ({ name: r.name, regularId: r.id })),
    ...guests.map((name) => ({ name, regularId: null })),
  ]
  const countError = localStartError(players.length)
  const game = formSettings(format)
  const ready = countError === null && sb !== null && bb !== null && sb <= bb && stack !== null && game.ok

  function begin() {
    if (!ready || sb === null || bb === null || stack === null || !game.ok) return
    if (loadLocalTable()) {
      setError('Стол на этом телефоне уже идёт — закончите или удалите его')
      return
    }
    const r = startLocalTable(players, { sb, bb, startingStack: stack, felt, ...game.settings, ...gameSettings(variant) }, Date.now(), () => ulid())
    if (!r.ok) {
      setError(r.error)
      return
    }
    saveLocalTable(r.local)
    location.hash = LOCAL_HASH
  }

  if (regulars === null) return null
  return (
    <section className="card">
      <h2>Стол на этом телефоне</h2>
      <p className="muted">Ведущий ходит за каждого с этого телефона. Без сервера, пароля и сети.</p>
      {!storageWorks() && <p className="warn">{NO_STORAGE}</p>}

      {regulars.length > 0 && (
        <fieldset className="players-pick">
          <legend className="muted">
            Играют: {picked.size} из {regulars.length}
          </legend>
          <button type="button" className="big wide" onClick={() => setPicked(toggleAll(regularIds, picked))}>
            {allPicked(regularIds, picked) ? 'Снять все' : 'Выбрать всех'}
          </button>
          {regulars.map((r) => (
            <label key={r.id} className="check">
              <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} />
              {r.name}
            </label>
          ))}
        </fieldset>
      )}

      {guests.length > 0 && (
        <ul className="list items">
          {guests.map((g, i) => (
            <li key={i} className="row">
              <span className="grow">{g}</span>
              <button
                type="button"
                className="big"
                aria-label={`Убрать гостя ${g}`}
                onClick={() => setGuests(guests.filter((_, k) => k !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="row" onSubmit={addGuest}>
        <input
          className="grow"
          aria-label="Имя гостя"
          placeholder="Гость — имя"
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
        />
        <button className="big" disabled={!guestName.trim()}>
          Добавить
        </button>
      </form>

      <TableFields
        sb={[sbText, setSbText]}
        bb={[bbText, setBbText]}
        stack={[stackText, setStackText]}
        tournament={format.format === 'tournament'}
      />
      {/* #78: те же кэш с анте и турнир, что у комнаты */}
      <FormatFields form={format} players={players.length} onChange={setFormat} />
      {!game.ok && <p className="warn">{game.error}</p>}

      {/* #80: игра и лимит — карты живые, лимит считает программа */}
      <GameFields choice={variant} phones={false} onChange={setVariant} />

      {/* Карты живые (Р-21) — рубашки нет, только сукно */}
      <LookFields look={{ ...lookOf(DEFAULT_SETTINGS), felt }} backs={false} onChange={(l) => l.felt && setFelt(l.felt)} />

      <p className="muted">За столом: {players.length}</p>
      {countError && <p className="warn">{countError}</p>}
      {error && <p className="warn">{error}</p>}
      <div className="row">
        <button type="button" className="big primary grow" disabled={!ready} onClick={begin}>
          Начать
        </button>
        <button type="button" className="big" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </section>
  )
}
