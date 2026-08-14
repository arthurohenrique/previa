'use client'

import { useEffect, useState } from 'react'
import { Simulator } from '@/app/(app)/sessao/[id]/Simulator'
import type { FaceGeometry, Landmark } from '@/lib/face/types'
import { useSessionStore } from '@/store/useSessionStore'

const WIDTH = 1200
const HEIGHT = 1600

/**
 * Rosto sintético: 478 pontos espalhados numa oval, determinísticos. Não parecem
 * um rosto, e não precisam — o que está sob teste é o caminho de render, não a
 * anatomia.
 */
function syntheticLandmarks(): Landmark[] {
  const points: Landmark[] = []
  for (let i = 0; i < 478; i += 1) {
    const angle = (i * 2.399963) % (Math.PI * 2)
    const radius = 0.1 + 0.34 * ((i % 37) / 36)
    points.push({
      x: 0.5 + radius * Math.cos(angle) * 0.62,
      y: 0.48 + radius * Math.sin(angle) * 0.9,
      z: 0,
    })
  }
  points[468] = { x: 0.4, y: 0.4, z: 0 }
  points[473] = { x: 0.6, y: 0.4, z: 0 }
  return points
}

/** Foto sintética com áreas claras e escuras: tela preta fica evidente. */
async function syntheticPhoto(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas indisponível.')

  const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT)
  gradient.addColorStop(0, 'rgb(217 160 102)')
  gradient.addColorStop(1, 'rgb(122 75 40)')
  context.fillStyle = gradient
  context.fillRect(0, 0, WIDTH, HEIGHT)

  context.fillStyle = 'rgb(242 210 179)'
  context.beginPath()
  context.ellipse(WIDTH / 2, HEIGHT * 0.48, WIDTH * 0.3, HEIGHT * 0.33, 0, 0, Math.PI * 2)
  context.fill()

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Falha ao gerar a imagem.'))),
      'image/jpeg',
      0.9,
    )
  })
}

export function RenderHarness() {
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [geometry, setLocalGeometry] = useState<FaceGeometry | null>(null)
  const setGeometry = useSessionStore((state) => state.setGeometry)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const built: FaceGeometry = {
        landmarks: syntheticLandmarks(),
        pose: { yaw: 0, pitch: 0, roll: 0 },
        ipdPx: 0.2 * WIDTH,
        width: WIDTH,
        height: HEIGHT,
      }
      const blob = await syntheticPhoto()
      if (cancelled) return

      setGeometry(built)
      setLocalGeometry(built)
      setPhoto(blob)
    })()

    return () => {
      cancelled = true
    }
  }, [setGeometry])

  if (!photo || !geometry) {
    return <p className="p-3 text-body text-label-secondary">Preparando a bancada.</p>
  }

  return (
    <div
      data-appearance="dark"
      data-render-harness="pronto"
      className="h-dvh w-dvw bg-background text-label"
    >
      <Simulator
        sessionId="00000000-0000-4000-8000-000000000000"
        patientName="Bancada de render"
        photoBlob={photo}
        geometry={geometry}
        presets={[]}
        professional={null}
        onRetake={() => {}}
      />
    </div>
  )
}
