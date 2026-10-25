// Галочки постоянных в выборе игроков: «Выбрать всех» / «Снять все» одной кнопкой

// Отмечены все из списка (пустой список — не «все»: кнопки тогда нет)
export function allPicked(ids: string[], picked: Set<string>): boolean {
  return ids.length > 0 && ids.every((id) => picked.has(id))
}

// Отмечены все — ни одной галочки; иначе — все, уже отмеченные остаются
export function toggleAll(ids: string[], picked: Set<string>): Set<string> {
  return allPicked(ids, picked) ? new Set() : new Set([...picked, ...ids])
}
