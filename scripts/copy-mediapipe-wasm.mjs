// Copia os binários WASM do @mediapipe/tasks-vision para /public/mediapipe/wasm.
//
// Motivo (seção 2 da especificação): nada relacionado à detecção pode depender de
// CDN de terceiros. O modelo .task já vive em /public/models; o runtime WASM
// precisa vir da mesma origem, senão a PWA offline quebra e a clínica com Wi-Fi
// ruim não consegue rodar a detecção.
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const dest = join(root, 'public', 'mediapipe', 'wasm')

if (!existsSync(src)) {
  console.warn('[previa] @mediapipe/tasks-vision/wasm não encontrado — pulei a cópia.')
  process.exit(0)
}

await rm(dest, { recursive: true, force: true })
await mkdir(dest, { recursive: true })
await cp(src, dest, { recursive: true })

const files = await readdir(dest)
console.log(`[previa] WASM do MediaPipe copiado para public/mediapipe/wasm (${files.length} arquivos).`)
