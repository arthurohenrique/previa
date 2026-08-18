'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Simulator } from '@/app/(app)/sessao/[id]/Simulator'
import { ATLAS, type RegionId } from '@/lib/face/atlas'
import type { FaceGeometry, Landmark } from '@/lib/face/types'
import type { WarpPipeline } from '@/lib/warp/pipeline'
import { useSessionStore } from '@/store/useSessionStore'

/**
 * Bancada do simulador inteiro.
 *
 * Monta o `Simulator` de verdade — o mesmo store, o mesmo pipeline, a mesma
 * barra de controles — com foto e geometria sintéticas, sem detecção, sem
 * paciente e sem banco. Responde a duas perguntas que nada mais responde:
 *
 * 1. algum controle cobre a foto? (`e2e/interface-layout.spec.ts`)
 * 2. tocar numa região muda mesmo os pixels, no caminho que o produto usa?
 *    (`e2e/simulacao.spec.ts`)
 *
 * A segunda não é a mesma pergunta de `/diagnostico/warp`. Lá o pipeline é
 * alimentado à mão; aqui ele é alimentado pelo store, pelo atlas e pelo toque —
 * que é onde um defeito de integração mora.
 *
 * Fora de desenvolvimento a rota não existe.
 */

const WIDTH = 1200
const HEIGHT = 1600

/**
 * Centro e raio de cada região, em UV da foto. Um rosto esquemático: não é
 * anatomia, é topologia — as regiões nos lugares certos umas em relação às
 * outras, com área suficiente para o feather da máscara caber dentro.
 */
const PLACES: Record<RegionId, { u: number; v: number; r: number }> = {
  frontal: { u: 0.5, v: 0.2, r: 0.15 },
  glabella: { u: 0.5, v: 0.31, r: 0.06 },
  periorbital: { u: 0.35, v: 0.35, r: 0.08 },
  nasal_dorsum: { u: 0.5, v: 0.43, r: 0.05 },
  malar: { u: 0.29, v: 0.46, r: 0.1 },
  nasolabial_fold: { u: 0.4, v: 0.56, r: 0.06 },
  upper_lip: { u: 0.5, v: 0.63, r: 0.08 },
  lower_lip: { u: 0.5, v: 0.7, r: 0.08 },
  chin: { u: 0.5, v: 0.81, r: 0.08 },
  jawline: { u: 0.28, v: 0.71, r: 0.12 },
}

/** Íris, de onde sai a DIP. Espelhadas em torno da linha média. */
const IRIS_RIGHT = { x: 0.36, y: 0.35 }
const IRIS_LEFT = { x: 0.64, y: 0.35 }

/**
 * Landmarks sintéticos.
 *
 * Cada lado de cada região vira um círculo de pontos no seu lugar. Duas regras
 * fazem a diferença entre uma bancada que mede alguma coisa e uma que mente:
 *
 * - **Quem chega primeiro fica.** Vários índices pertencem a duas regiões (o 9
 *   é da glabela e da frontal). Se o último a escrever vencesse, a âncora de uma
 *   região iria parar dentro do polígono da outra, a máscara valeria zero no
 *   ponto tocado, e a bancada acusaria um defeito que é dela.
 * - **Ponto sobra vai para fora do quadro**, não para o meio do rosto: landmark
 *   não usado por região nenhuma não pode inflar fecho convexo de ninguém.
 */
function harnessLandmarks(): Landmark[] {
  const points: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 1.4, z: 0 }))
  const taken = new Set<number>()

  const place = (indices: readonly number[], u: number, v: number, r: number) => {
    indices.forEach((index, position) => {
      if (taken.has(index)) return
      taken.add(index)
      const angle = (position / Math.max(indices.length, 1)) * Math.PI * 2
      points[index] = {
        x: u + r * Math.cos(angle),
        // O raio é isotrópico em pixels: em UV o eixo vertical encolhe na
        // proporção da foto.
        y: v + r * Math.sin(angle) * (WIDTH / HEIGHT),
        z: 0,
      }
    })
  }

  for (const region of ATLAS) {
    const place0 = PLACES[region.id]
    place(region.right, place0.u, place0.v, place0.r)
    // O lado esquerdo é o espelho do direito em torno de u = 0.5.
    if (region.left.length > 0) place(region.left, 1 - place0.u, place0.v, place0.r)
  }

  points[468] = { ...IRIS_LEFT, z: 0 }
  points[473] = { ...IRIS_RIGHT, z: 0 }

  return points
}

function harnessGeometry(): FaceGeometry {
  return {
    landmarks: harnessLandmarks(),
    pose: { yaw: 0, pitch: 0, roll: 0 },
    ipdPx: (IRIS_LEFT.x - IRIS_RIGHT.x) * WIDTH,
    width: WIDTH,
    height: HEIGHT,
  }
}

/**
 * Degradê de pele com uma grade fina.
 *
 * A grade é o instrumento: um deslocamento de poucos pixels move linhas de alto
 * contraste e vira diferença mensurável, coisa que pele lisa sintética
 * esconderia.
 */
async function harnessPhoto(): Promise<Blob> {
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

  // Passo de 24 px: o deslocamento máximo do preenchedor nesta escala é da
  // ordem de 13 px, então nenhuma linha alcança a vizinha. Com passo menor, duas
  // linhas podem se cruzar e o casamento por índice deixa de valer.
  context.strokeStyle = 'rgb(40 24 14)'
  context.lineWidth = 2
  context.beginPath()
  for (let x = 0; x <= WIDTH; x += 24) {
    context.moveTo(x + 0.5, 0)
    context.lineTo(x + 0.5, HEIGHT)
  }
  for (let y = 0; y <= HEIGHT; y += 24) {
    context.moveTo(0, y + 0.5)
    context.lineTo(WIDTH, y + 0.5)
  }
  context.stroke()

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob devolveu vazio.'))),
      'image/png',
    )
  })
}

/** Diferença entre o quadro atual e a referência capturada. */
export interface HarnessMetrics {
  changed: number
  total: number
  changedRatio: number
  meanDiff: number
  maxDiff: number
  /** Centro de massa da mudança, em UV da foto. NaN quando nada mudou. */
  centroidU: number
  centroidV: number
}

/** Uma região como o produto a vê, para o teste saber onde tocar e onde medir. */
export interface HarnessInstance {
  key: string
  label: string
  core: { x: number; y: number }
  inscribedU: number
}

/** O que a bancada publica em `window` para o teste ler. */
export interface HarnessBridge {
  /** Pixels do palco, direto do framebuffer. */
  readPixels: () => { pixels: Uint8ClampedArray; width: number; height: number }
  /**
   * Centros das linhas escuras da grade ao longo de uma linha horizontal, em
   * pixels da leitura.
   *
   * É o instrumento que mede deslocamento de verdade. Contar pixels diferentes
   * responde "mudou"; a grade responde "mudou quanto", que é a pergunta que
   * separa uma simulação visível de uma que o profissional jura que não
   * funciona.
   */
  scanline: (v: number) => number[]
  /** Congela o quadro atual como referência. */
  capture: () => void
  /**
   * Compara o quadro atual com a referência. A conta acontece na página: passar
   * dois milhões de pixels pelo protocolo do navegador levaria segundos por
   * medida e faria o teste medir latência de CDP em vez de simulação.
   */
  measure: () => HarnessMetrics
  /** Tamanho da leitura e quantos pixels de leitura vale um pixel da foto. */
  readSize: () => { width: number; height: number; scale: number }
  instances: () => HarnessInstance[]
  geometry: FaceGeometry
}

declare global {
  interface Window {
    __previaBancada?: HarnessBridge
  }
}

export function InterfaceHarness() {
  const geometry = useMemo(() => harnessGeometry(), [])
  const setGeometry = useSessionStore((state) => state.setGeometry)
  const reset = useSessionStore((state) => state.reset)
  const [photo, setPhoto] = useState<Blob | null>(null)

  useEffect(() => {
    // O Simulator lê `regionInstances` do store, que só existe depois disto.
    setGeometry(geometry)
    void harnessPhoto().then(setPhoto)
    return () => {
      reset()
    }
  }, [geometry, reset, setGeometry])

  const publish = useCallback(
    (pipeline: WarpPipeline | null) => {
      if (!pipeline) {
        delete window.__previaBancada
        return
      }

      let reference: Uint8ClampedArray | null = null

      window.__previaBancada = {
        readPixels: () => pipeline.readPixels(),
        readSize: () => {
          const { width, height } = pipeline.readPixels()
          return { width, height, scale: width / geometry.width }
        },
        scanline: (v: number) => {
          const { pixels, width, height } = pipeline.readPixels()
          const row = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))))
          const base = row * width * 4

          // Limiar no meio do contraste da grade sobre a pele, medido na própria
          // linha: o degradê muda a luminância de ponta a ponta, e um limiar
          // fixo perderia linhas de um lado.
          let min = 255
          let max = 0
          const luma: number[] = []
          for (let x = 0; x < width; x += 1) {
            const i = base + x * 4
            const value =
              0.299 * (pixels[i] ?? 0) + 0.587 * (pixels[i + 1] ?? 0) + 0.114 * (pixels[i + 2] ?? 0)
            luma.push(value)
            if (value < min) min = value
            if (value > max) max = value
          }
          const threshold = min + (max - min) * 0.45

          const centers: number[] = []
          let start = -1
          for (let x = 0; x < width; x += 1) {
            const dark = (luma[x] ?? 255) < threshold
            if (dark && start < 0) start = x
            if (!dark && start >= 0) {
              centers.push((start + x - 1) / 2)
              start = -1
            }
          }
          if (start >= 0) centers.push((start + width - 1) / 2)
          return centers
        },
        capture: () => {
          const { pixels } = pipeline.readPixels()
          reference = new Uint8ClampedArray(pixels)
        },
        measure: () => {
          const { pixels, width, height } = pipeline.readPixels()
          if (!reference || reference.length !== pixels.length) {
            throw new Error('capture() antes de measure().')
          }

          let changed = 0
          let sum = 0
          let maxDiff = 0
          let weightedU = 0
          let weightedV = 0

          for (let index = 0; index < pixels.length; index += 4) {
            const difference =
              Math.abs((pixels[index] ?? 0) - (reference[index] ?? 0)) +
              Math.abs((pixels[index + 1] ?? 0) - (reference[index + 1] ?? 0)) +
              Math.abs((pixels[index + 2] ?? 0) - (reference[index + 2] ?? 0))

            sum += difference
            if (difference > maxDiff) maxDiff = difference
            // O limiar corta ruído de arredondamento do próprio render sem
            // perder mudança de verdade: a grade tem contraste de centenas.
            if (difference <= 8) continue

            changed += 1
            const pixel = index / 4
            weightedU += (pixel % width) / width
            weightedV += Math.floor(pixel / width) / height
          }

          const total = pixels.length / 4
          return {
            changed,
            total,
            changedRatio: changed / total,
            meanDiff: sum / total,
            maxDiff,
            centroidU: weightedU / changed,
            centroidV: weightedV / changed,
          }
        },
        instances: () =>
          useSessionStore.getState().regionInstances.map((instance) => ({
            key: instance.key,
            label: instance.region.label,
            core: instance.core,
            inscribedU: instance.inscribedU,
          })),
        geometry,
      }
    },
    [geometry],
  )

  if (!photo) {
    return (
      <p data-testid="bancada-carregando" className="p-2 text-body text-label-secondary">
        Montando a bancada…
      </p>
    )
  }

  return (
    <div data-appearance="dark" className="h-dvh w-dvw overflow-hidden bg-background text-label">
      <Simulator photoBlob={photo} geometry={geometry} onRetake={() => {}} onPipeline={publish} />
    </div>
  )
}
