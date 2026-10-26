// Знак «ваш ход» (#75): короткий тон Web Audio — без звуковых файлов — и вибрация, где браузер
// умеет (Safari на iPhone не умеет — тогда только звук). Звук браузер пускает только после касания
// страницы: контекст открывается на касании (unlockSound) и дальше играет сам
let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

// На касании экрана стола — разрешить звук на потом
export function unlockSound(): void {
  const c = audio()
  if (c && c.state === 'suspended') void c.resume().catch(() => {})
}

export function signalTurn(sound: boolean): void {
  try {
    navigator.vibrate?.(200)
  } catch {
    // вибрации нет — только звук
  }
  if (!sound) return
  const c = audio()
  if (!c) return
  if (c.state === 'suspended') void c.resume().catch(() => {})
  try {
    const t = c.currentTime
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    osc.connect(gain).connect(c.destination)
    osc.start(t)
    osc.stop(t + 0.3)
  } catch {
    // звук не вышел — ход всё равно виден на экране
  }
}
