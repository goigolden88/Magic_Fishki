import type { ReactNode } from 'react'
import { isAvatarId, isAvatarPicture, type AvatarId } from '../poker/avatar'

// Аватарки (#298, Р-113): набор из 10 простых рисунков — SVG прямо в коде, без файлов и зависимостей.
// Один стиль: цветной круг и белый силуэт крупными формами, рамка — полупрозрачная тёмная; круг свой у каждого
// рисунка и один во всех гаммах — силуэт читается на 32 px и на светлом, и на тёмном фоне.
// Своя картинка — <img> в том же круге. Id набора и проверка — src/poker/avatar.ts

export const AVATAR_LABELS: [AvatarId, string][] = [
  ['bolt', 'Молния'],
  ['cloud', 'Облако'],
  ['sun', 'Солнце'],
  ['moon', 'Луна'],
  ['car', 'Машина'],
  ['shark', 'Акула'],
  ['cat', 'Кот'],
  ['hedgehog', 'Ёж'],
  ['brain', 'Мозг'],
  ['heart', 'Сердце'],
]

const W = '#fff'

// Круг рисунка — цвет; силуэт — viewBox 0 0 32 32, белым; тёмные детали (глаза, колёса) — цветом круга
const DRAWINGS: Record<AvatarId, { bg: string; draw: (bg: string) => ReactNode }> = {
  bolt: { bg: '#d97706', draw: () => <path fill={W} d="M18.5 4 8 18h6.5L12.5 28 24 13.5h-6.8z" /> },
  cloud: {
    bg: '#0284c7',
    draw: () => <path fill={W} d="M9.5 23.5h13.5a4.5 4.5 0 0 0 .4-9 6.5 6.5 0 0 0-12.5-1.6A5.3 5.3 0 0 0 9.5 23.5z" />,
  },
  sun: {
    bg: '#ea580c',
    draw: () => (
      <>
        <circle cx="16" cy="16" r="5.2" fill={W} />
        <g stroke={W} strokeWidth="2.4" strokeLinecap="round">
          <path d="M16 4.5v3M16 24.5v3M4.5 16h3M24.5 16h3M7.9 7.9l2.1 2.1M22 22l2.1 2.1M7.9 24.1 10 22M22 10l2.1-2.1" />
        </g>
      </>
    ),
  },
  moon: { bg: '#4338ca', draw: () => <path fill={W} d="M19.5 5.5a10.5 10.5 0 1 0 7 17.2A8.6 8.6 0 0 1 19.5 5.5z" /> },
  car: {
    bg: '#2563eb',
    draw: (bg) => (
      <>
        <path fill={W} d="M5 21.5v-4.2l2.6-1.1 2.8-4.4a2 2 0 0 1 1.7-.9h7.6a2 2 0 0 1 1.6.8l3.2 4.4 1.9.7a1.5 1.5 0 0 1 .9 1.4v3.3z" />
        <path fill={bg} d="M12.6 13.2h3v3.2h-5zM17.4 13.2h2.4l2.3 3.2h-4.7z" />
        <circle cx="10.5" cy="21.8" r="3" fill={W} stroke={bg} strokeWidth="1.6" />
        <circle cx="21.5" cy="21.8" r="3" fill={W} stroke={bg} strokeWidth="1.6" />
      </>
    ),
  },
  shark: {
    bg: '#0f766e',
    draw: () => (
      <>
        <path fill={W} d="M9 20.5c3.5-5.5 7.5-11 14-13.5-1.6 4.2-1.8 9.2-.6 13.5z" />
        <path fill="none" stroke={W} strokeWidth="2.2" strokeLinecap="round" d="M4.5 24.5c2.3-1.8 4.5-1.8 6.8 0s4.5 1.8 6.8 0 4.5-1.8 6.8 0 2.3 1.4 2.6 1.2" />
      </>
    ),
  },
  cat: {
    bg: '#7c3aed',
    draw: (bg) => (
      <>
        <path fill={W} d="M7 7.5l5.2 4.3a11 11 0 0 1 7.6 0L25 7.5v9.5a9 9 0 0 1-18 0z" />
        <circle cx="12.6" cy="17.2" r="1.6" fill={bg} />
        <circle cx="19.4" cy="17.2" r="1.6" fill={bg} />
        <path fill={bg} d="M14.6 20.6h2.8L16 22.2z" />
      </>
    ),
  },
  hedgehog: {
    bg: '#65a30d',
    draw: (bg) => (
      <>
        <path
          fill={W}
          d="M4.5 23.5 6 19.5 4.6 17l3.2-.6-.4-3.4 3.1 1.2 1-3.4 2.6 2.2 2-3 1.7 3.2 2.8-2 .7 3.3 3.2-.4-.8 3.1c1.6.6 3.4 1.8 4.3 3.7.3.8-.1 1.5-.9 1.7l-2.3.5a6 6 0 0 1-3.8 2.4z"
        />
        <circle cx="22.4" cy="19.2" r="1.3" fill={bg} />
        <circle cx="27.4" cy="21" r="1" fill={bg} />
      </>
    ),
  },
  brain: {
    bg: '#db2777',
    draw: (bg) => (
      <>
        <path
          fill={W}
          d="M15.2 7.6a4.3 4.3 0 0 0-7.3 2 4.4 4.4 0 0 0-1.6 7.6 4.5 4.5 0 0 0 3.6 6.4 4 4 0 0 0 5.3.8zM16.8 7.6a4.3 4.3 0 0 1 7.3 2 4.4 4.4 0 0 1 1.6 7.6 4.5 4.5 0 0 1-3.6 6.4 4 4 0 0 1-5.3.8z"
        />
        <path fill="none" stroke={bg} strokeWidth="1.5" strokeLinecap="round" d="M10 13.5c1.6.3 2.6 1.3 2.8 2.8M9.5 19.2c1.4-.6 2.8-.4 3.8.6M22 13.5c-1.6.3-2.6 1.3-2.8 2.8M22.5 19.2c-1.4-.6-2.8-.4-3.8.6" />
      </>
    ),
  },
  heart: {
    bg: '#be123c',
    draw: () => (
      <path fill={W} d="M16 26.5C9.5 22 5.5 18.3 5.5 13.4A5.4 5.4 0 0 1 16 11a5.4 5.4 0 0 1 10.5 2.4c0 4.9-4 8.6-10.5 13.1z" />
    ),
  },
}

// Аватарка: id набора — рисунок, своя картинка — она; чужое — ничего. Размер — у класса снаружи (`.avatar`)
export function Avatar({ value, className = '' }: { value: string; className?: string }) {
  const cls = `avatar ${className}`.trim()
  if (!isAvatarId(value)) {
    return isAvatarPicture(value) ? <img className={cls} src={value} alt="" aria-hidden="true" draggable={false} /> : null
  }
  const { bg, draw } = DRAWINGS[value]
  return (
    <svg className={cls} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="15.25" fill={bg} stroke="rgba(0, 0, 0, 0.28)" strokeWidth="1.5" />
      {draw(bg)}
    </svg>
  )
}
