import { describe, expect, it } from 'vitest'
import { parseDockSize, parseTableSize, tableFitVars } from './tableFit'

// Размер стола и панели ставок на широком окне (Р-63)
describe('размер стола и панели ставок', () => {
  it('размер стола — целое от 70 до 100, иначе не задан', () => {
    expect(parseTableSize(70)).toBe(70)
    expect(parseTableSize(85)).toBe(85)
    expect(parseTableSize(100)).toBe(100)
    expect(parseTableSize(65)).toBeNull()
    expect(parseTableSize(110)).toBeNull()
    expect(parseTableSize(85.5)).toBeNull()
    expect(parseTableSize('85')).toBeNull()
    expect(parseTableSize(undefined)).toBeNull()
  })

  it('панель — маленькая, средняя или крупная, иначе не задана', () => {
    expect(parseDockSize('small')).toBe('small')
    expect(parseDockSize('large')).toBe('large')
    expect(parseDockSize('huge')).toBeNull()
    expect(parseDockSize(null)).toBeNull()
  })

  it('не задано — во всё место и «Средняя», как было', () => {
    expect(tableFitVars(null, null)).toEqual({ '--table-size': '1', '--dock-zoom': '1' })
  })

  it('свой выбор — доля места и масштаб панели', () => {
    expect(tableFitVars(70, 'small')).toEqual({ '--table-size': '0.7', '--dock-zoom': '0.85' })
    expect(tableFitVars(90, 'large')).toEqual({ '--table-size': '0.9', '--dock-zoom': '1.2' })
  })
})
