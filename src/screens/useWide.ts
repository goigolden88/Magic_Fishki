import { useEffect, useState } from 'react'

// Широкое окно (Р-53): от 1024 px — раскладка для компьютера. Тот же порог, что у @media в styles.css
export const WIDE_QUERY = '(min-width: 1024px)'

function matches(): boolean {
  return typeof matchMedia === 'function' && matchMedia(WIDE_QUERY).matches
}

// true — окно не уже порога; меняется само, когда окно растягивают или сужают
export function useWide(): boolean {
  const [wide, setWide] = useState(matches)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const query = matchMedia(WIDE_QUERY)
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}
