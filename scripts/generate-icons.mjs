// Gera os ícones da PWA sem depender de biblioteca de imagem.
//
// `sharp` é proibido em runtime Edge e traz binário nativo por plataforma; para
// desenhar um anel sobre fundo preto, um encoder PNG de quarenta linhas com o
// zlib do próprio Node resolve e não entra no bundle.
//
// Rode com: node scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'public', 'icons')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filtro None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * A marca é um anel — a silhueta do enquadramento facial, que é o gesto do
 * produto. Fundo preto porque o simulador é escuro fixo (E-01) e o ícone precisa
 * reconhecer o app, não competir com ele.
 */
function drawIcon(size, { padding }) {
  const rgba = Buffer.alloc(size * size * 4)
  const center = size / 2
  const outer = center * (1 - padding)
  const thickness = Math.max(2, size * 0.055)
  const inner = outer - thickness
  const squash = 0.78 // o rosto é mais alto que largo

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - center) / squash
      const dy = y + 0.5 - center
      const distance = Math.hypot(dx, dy)

      // Antialiasing de um pixel nas duas bordas do anel.
      const outerAlpha = Math.min(1, Math.max(0, outer - distance + 0.5))
      const innerAlpha = Math.min(1, Math.max(0, distance - inner + 0.5))
      const alpha = Math.min(outerAlpha, innerAlpha)

      const index = (y * size + x) * 4
      const value = Math.round(255 * alpha)
      rgba[index] = value
      rgba[index + 1] = value
      rgba[index + 2] = value
      rgba[index + 3] = 255
    }
  }

  return encodePng(size, size, rgba)
}

await mkdir(outDir, { recursive: true })

const targets = [
  { name: 'icon-192.png', size: 192, padding: 0.12 },
  { name: 'icon-512.png', size: 512, padding: 0.12 },
  // Maskable: o sistema recorta até 20% de cada lado, então a marca recua.
  { name: 'icon-maskable-512.png', size: 512, padding: 0.26 },
  { name: 'apple-touch-icon.png', size: 180, padding: 0.14 },
]

for (const target of targets) {
  await writeFile(join(outDir, target.name), drawIcon(target.size, { padding: target.padding }))
  console.log(`[previa] ${target.name}`)
}
