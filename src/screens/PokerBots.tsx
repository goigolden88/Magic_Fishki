import { useEffect, useMemo, useRef, useState } from 'react'
import { BOT_LEVELS } from '../calc/bot'
import { botsEvening, savedHands } from '../calc/evenings'
import { NO_COPY, useHandCopy, useMyCards } from './handCopy'
import {
  autoDealBotHand,
  autoFinishNow,
  backError,
  BOT_PAUSE_MS,
  botAutoStart,
  botGameLine,
  botGameOf,
  botNextHandAt,
  botPause,
  botsPlayOn,
  botStep,
  botTableView,
  botToAct,
  botWatch,
  canTopUpAll,
  dealBotHand,
  finishBotHand,
  iAmBroke,
  iWatch,
  myMove,
  myRebuy,
  resumeBotTable,
  setBotAutoStart,
  setBotLiveHand,
  setBotFlag,
  topUpAll,
  watchError,
  type BotStep,
  type BotTable,
} from '../calc/botTable'
import { formatNumber, stackText } from '../calc/format'
import { dockOf, waitLine } from '../calc/pokerLayout'
import { lookClass } from '../calc/pokerLook'
import { myTurnMark } from '../calc/pokerView'
import { showPreActions } from '../calc/preAction'
import { PreActionsDock, usePreAction } from './PreActions'
import { handFor } from '../poker/history'
import { NO_STORAGE } from './PokerLocal'
import { BotFlagFields } from './BotFlagFields'
import { ActionsCard, blindsLine, HandHistory, HostDock, LastHand, PokerTable, PotList, useBigBlinds, useLookVersion } from './PokerRoom'
import { TableInfo } from './GameRules'
import { LiveHandField } from './RoomFields'
import { SessionReport } from './SessionReport'
import { GearPop, MyLookPart } from './TableGear'
import { AutoStartField } from './TimerFields'
import {
  clearBotTable,
  hasOwnBack,
  loadBotTable,
  loadMyLook,
  loadQuickBets,
  saveBotTable,
  saveLastGame,
  storageWorks,
  tableFitStyle,
} from './pokerStorage'

// Адрес стола с ботами: под код комнаты (6 знаков) не подходит
export const BOTS_HASH = '#/poker/bots'

export const FINISH_BOTS = 'Закончить игру с ботами? Стол удалится, в учёт игр ничего не запишется; раздачи останутся в «Прошлых вечерах».'

type Apply = (make: (bots: BotTable, now: number) => BotStep) => boolean

// Будильник раздачи «сама» — чуть позже срока: часы телефона не успеют раньше
const AUTO_DEAL_SLACK_MS = 50

// Против ботов (#117, Р-38): я и боты за одним столом на этом телефоне. Карты раздаёт программа, боты ходят
// сами через паузу; правила src/poker/ — прямо здесь, стол — в памяти устройства после каждого хода
export function PokerBotsScreen() {
  // Стол снова на экране — ждавшая раздача «сама» отсчитывает паузу заново (#156)
  const [bots, setBots] = useState<BotTable | null>(() => {
    const bt = loadBotTable()
    return bt && resumeBotTable(bt, Date.now())
  })
  const [volatile, setVolatile] = useState(() => !storageWorks())
  const [error, setError] = useState<string | null>(null)
  // Последний стол — для хода бота по таймеру: замыкание эффекта могло устареть
  const latest = useRef(bots)
  latest.current = bots

  // Открыли стол — он последний для «Продолжить» на «Играть» (#209)
  useEffect(() => {
    if (latest.current) saveLastGame('bots')
  }, [])

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

  // Очередь бота — он ходит сам через паузу. Метка — раздача и число ходов в ней: новый ход — новый таймер.
  // «После паса — сразу доигрывать» (#194) и я сбросил — раздача доигрывается сразу, без пауз
  const hand = bots?.table.hand
  const mark = bots && hand && botToAct(bots) ? `${hand.number}-${hand.log.length}` : null
  useEffect(() => {
    if (!mark) return
    const bt = latest.current
    if (!bt || !botToAct(bt)) return
    if (autoFinishNow(bt)) {
      apply((b, now) => finishBotHand(b, now, Math.random))
      return
    }
    const id = setTimeout(() => apply((bt, now) => botStep(bt, now, Math.random)), BOT_PAUSE_MS)
    return () => clearTimeout(id)
  }, [mark])

  // Раздача «сама» (#156, Р-51): в срок — новая раздача, до неё раз в секунду — отсчёт на столе.
  // Приложение свёрнуто — будильник стоит; вернулись — отсчёт заново с полной паузы
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  const [, setTick] = useState(0)
  const nextAt = bots ? botNextHandAt(bots) : null
  useEffect(() => {
    const onVisibility = () => {
      const shown = document.visibilityState === 'visible'
      setVisible(shown)
      const bt = latest.current
      if (!shown || !bt) return
      const resumed = resumeBotTable(bt, Date.now())
      latest.current = resumed
      setBots(resumed)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  useEffect(() => {
    if (nextAt === null || !visible) return
    // Не вышло (стол уже сменился) — без ошибки на экране: новый срок взведёт стол сам
    const deal = setTimeout(() => {
      const bt = latest.current
      const r = bt && autoDealBotHand(bt, Date.now())
      if (r?.ok) apply(() => r)
    }, Math.max(0, nextAt - Date.now()) + AUTO_DEAL_SLACK_MS)
    const tick = setInterval(() => setTick((n) => n + 1), 1000)
    return () => {
      clearTimeout(deal)
      clearInterval(tick)
    }
  }, [nextAt, visible])

  // «Закончить»: стол удаляется; в учёт игр ничего не идёт, раздачи уже в «Прошлых вечерах» (Р-54)
  function finish() {
    if (!confirm(FINISH_BOTS)) return
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
  const [showHistory, setShowHistory] = useState<'list' | 'report' | null>(null)
  const [gear, setGear] = useState(false) // «⚙ Стол» открыт (#243)
  useLookVersion() // свой вид сменили в «⚙» — стол сразу в новом
  const table = bots.table
  const v = botTableView(bots, Date.now(), loadQuickBets()) // свои быстрые ставки (Р-62)
  // История — в моём виде: карты бота, взявшего банк без вскрытия, не видны. Каждая раздача — в «Прошлые вечера»
  // своим вечером «Против ботов» (Р-54), со своими картами; «Закончить» их не стирает
  const history = useMemo(() => bots.history.map((h) => handFor(h, bots.meId)), [bots.history, bots.meId])
  // Свои карты (#239): идущая раздача — из стола (он хранится после каждого хода), записанные — из «Прошлых вечеров»
  const evening = botsEvening(bots.id, table, bots.meId)
  const mine = useMyCards(evening.id, table, v.myCards, false)
  const copyWorks = useHandCopy(evening, history, mine)
  const saved = savedHands(evening, history, mine)
  // Мои фишки кончились — вместо «Начать раздачу» карточка «Докупиться» / «Закончить»; в наблюдении (#244) — нет:
  // боты играют и при моём нуле, «Докупиться» — в карточке стола, перед «Вернуться за стол»
  const broke = iAmBroke(bots)
  const watch = iWatch(bots)
  const watchBroke = watch && backError(bots) !== null
  const rebuyButton = (
    <button type="button" className="big primary wide" onClick={() => apply((bt, now) => myRebuy(bt, now))}>
      Докупиться на {formatNumber(table.settings.startingStack)}
    </button>
  )
  const dock = broke ? 'none' : dockOf(v)
  // Ход заранее (#299) — тот же, что в комнате, пока ходят боты; дошла очередь — ход делается сам, сразу
  const { pre, autoMove, toggle } = usePreAction(v, myTurnMark(table, bots.meId), true, (move) =>
    apply((bt, now) => myMove(bt, move, now)),
  )
  const level = BOT_LEVELS.find(([l]) => l === bots.level)?.[1] ?? ''
  const botCount = table.players.length - 1
  // «Перерыв» / «Продолжить» — у стола с раздачей «сама» (#156); кнопкой — как раньше, без него
  const auto = botAutoStart(bots) !== 'off'
  const pause = () => apply((bt, now) => botPause(bt, !v.paused, now))
  // Флажок «После паса — сразу доигрывать» включён — доигрывает экран сам, кнопки нет
  const playOn = botsPlayOn(bots) && !bots.autoFinish
  // «Докупить всех до N» (#195): раздачи нет, у кого-то меньше стартового стека; N — в ББ или фишками,
  // как суммы за столом. Внизу экрана, над кнопками ведущего; мои фишки кончились — в карточке докупа
  const inBB = useBigBlinds()
  const topUp = canTopUpAll(bots)
  const topUpButton = (
    <button type="button" className="big wide" onClick={() => apply((bt, now) => topUpAll(bt, now))}>
      Докупить всех до {stackText(table.settings.startingStack, inBB ? v.bb : null)}
    </button>
  )

  // Колонка (#97): стол — на весь первый экран, под ним листается остальное, панель хода — внизу.
  // Широкое окно (Р-63): стол и панель — целиком в окне, панель — справа внизу поверх края стола (#210); под ними листается страница
  return (
    <div className={`table-layout ${lookClass(table.settings, loadMyLook(), hasOwnBack())}`} style={tableFitStyle()}>
      <div className="table-scroll">
        <div className="table-stage">
          <TableInfo settings={table.settings}>
            {blindsLine(table, v)} · {v.handNumber > 0 ? `раздача ${v.handNumber} · ` : ''}
            {v.stageLabel}
          </TableInfo>
          {/* Свои карты — лицом: телефон только мой */}
          <PokerTable view={v} table={table} open avatarKey="id" />
        </div>

        <div className="table-below">
          {broke && (
            <section className="card">
              <h2>Фишки кончились</h2>
              {rebuyButton}
              {topUp && topUpButton}
              <button type="button" className="big wide danger-text" onClick={onFinish}>
                Закончить
              </button>
            </section>
          )}

          <PotList view={v} />
          <LastHand table={table} view={v} />

          {/* История раздач — на этом телефоне, вместе со столом; карты бота, взявшего банк без вскрытия, не видны.
              Рядом — «Отчёт сессии» (#263): тот же блок, что в «Прошлых вечерах», по этому вечеру; касание раздачи — она */}
          {showHistory === 'list' ? (
            <HandHistory hands={saved} onClose={() => setShowHistory(null)} />
          ) : showHistory === 'report' ? (
            <HandHistory
              hands={saved}
              title="Отчёт сессии"
              noList
              top={(openHand) => <SessionReport hands={saved} onHand={openHand} empty="Ваших раздач ещё не было" heading={false} />}
              onClose={() => setShowHistory(null)}
            />
          ) : (
            <div className="row">
              <button type="button" className="big grow" onClick={() => setShowHistory('list')}>
                История раздач
              </button>
              <button type="button" className="big grow" onClick={() => setShowHistory('report')}>
                Отчёт сессии
              </button>
            </div>
          )}
          {!copyWorks && <p className="warn">{NO_COPY}</p>}

          <section className="card">
            <h2>Стол с ботами</h2>
            <p className="muted">
              Ботов: {botCount} · уровень «{level}» · карты ботов {bots.open ? 'открыты' : 'закрыты'}.{' '}
              {botGameLine(botGameOf(bots))}. Кончились фишки у бота — он докупается сам.
              {auto && ' Следующая раздача начинается сама.'}
              {bots.autoFinish && ' После паса раздача доигрывается сразу.'}
            </p>
            {/* Наблюдение (#244): раздачи идут без меня; «Вернуться за стол» — в «⚙ Стол» */}
            {watch && (
              <p>
                <strong>Вы смотрите: раздачи идут без вас.</strong>{' '}
                {watchBroke ? 'Ваши фишки кончились — чтобы вернуться за стол, сначала докупитесь.' : 'Вернуться — в «⚙ Стол».'}
              </p>
            )}
            {watchBroke && rebuyButton}
            {/* «⚙ Стол» (#243) — и во время раздачи: свой вид и галочки стола, не выходя из-за него */}
            <button type="button" className="big wide" aria-haspopup="dialog" onClick={() => setGear(true)}>
              ⚙ Стол
            </button>
            {/* В раздаче «Перерыв» — здесь: она доигрывается, новая сама не начнётся; между раздачами — внизу экрана */}
            {auto && table.hand && (
              <button type="button" className={v.paused ? 'big primary wide' : 'big wide'} onClick={pause}>
                {v.paused ? 'Продолжить' : 'Перерыв'}
              </button>
            )}
            <button type="button" className="big wide danger-text" onClick={onFinish}>
              Закончить игру
            </button>
          </section>
          {gear && <BotGear bots={bots} apply={apply} onClose={() => setGear(false)} />}
        </div>
      </div>

      <div className="table-dock">
        {error && (
          <p className="warn table-error" onClick={() => onError(null)}>
            {error}
          </p>
        )}

        {dock === 'turn' && v.actions && autoMove === null && (
          // Новый ход или новый минимум — сумма снова с минимума
          <ActionsCard
            key={`${v.handNumber}-${v.stage}-${table.hand?.log.length ?? 0}-${v.actions.raise?.min ?? ''}`}
            actions={v.actions}
            bb={v.bb}
            who={null}
            online
            onAct={(body) => apply((bt, now) => myMove(bt, body.action, now))}
          />
        )}
        {/* Я сбросил, а боты играют дальше — «Доиграть сразу» вместо «Ждём хода» (#194) */}
        {dock === 'wait' && playOn && (
          <section className="dock">
            <button type="button" className="big primary wide" onClick={() => apply((bt, now) => finishBotHand(bt, now, Math.random))}>
              Доиграть сразу
            </button>
          </section>
        )}
        {/* Смотрю, меня в раздаче нет — «Вы смотрите» вместо «Доиграть сразу»: раздача идёт с паузами ботов (#244) */}
        {/* Я в раздаче, ходит бот — с полосой два флажка хода заранее (#299), как в комнате */}
        {((dock === 'wait' && !playOn) || autoMove !== null) &&
          (showPreActions(v.actions) || autoMove !== null ? (
            <PreActionsDock line={waitLine(v)} pre={pre} onToggle={toggle} />
          ) : (
            <p className="dock wait-strip">{watch && !v.me?.inHand ? `Вы смотрите · ${waitLine(v)}` : waitLine(v)}</p>
          ))}
        {dock === 'host' && topUp && <section className="dock">{topUpButton}</section>}
        {dock === 'host' && (
          <HostDock view={v} pause={auto} onStart={() => apply((bt, now) => dealBotHand(bt, now))} onPause={pause} />
        )}
      </div>
    </div>
  )
}

// «⚙ Стол» (#243): поверх стола, игра идёт. «Мой вид стола» — этого телефона, за всеми столами; «Стол» — этого
// стола, хранится в нём и меняется сразу. «Следующая раздача сама» — настройка стола ведущего: между раздачами.
// «Отойти и смотреть» / «Вернуться за стол» (#244) — и во время раздачи: идущую, где я в игре, доигрываю
function BotGear({ bots, apply, onClose }: { bots: BotTable; apply: Apply; onClose: () => void }) {
  const flags = { open: bots.open, showStyles: bots.showStyles, hudAll: bots.hudAll, autoFinish: bots.autoFinish }
  const watch = iWatch(bots)
  const why = watch ? backError(bots) : watchError(bots)
  const note = watch
    ? 'Вы смотрите: раздачи идут без вас. Вернётесь — в раздаче со следующей.'
    : 'Боты играют без вас, ваши фишки лежат на месте. Раздачу, где вы в игре, доиграете.'
  return (
    <GearPop title="Стол" onClose={onClose}>
      <MyLookPart heading />
      <h3>Этот стол</h3>
      <BotFlagFields flags={flags} onChange={(flag, on) => apply((bt) => ({ ok: true, bots: setBotFlag(bt, flag, on) }))} />
      <AutoStartField
        value={botAutoStart(bots)}
        disabled={Boolean(bots.table.hand)}
        onChange={(mode) => apply((bt, now) => setBotAutoStart(bt, mode, now))}
      />
      <LiveHandField
        on={bots.table.settings.liveHand !== false}
        disabled={Boolean(bots.table.hand)}
        onChange={(on) => apply((bt, now) => setBotLiveHand(bt, on, now))}
      />
      {bots.table.hand && <p className="muted">«Ход раздачи» меняется между раздачами.</p>}
      <button
        type="button"
        className={watch ? 'big primary wide' : 'big wide'}
        disabled={why !== null}
        onClick={() => apply((bt, now) => botWatch(bt, !watch, now))}
      >
        {watch ? 'Вернуться за стол' : 'Отойти и смотреть'}
      </button>
      <p className="muted">{why ?? note}</p>
      {watch && why !== null && (
        <button type="button" className="big primary wide" onClick={() => apply((bt, now) => myRebuy(bt, now))}>
          Докупиться на {formatNumber(bots.table.settings.startingStack)}
        </button>
      )}
    </GearPop>
  )
}
