'use client'

import { useEffect, useMemo, useState } from 'react'
import { Simulator } from '@/app/(app)/sessao/[id]/Simulator'
import { ATLAS } from '@/lib/face/atlas'
import type { FaceGeometry, Landmark } from '@/lib/face/types'
import { useSessionStore } from '@/store/useSessionStore'

/**
 * Bancada de layout do simulador.
 *
 * Monta o `Simulator` de verdade — os mesmos controles, a mesma barra, o mesmo
 * palco do Pixi — com foto e geometria sintéticas, sem detecção, sem paciente e
 * sem banco. Existe para uma pergunta só: algum controle cobre a foto?
 *
 * A pergunta não é respondível por typecheck nem por teste de unidade. É
 * geometria de layout, e só um navegador com um viewport de iPad de verdade
 * mede. `e2e/interface-layout.spec.ts` mede aqui, nas duas orientações.
 *
 * Fora de desenvolvimento a rota não existe.
 */

const WIDTH = 1200
const HEIGHT = 1600

/** Íris esquerda e direita: a escala (D-04) sai daqui. */
const IRIS_RIGHT = { x: 0.4, y: 0.35 }
const IRIS_LEFT = { x: 0.6, y: 0.35 }

/**
 * Landmarks sintéticos, arrumados por região.
 *
 * Cada lado de cada região vira um pequeno círculo de pontos, posto numa coluna
 * pelo lado e numa linha pela ordem de cascata. Não é um rosto — é um arranjo
 * determinístico com a mesma topologia que o atlas espera: polígono de área
 * positiva por região, âncoras separadas, nada empilhado num ponto só. Para
 * medir se um controle cobre a foto, é exatamente o que basta.
 */
function harnessLandmarks(): Landmark[] {
  const points: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.98, z: 0 }))

  const orders = ATLAS.map((region) => region.cascadeOrder)
  const maxOrder = Math.max(...orders)

  for (const region of ATLAS) {
    // Cascata sobe: ordem 0 no mento, a maior na testa.
    const v = 0.82 - (region.cascadeOrder / maxOrder) * 0.6

    const place = (indices: readonly number[], u: number) => {
      indices.forEach((index, position) => {
        const angle = (position / Math.max(indices.length, 1)) * Math.PI * 2
        points[index] = {
          x: u + 0.06 * Math.cos(angle),
          y: v + 0.06 * Math.sin(angle) * (WIDTH / HEIGHT),
          z: 0,
        }
      })
    }

    place(region.right, region.bilateral ? 0.34 : 0.5)
    if (region.left.length > 0) place(region.left, 0.66)
  }

  points[468] = { ...IRIS_RIGHT, z: 0 }
  points[473] = { ...IRIS_LEFT, z: 0 }

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

/** Degradê de pele com uma grade fina: dá para ver se algo passou por cima. */
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

  context.strokeStyle = 'rgb(40 24 14)'
  context.lineWidth = 2
  context.beginPath()
  for (let x = 0; x <= WIDTH; x += 48) {
    context.moveTo(x + 0.5, 0)
    context.lineTo(x + 0.5, HEIGHT)
  }
  for (let y = 0; y <= HEIGHT; y += 48) {
    context.moveTo(0, y + 0.5)
    context.lineTo(WIDTH, y + 0.5)
  }
  context.stroke()

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob devolveu vazio.'))),
      'image/jpeg',
      0.92,
    )
  })
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

  if (!photo) {
    return (
      <p data-testid="bancada-carregando" className="p-2 text-body text-label-secondary">
        Montando a bancada…
      </p>
    )
  }

  return (
    <div data-appearance="dark" className="h-dvh w-dvw overflow-hidden bg-background text-label">
      <Simulator photoBlob={photo} geometry={geometry} onRetake={() => {}} />
    </div>
  )
}
