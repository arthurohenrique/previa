import { describe, expect, it } from 'vitest'
import {
  assessQuality,
  faceBounds,
  laplacianVariance,
  MAX_ANGLE_DEG,
  MIN_IPD_PX,
} from '@/lib/face/quality'
import type { HeadPose, Landmark } from '@/lib/face/types'

const WIDTH = 240
const HEIGHT = 240

/** Landmarks espalhados por um quadrado central da foto. */
function landmarks(): Landmark[] {
  return Array.from({ length: 478 }, (_, index) => ({
    x: 0.25 + 0.5 * ((index % 22) / 21),
    y: 0.2 + 0.6 * (Math.floor(index / 22) / 21),
    z: 0,
  }))
}

/** Imagem com textura: xadrez de contraste, nítida por construção. */
function sharpImage(level = 128, contrast = 90): ImageDataLike {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const value = (x + y) % 2 === 0 ? level + contrast : level - contrast
      const index = (y * WIDTH + x) * 4
      data[index] = value
      data[index + 1] = value
      data[index + 2] = value
      data[index + 3] = 255
    }
  }
  return { data, width: WIDTH, height: HEIGHT, colorSpace: 'srgb' }
}

/** Imagem chapada: sem borda nenhuma, logo variância de Laplaciano zero. */
function flatImage(level = 128): ImageDataLike {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4)
  data.fill(level)
  for (let i = 3; i < data.length; i += 4) data[i] = 255
  return { data, width: WIDTH, height: HEIGHT, colorSpace: 'srgb' }
}

// `ImageData` não existe no Node; a função só usa data/width/height.
interface ImageDataLike {
  data: Uint8ClampedArray
  width: number
  height: number
  colorSpace: string
}

const frontal: HeadPose = { yaw: 2, pitch: -1, roll: 0.5 }

function assess(image: ImageDataLike, pose: HeadPose, ipdPx = 140) {
  return assessQuality(image as unknown as ImageData, landmarks(), pose, ipdPx)
}

describe('recorte do rosto', () => {
  it('cobre os landmarks com folga e fica dentro da foto', () => {
    const bounds = faceBounds(landmarks(), WIDTH, HEIGHT)
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.y).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(WIDTH)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(HEIGHT)
    expect(bounds.width).toBeGreaterThan(0)
  })
})

describe('nitidez', () => {
  it('dá variância zero para imagem chapada', () => {
    const gray = new Float32Array(64 * 64).fill(120)
    expect(laplacianVariance({ data: gray, width: 64, height: 64 })).toBeCloseTo(0, 10)
  })

  it('reprova foto desfocada com mensagem que diz o que fazer', () => {
    const report = assess(flatImage(), frontal)
    const blur = report.issues.find((issue) => issue.code === 'blur')

    expect(report.ok).toBe(false)
    expect(blur?.message).toBe('Foto desfocada. Apoie o tablet e refaça.')
  })
})

describe('ângulo, bloqueante', () => {
  it('aprova rosto frontal e nítido', () => {
    expect(assess(sharpImage(), frontal).ok).toBe(true)
  })

  it('reprova rosto de perfil', () => {
    const report = assess(sharpImage(), { yaw: MAX_ANGLE_DEG + 6, pitch: 0, roll: 0 })
    expect(report.ok).toBe(false)
    expect(report.issues.map((issue) => issue.code)).toContain('angle_yaw')
    expect(report.issues[0]?.message).toBe('Rosto de perfil. Reposicione para frontal.')
  })

  it('diferencia queixo levantado de queixo baixo', () => {
    const up = assess(sharpImage(), { yaw: 0, pitch: 20, roll: 0 })
    const down = assess(sharpImage(), { yaw: 0, pitch: -20, roll: 0 })

    expect(up.issues.find((issue) => issue.code === 'angle_pitch')?.message).toContain(
      'Baixe o queixo',
    )
    expect(down.issues.find((issue) => issue.code === 'angle_pitch')?.message).toContain(
      'Levante o queixo',
    )
  })

  it('reprova cabeça inclinada', () => {
    const report = assess(sharpImage(), { yaw: 0, pitch: 0, roll: -18 })
    expect(report.issues.map((issue) => issue.code)).toContain('angle_roll')
  })

  it('aceita exatamente no limite da tolerância', () => {
    expect(assess(sharpImage(), { yaw: MAX_ANGLE_DEG, pitch: 0, roll: 0 }).ok).toBe(true)
  })
})

describe('exposição e resolução', () => {
  it('reprova foto escura', () => {
    const report = assess(sharpImage(40, 30), frontal)
    expect(report.issues.map((issue) => issue.code)).toContain('underexposed')
  })

  it('reprova foto estourada', () => {
    const report = assess(sharpImage(238, 12), frontal)
    expect(report.issues.map((issue) => issue.code)).toContain('overexposed')
  })

  it('reprova rosto pequeno demais para simular', () => {
    const report = assess(sharpImage(), frontal, MIN_IPD_PX - 10)
    expect(report.issues.map((issue) => issue.code)).toContain('too_small')
  })

  it('devolve as métricas medidas junto com o laudo', () => {
    const report = assess(sharpImage(), frontal, 137)
    expect(report.metrics.ipdPx).toBe(137)
    expect(report.metrics.pose).toEqual(frontal)
    expect(report.metrics.laplacianVariance).toBeGreaterThan(0)
  })
})
