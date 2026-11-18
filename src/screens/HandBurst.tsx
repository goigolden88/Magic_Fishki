// Праздник руки (#295): надпись вспыхивает посреди своего контейнера (стол, место) и гаснет сама.
// big — крупно, на весь центр стола (ривер, кулер); иначе — скромная плашка (префлоп). red — красная (кулер),
// иначе золотая. ms — сколько длится: столько же держит её экран. Касаний не ловит — игре не мешает. Когда
// показывать — решает экран: при «Анимации карт» и без системного «Уменьшить движение»; общий и для казино
export function HandBurst(props: { title: string; sub?: string | null; big?: boolean; red?: boolean; ms: number }) {
  const { title, sub, big = false, red = false, ms } = props
  const cls = ['hand-burst', big && 'big', red && 'red'].filter(Boolean).join(' ')
  return (
    <span className={cls} role="status" style={{ animationDuration: `${ms}ms` }}>
      <span className="hand-burst-title">{title}</span>
      {sub && <span className="hand-burst-sub">{sub}</span>}
    </span>
  )
}
