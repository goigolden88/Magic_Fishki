import { useEffect, useState, type FormEvent } from 'react'
import { parseChips } from '../calc/format'
import { createFailure, DEFAULT_SERVER, NO_CONNECTION, parseRoomLink, roomHash, roomsUrl, serverBase } from '../calc/pokerLink'
import type { Regular } from '../model'
import { PROTOCOL_VERSION, type CreateRoomRequest, type CreateRoomResponse } from '../poker/protocol'
import { DEFAULT_SETTINGS } from '../poker/table'
import { getSettings } from '../store/db'
import { loadMe, loadPassword, loadSeats, loadServer, saveMe, savePassword, saveSeat } from './pokerStorage'

const GUEST = '' // «Вы за столом» — не из постоянных

// «Покер онлайн» (Р-14, Р-19): новая комната, вход по ссылке или коду, свои комнаты.
// Учёт вечера от этого экрана не зависит: нет сети — он работает как раньше
export function PokerHomeScreen() {
  const [creating, setCreating] = useState(false)
  const [linkText, setLinkText] = useState('')
  const rooms = Object.keys(loadSeats())
  const link = parseRoomLink(linkText)

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
      <p className="muted">Карты — настоящие, на столе; ставки — с телефонов. Ведущий заводит комнату и кидает ссылку в чат.</p>

      {creating ? (
        <NewRoomCard onCancel={() => setCreating(false)} />
      ) : (
        <button type="button" className="big primary wide" onClick={() => setCreating(true)}>
          Новая комната
        </button>
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

  const sb = parseChips(sbText)
  const bb = parseChips(bbText)
  const stack = parseChips(stackText)
  const roster = (regulars ?? []).filter((r) => picked.has(r.id))
  const me = roster.find((r) => r.id === meId)
  const name = me ? me.name : myName.trim()
  const blindsOk = sb !== null && bb !== null && sb <= bb
  const ready = name !== '' && blindsOk && stack !== null && (hasPassword || password !== '') && !busy

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!ready || sb === null || bb === null || stack === null) return
    const secret = hasPassword ? loadPassword() : password
    const body: CreateRoomRequest = {
      v: PROTOCOL_VERSION,
      password: secret,
      name,
      ...(me ? { regularId: me.id } : {}),
      roster,
      settings: { sb, bb, startingStack: stack },
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

      <div className="draft-grid">
        <label className="field">
          Малый блайнд
          <input inputMode="numeric" pattern="[0-9 ]*" value={sbText} onChange={(e) => setSbText(e.target.value)} />
        </label>
        <label className="field">
          Большой блайнд
          <input inputMode="numeric" pattern="[0-9 ]*" value={bbText} onChange={(e) => setBbText(e.target.value)} />
        </label>
        <label className="field rebuys">
          Стартовый стек, фишек
          <input inputMode="numeric" pattern="[0-9 ]*" value={stackText} onChange={(e) => setStackText(e.target.value)} />
        </label>
      </div>
      {!blindsOk && <p className="warn">Блайнды — целые числа больше нуля, малый не больше большого</p>}
      {stack === null && <p className="warn">Стек — целое число фишек больше нуля</p>}

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
