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
      for (const [fileName, size] of Object.entries(ICONS)) {
        this.emitFile({ type: 'asset', fileName, source: chipIcon(size) })
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].replace(BASE, '')
        const size = name ? ICONS[name] : undefined
        if (!size) return next()
        res.setHeader('Content-Type', 'image/png')
        res.end(chipIcon(size))
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
      manifest: {
        name: 'Фишки',
        short_name: 'Фишки',
        description: 'Учёт покерного вечера: закупы, выходы, итог и переводы',
        lang: 'ru',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1a15',
        theme_color: '#0f1a15',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
      },
    }),
  ],
})
