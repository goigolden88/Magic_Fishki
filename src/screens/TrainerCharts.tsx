import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react'
import {
  actionLabel,
  CHART_POSITIONS,
  chartLegend,
  chartSituations,
  combosText,
  handStripes,
  handText,
  reachedText,
  sharePercentText,
  situationKey,
  situationLabel,
  TWELFTHS,
  unpackNode,
  type ChartGrid,
  type ChartHand,
  type ChartPosition,
} from '../calc/charts'
import { LEAKPROOF } from '../calc/chartsData'
import {
  applyRange,
  builtinCells,
  chartFileName,
  chartFileText,
  chartName,
  emptyCells,
  NAME_MAX,
  newChartActions,
  ownChartGrid,
  parseChartFile,
  parseRaiseBB,
  sameCells,
  stepDown,
  stepUp,
  type ChartDraft,
  type OwnChart,
} from '../calc/ownCharts'
import { CLASSES, parseRange } from '../calc/rangeText'
import { CHARTS_GAME, CHARTS_ROUNDING } from '../calc/trainerView'
import { deleteChart, listCharts, saveChart } from '../store/db'
import { ulid } from '../ulid'
import { download } from './download'

// Строка об источнике — дословно, как требует CC BY 4.0 (решение в #214); на экране рядом с чартами
export const CHARTS_SOURCE =
  'Preflop ranges: Leakproof 6max-100bb-norake 1.0.0 (https://github.com/a-hanamoto/leakproof-preflop-ranges), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)'

// Клетка: полосы долей действий слева направо, по высоте — доля сочетаний, что доходит до ситуации (снизу)
function cellStyle(hand: ChartHand | null, actions: string[]): CSSProperties | undefined {
  if (!hand) return undefined
  const stops = handStripes(hand, actions)
    .map((s) => `var(--act-${s.kind}) ${s.from}% ${s.to}%`)
    .join(', ')
  const height = (hand.reach * 100) / TWELFTHS
  return { background: `linear-gradient(to right, ${stops}) bottom / 100% ${height}% no-repeat, var(--chart-empty)` }
}

// Источник — и у своего чарта, сделанного из встроенного: это переделка набора (CC BY 4.0)
const Source = () => (
  <p className="muted chart-note chart-source" lang="en">
    {CHARTS_SOURCE}
  </p>
)

// Встроенная ситуация по ключу base своего чарта (Р-77)
const builtinOf = (base: string | null) => (base === null ? undefined : LEAKPROOF.find((n) => situationKey(n) === base))

// «BTN: Никто не входил» — откуда свой чарт; заведён с нуля — словами
function baseText(base: string | null): string {
  const node = builtinOf(base)
  return node ? `Из встроенного: ${node.actor}, ${situationLabel(node.actor, node.line)}` : 'Свой, с нуля'
}

// Сетка 13 × 13: касание клетки — доли руки строкой ниже (у правки — ещё и правка её долей)
function Grid(props: { grid: ChartGrid; cell: number | null; onCell: (k: number | null) => void }) {
  const { grid, cell, onCell } = props
  return (
    <>
      <div className="chart-grid" role="group" aria-label="Чарт: руки по клеткам">
        {CLASSES.map((cls, k) => {
          const hand = grid.hands[k]
          return (
            <button
              key={cls}
              type="button"
              className={hand ? 'chart-cell' : 'chart-cell empty'}
              style={cellStyle(hand, grid.actions)}
              aria-pressed={cell === k}
              aria-label={handText(cls, hand, grid.actions)}
              onClick={() => onCell(cell === k ? null : k)}
            >
              <span>{cls}</span>
            </button>
          )
        })}
      </div>
      <p className="chart-hand" role="status">
        {cell === null ? 'Коснитесь клетки — доли руки' : handText(CLASSES[cell], grid.hands[cell], grid.actions)}
      </p>
    </>
  )
}

function Legend(props: { grid: ChartGrid }) {
  const legend = useMemo(() => chartLegend(props.grid), [props.grid])
  return (
    <>
      <p className="muted chart-reached">{reachedText(legend.reached)}</p>
      <ul className="chart-legend">
        {legend.rows.map((row) => (
          <li key={row.label}>
            <span className={`chart-swatch act-${row.kind}`} aria-hidden="true" />
            <span className="chart-action">{row.label}</span>
            <span className="chart-share">{sharePercentText(row.share)}</span>
            <span className="chart-combos">{combosText(row.combos)}</span>
          </li>
        ))}
      </ul>
    </>
  )
}

const percent = (s: number) => `${Math.round(s * 100)} %`

// Правка (#215): клетка — доли её действий шагом 25 %; «Загрузить текстом» — диапазон на одно действие.
// ownId — правится свой чарт (сохранить — на его место); null — встроенный или новый, сохраняется своим
function Editor(props: {
  start: ChartDraft
  ownId: string | null
  onSave: (draft: ChartDraft, ownId: string | null) => Promise<void>
  onCancel: () => void
}) {
  const { start, ownId, onSave, onCancel } = props
  const [draft, setDraft] = useState(start)
  const [name, setName] = useState(start.name)
  const [cell, setCell] = useState<number | null>(null)
  const [action, setAction] = useState(1)
  const [text, setText] = useState('')
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const grid = useMemo(() => ownChartGrid(draft), [draft])
  const builtin = builtinOf(draft.base)
  const builtinCellsNow = useMemo(() => (builtin ? builtinCells(builtin) : null), [builtin])
  const asBuiltin = builtin !== undefined && builtinCellsNow !== null && draft.actions.join() === builtin.actions.join() && sameCells(draft.cells, builtinCellsNow)
  const cls = cell === null ? null : CLASSES[cell]
  const shares = cls === null ? undefined : draft.cells[cls]

  const setCells = (cells: Record<string, number[]>) => setDraft({ ...draft, cells })
  function setShares(next: number[] | null) {
    if (cls === null) return
    const cells = { ...draft.cells }
    if (next === null) delete cells[cls]
    else cells[cls] = next
    setCells(cells)
  }

  function paste() {
    const parsed = parseRange(text)
    if ('error' in parsed) {
      setNote({ ok: false, text: `${parsed.error}. Чарт не изменился.` })
      return
    }
    setCells(applyRange(draft.cells, draft.actions, action, parsed.weights))
    setNote({ ok: true, text: `Диапазон лёг на «${actionLabel(draft.actions[action])}», остаток рук — пас` })
  }

  function reset() {
    if (!builtin) return
    setDraft({ ...draft, actions: [...builtin.actions], cells: builtinCells(builtin) })
    setAction(1)
    setNote({ ok: true, text: 'Доли — как во встроенном' })
  }

  async function save() {
    const n = chartName(name)
    if (n === '') {
      setNote({ ok: false, text: 'Назовите чарт' })
      return
    }
    setSaving(true)
    try {
      await onSave({ ...draft, name: n }, ownId)
    } catch {
      setNote({ ok: false, text: 'Не удалось сохранить чарт — попробуйте ещё раз' })
      setSaving(false)
    }
  }

  return (
    <section className="card chart-view chart-edit">
      <h2>Правка: {start.name}</h2>
      <p className="muted chart-note">{baseText(draft.base)}</p>
      <Grid grid={grid} cell={cell} onCell={setCell} />
      {cls !== null && (
        <div className="chart-cell-edit" role="group" aria-label={`Доли ${cls}`}>
          {shares ? (
            <>
              {draft.actions.map((a, i) => (
                <div key={a} className="chart-share-row">
                  <span className="chart-action">{actionLabel(a)}</span>
                  <button type="button" className="big" aria-label={`${actionLabel(a)}: меньше на 25 %`} onClick={() => setShares(stepDown(shares, i))}>
                    −
                  </button>
                  <strong>{percent(shares[i])}</strong>
                  <button type="button" className="big" aria-label={`${actionLabel(a)}: больше на 25 %`} onClick={() => setShares(stepUp(shares, i))}>
                    +
                  </button>
                </div>
              ))}
              <button type="button" className="big wide" onClick={() => setShares(null)}>
                Убрать {cls} из ситуации
              </button>
            </>
          ) : (
            <button type="button" className="big wide" onClick={() => setShares(draft.actions.map((_, i) => (i === 0 ? 1 : 0)))}>
              Добавить {cls} — пас 100 %
            </button>
          )}
        </div>
      )}

      <h2>Загрузить текстом</h2>
      <div className="chart-actions-pick" role="group" aria-label="Действие для диапазона">
        {draft.actions.slice(1).map((a, j) => (
          <button key={a} type="button" className={action === j + 1 ? 'big primary' : 'big'} aria-pressed={action === j + 1} onClick={() => setAction(j + 1)}>
            {actionLabel(a)}
          </button>
        ))}
      </div>
      <textarea
        className="paste chart-paste"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="77+, A9s+, AKs:0.5"
        aria-label="Диапазон текстом"
        spellCheck={false}
        autoCapitalize="characters"
      />
      <button type="button" className="big wide" disabled={text.trim() === ''} onClick={paste}>
        Применить к «{actionLabel(draft.actions[action] ?? 'fold')}»
      </button>
      {note && <p className={note.ok ? 'muted' : 'warn'}>{note.text}</p>}

      <Legend grid={grid} />

      <label className="field">
        Имя чарта
        <input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="button" className="big primary wide" disabled={saving} onClick={() => void save()}>
        {ownId === null ? 'Сохранить как свой' : 'Сохранить'}
      </button>
      {builtin && (
        <button type="button" className="big wide" disabled={asBuiltin} onClick={reset}>
          Сбросить к встроенному
        </button>
      )}
      <button type="button" className="big wide" onClick={onCancel}>
        Отмена
      </button>
      {builtin && <p className="muted chart-note">Встроенный чарт не меняется: правка сохраняется в «Мои чарты».</p>}
      {builtin && <Source />}
    </section>
  )
}

// «Новый чарт»: имя и действия — пас всегда, колл, рейзы с размером, олл-ин
function NewChart(props: { onCreate: (draft: ChartDraft) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [call, setCall] = useState(true)
  const [allin, setAllin] = useState(false)
  const [raises, setRaises] = useState('2,5')
  const [error, setError] = useState<string | null>(null)

  function create() {
    const n = chartName(name)
    if (n === '') return setError('Назовите чарт')
    const parts = raises.split(/[\s;]+/).filter((p) => p !== '')
    const sizes = parts.map(parseRaiseBB)
    const bad = parts.find((_, i) => sizes[i] === null)
    if (bad !== undefined) return setError(`Размер рейза «${bad}» — число ББ от 1 до 100, одна цифра после запятой`)
    const actions = newChartActions({ call, raises: sizes as number[], allin })
    if (actions.length < 2) return setError('Кроме паса нужно хотя бы одно действие')
    props.onCreate({ name: n, base: null, actions, cells: emptyCells(actions) })
  }

  return (
    <div className="chart-new">
      <label className="field">
        Имя чарта
        <input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="Мой BTN" />
      </label>
      <p className="muted chart-note">Действия: пас — всегда</p>
      <div className="chart-actions-pick" role="group" aria-label="Действия чарта">
        <button type="button" className={call ? 'big primary' : 'big'} aria-pressed={call} onClick={() => setCall(!call)}>
          Колл
        </button>
        <button type="button" className={allin ? 'big primary' : 'big'} aria-pressed={allin} onClick={() => setAllin(!allin)}>
          Олл-ин
        </button>
      </div>
      <label className="field">
        Рейзы, ББ — через пробел (пусто — без рейза)
        <input value={raises} inputMode="decimal" onChange={(e) => setRaises(e.target.value)} placeholder="2,5 7,5" />
      </label>
      {error && <p className="warn">{error}</p>}
      <div className="row">
        <button type="button" className="big primary grow" onClick={create}>
          Завести
        </button>
        <button type="button" className="big grow" onClick={props.onCancel}>
          Отмена
        </button>
      </div>
    </div>
  )
}

// «Мои чарты» (#215): список, «Открыть», «Переименовать», «Удалить», «Новый чарт», «Загрузить файл»
function MyCharts(props: {
  charts: OwnChart[] | null
  failed: boolean
  openId: string | null
  onOpen: (id: string) => void
  onNew: (draft: ChartDraft) => void
  onChanged: (openId?: string | null) => Promise<void>
}) {
  const { charts, failed, openId, onOpen, onNew, onChanged } = props
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function rename() {
    if (!renaming || !charts) return
    const chart = charts.find((c) => c.id === renaming.id)
    const name = chartName(renaming.name)
    if (!chart || name === '') return setNote({ ok: false, text: 'Назовите чарт' })
    try {
      await saveChart({ ...chart, name })
      setRenaming(null)
      setNote(null)
      await onChanged()
    } catch {
      setNote({ ok: false, text: 'Не удалось переименовать — попробуйте ещё раз' })
    }
  }

  async function remove(chart: OwnChart) {
    if (!confirm(`Удалить чарт «${chart.name}»? Его не вернуть, встроенные чарты останутся.`)) return
    try {
      await deleteChart(chart.id)
      setNote(null)
      await onChanged(openId === chart.id ? null : undefined)
    } catch {
      setNote({ ok: false, text: 'Не удалось удалить — попробуйте ещё раз' })
    }
  }

  async function load(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // тот же файл можно выбрать снова
    if (!file) return
    let text: string
    try {
      text = await file.text()
    } catch {
      return setNote({ ok: false, text: 'Файл не читается' })
    }
    const parsed = parseChartFile(text)
    if (!parsed.ok) return setNote({ ok: false, text: `${parsed.error}. Чарты не изменились.` })
    // Такой id уже есть — загруженный становится новым чартом рядом, свой не перезаписывается
    const taken = (charts ?? []).some((c) => c.id === parsed.chart.id)
    try {
      const saved = await saveChart(taken ? { ...parsed.chart, id: ulid() } : parsed.chart)
      setNote({ ok: true, text: `Чарт «${saved.name}» загружен` })
      await onChanged(saved.id)
    } catch {
      setNote({ ok: false, text: 'Не удалось записать чарт — попробуйте ещё раз' })
    }
  }

  return (
    <section className="card chart-mine">
      <h2>Мои чарты</h2>
      {failed && <p className="warn">Не удалось прочитать свои чарты на этом телефоне</p>}
      {charts !== null && charts.length === 0 && (
        <p className="muted">Своих чартов пока нет: заведите новый, загрузите файл или измените встроенный.</p>
      )}
      <ul className="chart-list">
        {(charts ?? []).map((c) => (
          <li key={c.id} className={c.id === openId ? 'open' : undefined}>
            {renaming?.id === c.id ? (
              <>
                <input
                  value={renaming.name}
                  maxLength={NAME_MAX}
                  aria-label="Новое имя"
                  onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                />
                <div className="row">
                  <button type="button" className="big primary grow" onClick={() => void rename()}>
                    Сохранить
                  </button>
                  <button type="button" className="big grow" onClick={() => setRenaming(null)}>
                    Отмена
                  </button>
                </div>
              </>
            ) : (
              <>
                <strong className="chart-list-name">{c.name}</strong>
                <span className="muted chart-note">{baseText(c.base)}</span>
                <div className="chart-list-buttons">
                  <button type="button" className={c.id === openId ? 'big primary' : 'big'} onClick={() => onOpen(c.id)}>
                    Открыть
                  </button>
                  <button type="button" className="big" onClick={() => setRenaming({ id: c.id, name: c.name })}>
                    Переименовать
                  </button>
                  <button type="button" className="big" onClick={() => void remove(c)}>
                    Удалить
                  </button>
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      {adding ? (
        <NewChart
          onCreate={(d) => {
            setAdding(false)
            onNew(d)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" className="big primary wide" disabled={charts === null} onClick={() => setAdding(true)}>
          Новый чарт
        </button>
      )}
      <button type="button" className="big wide" disabled={charts === null} onClick={() => fileInput.current?.click()}>
        Загрузить файл
      </button>
      <input ref={fileInput} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={(e) => void load(e)} />
      {note && <p className={note.ok ? 'muted' : 'warn'}>{note.text}</p>}
    </section>
  )
}

// Открытый свой чарт: сетка, легенда, «Изменить», «Выгрузить»
function OwnView(props: { chart: OwnChart; onEdit: () => void }) {
  const { chart, onEdit } = props
  const [cell, setCell] = useState<number | null>(null)
  const grid = useMemo(() => ownChartGrid(chart), [chart])
  return (
    <section className="card chart-view">
      <h2>{chart.name}</h2>
      <p className="muted chart-note">{baseText(chart.base)}</p>
      <Grid grid={grid} cell={cell} onCell={setCell} />
      <Legend grid={grid} />
      <div className="row">
        <button type="button" className="big primary grow" onClick={onEdit}>
          Изменить
        </button>
        <button type="button" className="big grow" onClick={() => download(chartFileText(chart), chartFileName(chart.name))}>
          Выгрузить
        </button>
      </div>
      <p className="muted chart-note">Свой чарт: рука в нём или есть целиком, или её нет.</p>
      {builtinOf(chart.base) && <Source />}
    </section>
  )
}

type Mode = 'builtin' | 'mine'
type Editing = { start: ChartDraft; ownId: string | null }

// Вкладка «Чарты» «Тренажёра» (#214, Р-76): набор Leakproof — модуль грузится при первом открытии вкладки
// (import() в Trainer.tsx), вместе с ним — данные chartsData. Выбор — состояние экрана, не хранится.
// Свои чарты (#215, Р-77) — в IndexedDB (store/db.ts), встроенный набор не меняется
export function TrainerCharts() {
  const [mode, setMode] = useState<Mode>('builtin')
  const [pos, setPos] = useState<ChartPosition>(CHART_POSITIONS[0])
  const situations = useMemo(() => chartSituations(LEAKPROOF, pos), [pos])
  const [picked, setPicked] = useState(situations[0].index)
  const [cell, setCell] = useState<number | null>(null)
  const index = situations.some((s) => s.index === picked) ? picked : situations[0].index
  const chart = useMemo(() => unpackNode(LEAKPROOF[index]), [index])
  const label = situations.find((s) => s.index === index)?.label ?? ''
  const [own, setOwn] = useState<OwnChart[] | null>(null)
  const [ownFailed, setOwnFailed] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)

  async function reload(open?: string | null) {
    try {
      setOwn(await listCharts())
      setOwnFailed(false)
    } catch {
      setOwnFailed(true)
    }
    if (open !== undefined) setOpenId(open)
  }

  useEffect(() => {
    void reload()
  }, [])

  function choosePos(p: ChartPosition) {
    setPos(p)
    setPicked(chartSituations(LEAKPROOF, p)[0].index)
  }

  function editBuiltin() {
    const node = LEAKPROOF[index]
    setEditing({ start: { name: `${pos}: ${label}`, base: situationKey(node), actions: [...node.actions], cells: builtinCells(node) }, ownId: null })
  }

  async function save(draft: ChartDraft, ownId: string | null) {
    const saved = await saveChart({ ...draft, id: ownId ?? ulid(), updatedAt: '' })
    setEditing(null)
    setMode('mine')
    await reload(saved.id)
  }

  const opened = own?.find((c) => c.id === openId) ?? null

  return (
    <>
      <p className="muted lead">
        Префлоп {CHARTS_GAME}: как часто рука пасует, коллирует, рейзит и идёт олл-ин — по вашей позиции и тому, что было до вас.
      </p>
      <div className="row chart-modes" role="group" aria-label="Чарты">
        {(
          [
            ['builtin', 'Встроенные'],
            ['mine', 'Мои чарты'],
          ] as const
        ).map(([m, text]) => (
          <button
            key={m}
            type="button"
            className={mode === m ? 'big primary grow' : 'big grow'}
            aria-pressed={mode === m}
            disabled={editing !== null}
            onClick={() => setMode(m)}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="charts">
        {editing !== null ? (
          <Editor key={editing.ownId ?? editing.start.base ?? 'new'} start={editing.start} ownId={editing.ownId} onSave={save} onCancel={() => setEditing(null)} />
        ) : mode === 'mine' ? (
          <>
            <MyCharts
              charts={own}
              failed={ownFailed}
              openId={openId}
              onOpen={setOpenId}
              onNew={(start) => setEditing({ start, ownId: null })}
              onChanged={reload}
            />
            {opened && (
              <OwnView
                key={opened.id}
                chart={opened}
                onEdit={() => setEditing({ start: { name: opened.name, base: opened.base, actions: opened.actions, cells: opened.cells }, ownId: opened.id })}
              />
            )}
          </>
        ) : (
          <>
            <section className="card chart-pick">
              <h2>Моя позиция</h2>
              <div className="chart-positions" role="group" aria-label="Моя позиция">
                {CHART_POSITIONS.map((p) => (
                  <button key={p} type="button" className={p === pos ? 'big primary' : 'big'} aria-pressed={p === pos} onClick={() => choosePos(p)}>
                    {p}
                  </button>
                ))}
              </div>
              <h2>Что было до меня</h2>
              <div className="chart-situations" role="group" aria-label="Что было до меня">
                {situations.map((s) => (
                  <button
                    key={s.index}
                    type="button"
                    className={s.index === index ? 'big primary' : 'big'}
                    aria-pressed={s.index === index}
                    onClick={() => setPicked(s.index)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="muted chart-note">Нет лимпа SB, холодного колла 3-бета, сквиза и раздач втроём.</p>
            </section>

            <section className="card chart-view">
              <h2>
                {pos}: {label}
              </h2>
              <Grid grid={chart} cell={cell} onCell={setCell} />
              <Legend grid={chart} />
              <button type="button" className="big wide" onClick={editBuiltin}>
                Изменить
              </button>
              <p className="muted chart-note">Приближение, без рейка, {CHARTS_ROUNDING}, преобразовано в свой формат.</p>
              <Source />
            </section>
          </>
        )}
      </div>
    </>
  )
}
