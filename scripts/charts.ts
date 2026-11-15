// Чарты «Тренажёра» (#214): npm run charts — набор data/leakproof/nodes.json в свой формат (packCharts из
// src/calc/charts.ts) и файлом в src/calc/chartsData.ts. Модуль приложения грузится через Vite (runnerImport):
// его импорты — без расширений, как у сборки. Набор не меняется; тест charts.test.ts сверяет файл с переводом
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runnerImport } from 'vite'

const NODES = 'data/leakproof/nodes.json'
const OUT = 'src/calc/chartsData.ts'

type ChartsModule = {
  packCharts: (nodes: unknown) => { cells: string }[]
  chartsModuleText: (pack: unknown) => string
}

const { module } = await runnerImport<ChartsModule>(resolve('src/calc/charts.ts'), { configFile: false, logLevel: 'error' })
const pack = module.packCharts(JSON.parse(await readFile(NODES, 'utf8')))
const text = module.chartsModuleText(pack)
await writeFile(OUT, text)
console.log(`${OUT}: решений ${pack.length}, ${Buffer.byteLength(text)} байт`)
