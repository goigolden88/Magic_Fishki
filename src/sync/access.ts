// Копия из FamilyCore@d9e5ec6 (ui/access.ts), правится здесь.
// Что сказать человеку после «Проверить доступ». Права fine-grained токена GitHub не сообщает: canWrite — права
// аккаунта на репозиторий, у владельца всегда true. Поэтому «можно» не обещается: токен Read-only поймает первая
// отправка своим 403. «Нельзя» — правда: аккаунт без записи не пишет ни с каким токеном
import type { RepoInfo } from './github'

export function accessWords(access: RepoInfo, branch: string): { note: string; error: string } {
  const parts = [`Репозиторий ${access.fullName} найден`, access.private ? 'приватный' : 'ПУБЛИЧНЫЙ — данные увидят все']
  if (access.defaultBranch !== branch) parts.push(`ветка по умолчанию — ${access.defaultBranch}`)
  const found = `${parts.join(', ')}.`

  if (!access.canWrite) {
    return {
      note: found,
      error:
        'У аккаунта, выпустившего токен, писать в этот репозиторий нельзя. ' +
        'Нужен токен владельца репозитория с «Contents: Read and write».',
    }
  }
  if (!access.private) {
    return {
      note: found,
      error: 'Репозиторий публичный: игры, раздачи и заметки увидят все. Сделай его приватным в настройках GitHub.',
    }
  }
  return {
    note:
      `${found} Права токена GitHub не сообщает: «Contents: Read and write» ` +
      'выбирается при выпуске, а если его нет — скажет первая отправка.',
    error: '',
  }
}
