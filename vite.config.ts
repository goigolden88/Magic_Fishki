import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { chipIcon, ICONS } from './scripts/icons.ts'

const BASE = '/Magic_Fishki/'

// PNG-иконки рисуются при сборке (scripts/icons.ts) и в dev отдаются с сервера;
// apple-touch-icon — ссылкой в <head> для iPhone
function chipIcons(): Plugin {
  return {
    name: 'chip-icons',
    generateBundle() {
      for (const [fileName, spec] of Object.entries(ICONS)) {
        this.emitFile({ type: 'asset', fileName, source: chipIcon(spec) })
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].replace(BASE, '')
        const spec = name ? ICONS[name] : undefined
        if (!spec) return next()
        res.setHeader('Content-Type', 'image/png')
        res.end(chipIcon(spec))
      })
    },
    transformIndexHtml() {
      return [{ tag: 'link', attrs: { rel: 'apple-touch-icon', href: BASE + 'apple-touch-icon.png' }, injectTo: 'head' }]
    },
  }
}

export default defineConfig({
  base: BASE,
  oxc: { jsx: { runtime: 'automatic' } },
  plugins: [
    chipIcons(),
    VitePWA({
      registerType: 'autoUpdate',
      // По образцу манифеста семьи (FamilyCore, familyVite). id постоянный и не меняется
      // никогда: другой id — для Chrome другое приложение (Р-06).
      // Адрес манифеста и start_url — новые, чтобы Android поставил приложение заново
      // без застрявшей записи; после этого тоже не меняются (Р-08)
      manifestFilename: 'fishki.webmanifest',
      manifest: {
        id: '/Magic_Fishki/fishki',
        name: 'Фишки',
        short_name: 'Фишки',
        description: 'Учёт покерного вечера: закупы, выходы, итог и переводы',
        lang: 'ru',
        start_url: BASE + '?app=fishki',
        scope: BASE,
        display: 'standalone',
        background_color: '#0f1a15',
        theme_color: '#0f1a15',
        icons: [
          { src: BASE + 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: BASE + 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: BASE + 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // ?app=fishki в адресе запуска не мешает взять index.html из кеша без сети
        // (первые два — значения Workbox по умолчанию)
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^app$/],
        navigateFallback: 'index.html',
      },
    }),
  ],
})
