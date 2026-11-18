// Праздник руки (#295): надпись вспыхивает посреди своего контейнера (стол, место) и гаснет сама.
// big — крупно, на весь центр стола (ривер, кулер); иначе — скромная плашка (префлоп). ms — сколько длится:
// столько же держит её экран. Касаний не ловит — игре не мешает. Когда показывать — решает экран: при
// «Анимации карт» и без системного «Уменьшить движение»; общий и для казино
export function HandBurst(props: { title: string; sub?: string | null; big?: boolean; ms: number }) {
  const { title, sub, big = false, ms } = props
  return (
    <span className={big ? 'hand-burst big' : 'hand-burst'} role="status" style={{ animationDuration: `${ms}ms` }}>
      <span className="hand-burst-title">{title}</span>
      {sub && <span className="hand-burst-sub">{sub}</span>}
    </span>
  )
}
