import type { SavedHand } from '../calc/evenings'
import { sessionReport, sessionView, type TopView } from '../calc/sessionReport'

// Отчёт сессии (#263) — под «Итогом вечера» в «Прошлых вечерах» и за столом с ботами: мои лучшие и худшие
// раздачи (касание — раздача в той же истории), премиум-руки (только холдем) и накопленный итог в ББ
// линией по раздачам. Меня в вечере нет или моих раздач с итогом нет — блока нет; empty — строка вместо него.
// heading — свой заголовок; у ботов его нет: «Отчёт сессии» — уже заголовок карточки
export function SessionReport(props: { hands: SavedHand[]; onHand: (number: number) => void; empty?: string; heading?: boolean }) {
  const { hands, onHand, empty, heading = true } = props
  const report = sessionReport(hands)
  if (!report) return empty ? <p className="muted">{empty}</p> : null
  const v = sessionView(report)
  return (
    <div className="session-report">
      {heading && <h3 className="history-sub">Отчёт сессии</h3>}
      <TopList title="Лучшие раздачи" list={v.best} onHand={onHand} />
      <TopList title="Худшие раздачи" list={v.worst} onHand={onHand} />
      {v.premium && <p>{v.premium}</p>}
      {v.chart && (
        <svg
          className="session-chart"
          viewBox={`0 0 ${v.chart.width} ${v.chart.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Накопленный итог в ББ по раздачам"
        >
          <line className="session-zero" x1="0" x2={v.chart.width} y1={v.chart.zero} y2={v.chart.zero} vectorEffect="non-scaling-stroke" />
          <polyline className="session-line" points={v.chart.points} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <p className="muted">
        {v.bb100}
        {v.note && ` · ${v.note}`}
      </p>
    </div>
  )
}

function TopList({ title, list, onHand }: { title: string; list: TopView[]; onHand: (number: number) => void }) {
  if (list.length === 0) return null
  return (
    <>
      <span className="muted">{title}</span>
      <ul className="list">
        {list.map((o) => (
          <li key={o.number}>
            <button type="button" className="history-item" onClick={() => onHand(o.number)}>
              <span className={`history-number ${o.plus ? 'plus' : 'minus'}`}>{o.result}</span>
              <span className="history-wins">№ {o.number}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
