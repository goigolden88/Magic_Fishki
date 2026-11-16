// Версия сборки (#234): ставит vite.config.ts (define) при сборке и в тестах
declare const __BUILD_DATE__: string // день сборки, YYYY-MM-DD (UTC)
declare const __BUILD_COMMIT__: string // короткий хеш коммита или «dev»
