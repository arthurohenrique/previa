/**
 * Estratégia alternativa de segmentação: máscara por polígonos derivados dos
 * 478 landmarks do MediaPipe. Sem IA adicional — é o caminho do perfil baixo
 * e o fallback do portão da Fase 2.5. Fidelidade menor (sem cabelo, contornos
 * aproximados), suficiente para limitar as deformações por região.
 */

import { FACE_CLASSES } from './mask'
import type { LabelMap } from './mask'
import type { Point2 } from '@/lib/quality'

/** Contornos fechados do FaceMesh (índices canônicos do MediaPipe). */
export const REGION_POLYGONS: ReadonlyArray<{ classId: number; indices: readonly number[] }> = [
  {
    classId: FACE_CLASSES.skin,
    indices: [
      10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379,
      378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127,
      162, 21, 54, 103, 67, 109,
    ],
  },
  {
    classId: FACE_CLASSES.l_brow,
    indices: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
  },
  {
    classId: FACE_CLASSES.r_brow,
    indices: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
  },
  {
    classId: FACE_CLASSES.l_eye,
    indices: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  },
  {
    classId: FACE_CLASSES.r_eye,
    indices: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  },
  {
    classId: FACE_CLASSES.u_lip,
    indices: [
      61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, // arco externo superior
      308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78, // arco interno de volta
    ],
  },
  {
    classId: FACE_CLASSES.l_lip,
    indices: [
      61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, // arco externo inferior
      308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78, // arco interno de volta
    ],
  },
]

/** Converte índices de landmark em polígono na resolução do labelmap. */
export function polygonFromLandmarks(
  landmarks: readonly Point2[],
  indices: readonly number[],
  width: number,
  height: number,
): Array<[number, number]> {
  return indices.map((index) => {
    const point = landmarks[index]
    return [point.x * width, point.y * height]
  })
}

/**
 * Rasteriza os polígonos num labelmap. A pele entra primeiro; as regiões
 * menores sobrescrevem por cima (ordem do array REGION_POLYGONS).
 */
export function rasterizeLandmarkMask(
  landmarks: readonly Point2[],
  width: number,
  height: number,
): LabelMap {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('Canvas 2D indisponível.')

  for (const region of REGION_POLYGONS) {
    const polygon = polygonFromLandmarks(landmarks, region.indices, width, height)
    context.fillStyle = `rgb(${region.classId}, 0, 0)`
    context.beginPath()
    context.moveTo(polygon[0][0], polygon[0][1])
    for (let i = 1; i < polygon.length; i++) context.lineTo(polygon[i][0], polygon[i][1])
    context.closePath()
    context.fill()
  }

  const { data } = context.getImageData(0, 0, width, height)
  const labels = new Uint8Array(width * height)
  for (let i = 0; i < labels.length; i++) {
    // Canal R carrega o id da classe (anti-aliasing arredonda para o vizinho).
    labels[i] = data[i * 4]
  }
  return { labels, width, height }
}
