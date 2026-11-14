import { useEffect, useState } from 'react'

// Широкое окно (Р-53): от 1024 px — раскладка для компьютера. Тот же порог, что у @media в styles.css
export const WIDE_QUERY = '(min-width: 1024px)'

// Широкое и не высокое окно (Р-63): стол покера с панелью хода у его правого нижнего угла (#210) —
// тот же запрос, что у @media стола в styles.css
export const WIDE_TABLE_QUERY = '(min-width: 1024px) and (min-aspect-ratio: 1/1)'

function matches(query: string): boolean {
  return typeof matchMedia === 'function' && matchMedia(query).matches
}

// true — окно подходит под запрос (сначала — не уже порога); меняется само, когда окно растягивают или сужают
export function useWide(query: string = WIDE_QUERY): boolean {
  const [wide, setWide] = useState(() => matches(query))
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const list = matchMedia(query)
    const update = () => setWide(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return wide
}
