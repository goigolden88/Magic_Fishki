// Размер стола и панели ставок на широком окне (Р-63, #183): свой выбор этого устройства, в копию идёт.
// «Размер стола» — доля места, которое стол может занять у экрана: 100 % — всё, меньше — стол по центру;
// больше 100 % нельзя — стол перестал бы помещаться в окно. «Панель ставок» — масштаб панели хода справа от стола.
// На телефоне и планшете (уже 1024 px) не действуют: экран стола там прежний
export const TABLE_SIZE_MIN = 70
export const TABLE_SIZE_MAX = 100
export const TABLE_SIZE_STEP = 5
export const TABLE_SIZE_DEFAULT = 100

export type DockSize = 'small' | 'medium' | 'large'

export const DOCK_SIZE_DEFAULT: DockSize = 'medium'

export const DOCK_SIZE_LABELS: [DockSize, string][] = [
  ['small', 'Маленькая'],
  ['medium', 'Средняя'],
  ['large', 'Крупная'],
]

// Во сколько раз панель крупнее «Средней» — она как была до Р-63
const DOCK_ZOOM: Record<DockSize, number> = { small: 0.85, medium: 1, large: 1.2 }

// Из памяти устройства или копии: целое от 70 до 100, иначе — не задано
export function parseTableSize(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= TABLE_SIZE_MIN && raw <= TABLE_SIZE_MAX ? raw : null
}

export function parseDockSize(raw: unknown): DockSize | null {
  return DOCK_SIZE_LABELS.some(([id]) => id === raw) ? (raw as DockSize) : null
}

// Переменные CSS обёртки стола: --table-size — доля места (0,7…1), --dock-zoom — масштаб панели.
// Не задано — 100 % и «Средняя»
export function tableFitVars(size: number | null, dock: DockSize | null): Record<'--table-size' | '--dock-zoom', string> {
  return {
    '--table-size': String((size ?? TABLE_SIZE_DEFAULT) / 100),
    '--dock-zoom': String(DOCK_ZOOM[dock ?? DOCK_SIZE_DEFAULT]),
  }
}
