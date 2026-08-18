'use client'

import { useEffect, useRef, useState } from 'react'
import { buildRegionInstances, getRegion } from '@/lib/face/atlas'
import type { Landmark } from '@/lib/face/types'
import { WarpPipeline } from '@/lib/warp/pipeline'
import type { ResolvedApplication } from '@/lib/warp/types'

/**
 * Bancada do warp: pipeline isolado, geometria determinística, pixels legíveis.
 *
 * A foto é uma grade fina sobre um degradê. A grade é o instrumento: um
 * deslocamento de poucos pixels move linhas de alto contraste e produz
 * diferença mensurável, coisa que uma pele lisa sintética esconderia.
 */

const WIDTH = 1200
const HEIGHT = 1600

/** Centro da região sob teste, em UV da foto. */
const CENTER = { u: 0.35, v: 0.5 }
/** Raio do polígono da região, em UV. Folgado em relação ao raio do efeito. */
const REGION_RADIUS = 0.13
/** Distância interpupilar sintética: 0.2 da largura. */
const IPD_PX = 0.2 * WIDTH

/**
 * Landmarks determinísticos.
 *
 * Todos ficam num ponto morto no rodapé; só os que importam recebem posição:
 * as duas íris, que dão a escala, e os índices da região malar direita, postos
 * em círculo ao redor de CENTER. Assim o polígono da região é conhecido e a
 * medição pode afirmar onde a mudança deveria estar.
 */
function harnessLandmarks(): Landmark[] {
  const points: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.95, z: 0 }))

  points[468] = { x: 0.4, y: 0.3, z: 0 }
  points[473] = { x: 0.6, y: 0.3, z: 0 }

  const malar = getRegion('malar').right
  malar.forEach((index, position) => {
    const angle = (position / malar.length) * Math.PI * 2
    points[index] = {
      x: CENTER.u + REGION_RADIUS * Math.cos(angle),
      y: CENTER.v + REGION_RADIUS * Math.sin(angle) * (WIDTH / HEIGHT),
      z: 0,
    }
  })

  return points
}

async function harnessPhoto(): Promise<ImageBitmap> {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas indisponível.')

  const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT)
  gradient.addColorStop(0, 'rgb(226 178 132)')
  gradient.addColorStop(1, 'rgb(140 92 56)')
  context.fillStyle = gradient
  context.fillRect(0, 0, WIDTH, HEIGHT)

  // Grade de 12 px: o deslocamento máximo do preenchedor na malar é da ordem de
  // 8 px nesta escala, então uma linha atravessa quase uma célula inteira.
  context.strokeStyle = 'rgb(40 24 14)'
  context.lineWidth = 2
  context.beginPath()
  for (let x = 0; x <= WIDTH; x += 12) {
    context.moveTo(x + 0.5, 0)
    context.lineTo(x + 0.5, HEIGHT)
  }
  for (let y = 0; y <= HEIGHT; y += 12) {
    context.moveTo(0, y + 0.5)
    context.lineTo(WIDTH, y + 0.5)
  }
  context.stroke()

  return createImageBitmap(canvas)
}

export interface WarpMetrics {
  /** Pixels cuja soma de |Δ| nos três canais passa do limiar. */
  changed: number
  total: number
  changedRatio: number
  meanDiff: number
  maxDiff: number
  /** Centro de massa da diferença, em UV da imagem lida. */
  centroidU: number
  centroidV: number
  /** Maior distância de um pixel alterado até o centro da aplicação, em UV. */
  maxRadiusU: number
  /** Fração dos pixels alterados que caem fora do polígono da região. */
  outsideRegionRatio: number
}

interface HarnessApi {
  photo: { width: number; height: number }
  center: { u: number; v: number }
  ipdPx: number
  regionRadius: number
  /** Substitui o conjunto de aplicações e redesenha. */
  apply: (applications: ResolvedApplication[]) => void
  /** Guarda o quadro atual como referência. */
  capture: () => void
  /** Compara o quadro atual com a referência. */
  measure: () => WarpMetrics
  /** Tamanho da leitura em pixels, e quanto ela vale em pixels da foto. */
  readSize: () => { width: number; height: number; scale: number }
  /**
   * Centros das linhas escuras da grade ao longo de uma linha horizontal.
   *
   * É o instrumento que mede deslocamento de verdade: a grade é regular, então
   * comparar as posições antes e depois dá quantos pixels o tecido andou —
   * afirmação bem mais forte do que "algum pixel mudou".
   */
  scanline: (v: number) => number[]
  /**
   * O mesmo, na vertical.
   *
   * Técnica de direção fixa — o bioestimulador empurra em superior-lateral —
   * move o tecido nos dois eixos. Medir só na horizontal subestima o
   * deslocamento e, pior, desloca a linha amostrada para outro conteúdo, o que
   * faz a contagem de linhas mudar e a medida virar ruído.
   */
  scancolumn: (u: number) => number[]
}

/** Soma de |Δ| nos três canais acima da qual o pixel conta como alterado. */
const DIFF_THRESHOLD = 12

export function WarpHarness() {
  const stageRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('preparando')

  useEffect(() => {
    let pipeline: WarpPipeline | null = null
    let cancelled = false

    void (async () => {
      const stage = stageRef.current
      if (!stage) return

      const landmarks = harnessLandmarks()
      const photo = await harnessPhoto()
      if (cancelled) {
        photo.close()
        return
      }

      pipeline = await WarpPipeline.create({
        container: stage,
        photo,
        ipdPx: IPD_PX,
        regionInstances: buildRegionInstances(landmarks, WIDTH / HEIGHT),
      })

      if (cancelled) {
        pipeline.destroy()
        return
      }

      pipeline.setApplications([])

      let baseline: Uint8ClampedArray | null = null
      let baselineSize = { width: 0, height: 0 }

      const api: HarnessApi = {
        photo: { width: WIDTH, height: HEIGHT },
        center: CENTER,
        ipdPx: IPD_PX,
        regionRadius: REGION_RADIUS,

        apply(applications) {
          pipeline?.setApplications(applications)
        },

        capture() {
          const read = pipeline?.readPixels()
          if (!read) return
          baseline = read.pixels.slice()
          baselineSize = { width: read.width, height: read.height }
        },

        measure() {
          const read = pipeline?.readPixels()
          if (!read || !baseline) throw new Error('Sem referência para comparar.')
          if (read.width !== baselineSize.width || read.height !== baselineSize.height) {
            throw new Error('A leitura mudou de tamanho entre os quadros.')
          }

          const { pixels, width, height } = read
          let changed = 0
          let sum = 0
          let max = 0
          let sumX = 0
          let sumY = 0
          let maxRadius = 0
          let outside = 0

          const centerX = CENTER.u * width
          const centerY = CENTER.v * height
          // O polígono é um círculo em UV; em pixels ele é uma elipse, porque a
          // leitura tem a proporção da foto.
          const regionX = REGION_RADIUS * width
          const regionY = REGION_RADIUS * (WIDTH / HEIGHT) * height

          for (let index = 0; index < pixels.length; index += 4) {
            const delta =
              Math.abs((pixels[index] as number) - (baseline[index] as number)) +
              Math.abs((pixels[index + 1] as number) - (baseline[index + 1] as number)) +
              Math.abs((pixels[index + 2] as number) - (baseline[index + 2] as number))

            if (delta <= DIFF_THRESHOLD) continue

            const pixel = index / 4
            const x = pixel % width
            const y = Math.floor(pixel / width)

            changed += 1
            sum += delta
            if (delta > max) max = delta
            sumX += x
            sumY += y

            const radius = Math.hypot((x - centerX) / width, (y - centerY) / width)
            if (radius > maxRadius) maxRadius = radius

            const normalized =
              ((x - centerX) / regionX) ** 2 + ((y - centerY) / regionY) ** 2
            if (normalized > 1) outside += 1
          }

          return {
            changed,
            total: width * height,
            changedRatio: changed / (width * height),
            meanDiff: changed > 0 ? sum / changed : 0,
            maxDiff: max,
            centroidU: changed > 0 ? sumX / changed / width : 0,
            centroidV: changed > 0 ? sumY / changed / height : 0,
            maxRadiusU: maxRadius,
            outsideRegionRatio: changed > 0 ? outside / changed : 0,
          }
        },

        readSize() {
          const read = pipeline?.readPixels()
          if (!read) throw new Error('Pipeline indisponível.')
          return { width: read.width, height: read.height, scale: read.width / WIDTH }
        },

        scanline(v) {
          const read = pipeline?.readPixels()
          if (!read) throw new Error('Pipeline indisponível.')

          const { pixels, width, height } = read
          const row = Math.min(height - 1, Math.max(0, Math.round(v * height)))
          const base = row * width * 4

          // Uma linha da grade é escura contra pele clara. O limiar separa as
          // duas populações com folga; o centro de cada corrida escura é a
          // posição da linha.
          const centers: number[] = []
          let runStart = -1

          for (let x = 0; x < width; x += 1) {
            const index = base + x * 4
            const luma =
              0.299 * (pixels[index] as number) +
              0.587 * (pixels[index + 1] as number) +
              0.114 * (pixels[index + 2] as number)

            const dark = luma < 90
            if (dark && runStart < 0) runStart = x
            if (!dark && runStart >= 0) {
              centers.push((runStart + x - 1) / 2)
              runStart = -1
            }
          }
          if (runStart >= 0) centers.push((runStart + width - 1) / 2)

          return centers
        },

        scancolumn(u) {
          const read = pipeline?.readPixels()
          if (!read) throw new Error('Pipeline indisponível.')

          const { pixels, width, height } = read
          const column = Math.min(width - 1, Math.max(0, Math.round(u * width)))

          const centers: number[] = []
          let runStart = -1

          for (let y = 0; y < height; y += 1) {
            const index = (y * width + column) * 4
            const luma =
              0.299 * (pixels[index] as number) +
              0.587 * (pixels[index + 1] as number) +
              0.114 * (pixels[index + 2] as number)

            const dark = luma < 90
            if (dark && runStart < 0) runStart = y
            if (!dark && runStart >= 0) {
              centers.push((runStart + y - 1) / 2)
              runStart = -1
            }
          }
          if (runStart >= 0) centers.push((runStart + height - 1) / 2)

          return centers
        },
      }

      ;(window as unknown as Record<string, unknown>).__previaWarp = api
      setStatus('pronto')
    })()

    return () => {
      cancelled = true
      pipeline?.destroy()
      delete (window as unknown as Record<string, unknown>).__previaWarp
    }
  }, [])

  return (
    <div data-appearance="dark" className="h-dvh w-dvw bg-background text-label">
      <div data-warp-harness={status} className="absolute inset-0" ref={stageRef} />
    </div>
  )
}
