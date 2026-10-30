import { useEffect, useRef, useState } from 'react'
import { BOT_LEVELS } from '../calc/bot'
import {
  BOT_PAUSE_MS,
  botStep,
  botTableView,
  botToAct,
  dealBotHand,
  iAmBroke,
  myMove,
  myRebuy,
  type BotStep,
  type BotTable,
} from '../calc/botTable'
import { formatNumber } from '../calc/format'
import { dockOf, waitLine } from '../calc/pokerLayout'
import { lookClass } from '../calc/pokerLook'
import { handFor } from '../poker/history'
import { NO_STORAGE } from './PokerLocal'
import { ActionsCard, blindsLine, HandHistory, HostDock, LastHand, PokerTable, PotList } from './PokerRoom'
import { clearBotTable, loadBotTable, saveBotTable, storageWorks } from './pokerStorage'

// Адрес стола с ботами: под код комнаты (6 знаков) не подходит
export const BOTS_HASH = '#/poker/bots'

type Apply = (make: (bots: BotTable, now: number) => BotStep) => boolean

// Против ботов (#117, Р-38): я и боты за одним столом на этом телефоне. Карты раздаёт программа, боты ходят
// сами через паузу; правила src/poker/ — прямо здесь, стол — в памяти устройства после каждого хода
export function PokerBotsScreen() {
  const [bots, setBots] = useState<BotTable | null>(() => loadBotTable())
  const [volatile, setVolatile] = useState(() => !storageWorks())
  const [error, setError] = useState<string | null>(null)
  // Последний стол — для хода бота по таймеру: замыкание эффекта могло устареть
  const latest = useRef(bots)
  latest.current = bots

  // Ход за себя или за бота: удался — стол сразу в память устройства
  const apply: Apply = (make) => {
    const bt = latest.current
    if (!bt) return false
    const r = make(bt, Date.now())
    if (!r.ok) {
      setError(r.error)
      return false
    }
    if (!saveBotTable(r.bots)) setVolatile(true)
    latest.current = r.bots
    setBots(r.bots)
    setError(null)
    return true
  }

  // Очередь бота — он ходит сам через паузу. Метка — раздача и число ходов в ней: новый ход — новый таймер
  const hand = bots?.table.hand
  const mark = bots && hand && botToAct(bots) ? `${hand.number}-${hand.log.length}` : null
  useEffect(() => {
    if (!mark) return
    const id = setTimeout(() => apply((bt, now) => botStep(bt, now, Math.random)), BOT_PAUSE_MS)
    return () => clearTimeout(id)
  }, [mark])

  // «Закончить»: стол удаляется; в историю, учёт и «Прошлые вечера» ничего не идёт
  function finish() {
    if (!confirm('Закончить игру с ботами? Стол удалится, в историю ничего не запишется.')) return
    clearBotTable()
    location.hash = '#/poker'
  }

  return (
    <main className={bots ? 'screen poker table-screen' : 'screen poker'}>
      <header className="bar">
        <a className="bar-link" href="#/poker">
          ← Покер
        </a>
        {bots && <h1 className="bar-title">Против ботов</h1>}
      </header>
      {!bots && <h1>Против ботов</h1>}
      {volatile && bots && <p className="card warn">{NO_STORAGE}</p>}

      {!bots ? (
        <section className="card">
          <p className="muted">Стола с ботами нет — начните его на экране «Играть».</p>
          <a className="big primary wide button-link" href="#/poker">
            К покеру
          </a>
        </section>
      ) : (
        <BotTableCard bots={bots} error={error} onError={setError} apply={apply} onFinish={finish} />
      )}
    </main>
  )
}

function BotTableCard(props: {
  bots: BotTable
  error: string | null
  onError: (error: string | null) => void
  apply: Apply
  onFinish: () => void
}) {
  const { bots, error, onError, apply, onFinish } = props
  const [showHistory, setShowHistory] = useState(false)
  const table = bots.table
  const v = botTableView(bots, Date.now())
  const sb = table.hand?.sb ?? table.settings.sb
  // Мои фишки кончились — вместо «Начать раздачу» карточка «Докупиться» / «Закончить»
  const broke = iAmBroke(bots)
  const dock = broke ? 'none' : dockOf(v)
  const level = BOT_LEVELS.find(([l]) => l === bots.level)?.[1] ?? ''
  const botCount = table.players.length - 1

  // Колонка (#97): стол — на весь первый экран, под ним листается остальное, панель хода — внизу
  return (
    <div className={`table-layout ${lookClass(table.settings)}`}>
      <div className="table-scroll">
        <div className="table-stage">
          <p className="muted table-info">
            {blindsLine(table, v)} · {v.handNumber > 0 ? `раздача ${v.handNumber} · ` : ''}
            {v.stageLabel}
          </p>
          {/* Свои карты — лицом: телефон только мой */}
          <PokerTable view={v} open />
        </div>

        {broke && (
          <section className="card">
            <h2>Фишки кончились</h2>
            <button type="button" className="big primary wide" onClick={() => apply((bt, now) => myRebuy(bt, now))}>
              Докупиться на {formatNumber(table.settings.startingStack)}
            </button>
            <button type="button" className="big wide danger-text" onClick={onFinish}>
              Закончить
            </button>
          </section>
        )}

        <PotList view={v} />
        <LastHand table={table} view={v} />

        {/* История раздач — на этом телефоне, вместе со столом; карты бота, взявшего банк без вскрытия, не видны */}
        {showHistory ? (
          <HandHistory hands={bots.history.map((h) => handFor(h, bots.meId))} onClose={() => setShowHistory(false)} />
        ) : (
          <button type="button" className="big wide" onClick={() => setShowHistory(true)}>
            История раздач
          </button>
        )}

        <section className="card">
          <h2>Стол с ботами</h2>
          <p className="muted">
            Ботов: {botCount} · уровень «{level}» · карты ботов {bots.open ? 'открыты' : 'закрыты'}. Холдем, кэш. Кончились
            фишки у бота — он докупается сам.
          </p>
          <button type="button" className="big wide danger-text" onClick={onFinish}>
            Закончить игру
          </button>
        </section>
      </div>

      {error && (
        <p className="warn table-error" onClick={() => onError(null)}>
          {error}
        </p>
      )}

      {dock === 'turn' && v.actions && (
        // Новый ход или новый минимум — сумма снова с минимума
        <ActionsCard
          key={`${v.handNumber}-${v.stage}-${table.hand?.log.length ?? 0}-${v.actions.raise?.min ?? ''}`}
          actions={v.actions}
          sb={sb}
          who={null}
          online
          onAct={(body) => apply((bt, now) => myMove(bt, body.action, now))}
        />
      )}
      {dock === 'wait' && <p className="dock wait-strip">{waitLine(v)}</p>}
      {dock === 'host' && (
        <HostDock view={v} pause={false} onStart={() => apply((bt, now) => dealBotHand(bt, now))} onPause={() => undefined} />
      )}
    </div>
  )
}
