/**
 * Rosto sintético em proporções REAIS para os testes do motor de warp:
 * foto 768×1024, interocular 208px, vermelhão de ~25px — a mesma escala em
 * que o defeito de amostragem aparece numa foto de consultório.
 */

import type { Point2 } from '@/lib/quality'
import { FACE_CLASSES, type LabelMap } from '@/lib/segmentation/mask'

export const FIXTURE_WIDTH = 768
export const FIXTURE_HEIGHT = 1024

/** Índices posicionados de propósito (os demais ficam no centro do rosto). */
export const FIXTURE_INDICES = new Set<number>()

function place(landmarks: Point2[], index: number, xPx: number, yPx: number): void {
  landmarks[index] = { x: xPx / FIXTURE_WIDTH, y: yPx / FIXTURE_HEIGHT }
  FIXTURE_INDICES.add(index)
}

function placeMirror(
  landmarks: Point2[],
  rightIndex: number,
  leftIndex: number,
  xPx: number,
  yPx: number,
): void {
  place(landmarks, rightIndex, xPx, yPx)
  place(landmarks, leftIndex, 2 * 384 - xPx, yPx)
}

export function syntheticFace(): Point2[] {
  const landmarks: Point2[] = Array.from({ length: 478 }, () => ({
    x: 384 / FIXTURE_WIDTH,
    y: 560 / FIXTURE_HEIGHT,
  }))

  // Íris e olhos (contorno inferior/superior).
  placeMirror(landmarks, 468, 473, 280, 430)
  placeMirror(landmarks, 33, 263, 240, 430)
  placeMirror(landmarks, 133, 362, 320, 430)
  const lowerLidRight = [7, 163, 144, 145, 153, 154, 155]
  const lowerLidLeft = [249, 390, 373, 374, 380, 381, 382]
  const upperLidRight = [246, 161, 160, 159, 158, 157, 173]
  const upperLidLeft = [466, 388, 387, 386, 385, 384, 398]
  lowerLidRight.forEach((index, i) =>
    placeMirror(landmarks, index, lowerLidLeft[i], 250 + i * 11, 442),
  )
  upperLidRight.forEach((index, i) =>
    placeMirror(landmarks, index, upperLidLeft[i], 250 + i * 11, 418),
  )

  // Sobrancelhas.
  const browRight = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]
  const browLeft = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]
  browRight.forEach((index, i) => placeMirror(landmarks, index, browLeft[i], 230 + i * 10, 395))

  // Nariz.
  place(landmarks, 1, 384, 560)
  place(landmarks, 2, 384, 600)
  place(landmarks, 164, 384, 612)
  placeMirror(landmarks, 97, 326, 366, 598)
  placeMirror(landmarks, 98, 327, 350, 600)
  placeMirror(landmarks, 129, 358, 340, 580)
  placeMirror(landmarks, 49, 279, 330, 585)
  placeMirror(landmarks, 209, 429, 345, 595)

  // Lábio superior: contorno externo (61 → 291) e linha molhada.
  const upperOuterX = [300, 315, 335, 355, 370, 384, 398, 413, 433, 453, 468]
  const upperOuterY = [700, 690, 682, 676, 672, 676, 672, 676, 682, 690, 700]
  ;[61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291].forEach((index, i) =>
    place(landmarks, index, upperOuterX[i], upperOuterY[i]),
  )
  const innerX = [305, 320, 340, 355, 370, 384, 398, 413, 428, 448, 463]
  ;[78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308].forEach((index, i) =>
    place(landmarks, index, innerX[i], 699),
  )
  ;[95, 88, 178, 87, 14, 317, 402, 318, 324].forEach((index, i) =>
    place(landmarks, index, innerX[i + 1], 703),
  )
  // Lábio inferior: contorno externo.
  const lowerOuterX = [315, 335, 355, 370, 384, 398, 413, 433, 453]
  const lowerOuterY = [712, 722, 728, 732, 734, 732, 728, 722, 712]
  ;[146, 91, 181, 84, 17, 314, 405, 321, 375].forEach((index, i) =>
    place(landmarks, index, lowerOuterX[i], lowerOuterY[i]),
  )

  // Queixo e mandíbula.
  place(landmarks, 18, 384, 770)
  place(landmarks, 200, 384, 800)
  place(landmarks, 199, 384, 830)
  place(landmarks, 175, 384, 860)
  place(landmarks, 152, 384, 885)
  placeMirror(landmarks, 148, 377, 350, 880)
  placeMirror(landmarks, 176, 400, 320, 868)
  placeMirror(landmarks, 149, 378, 295, 850)
  placeMirror(landmarks, 150, 379, 275, 825)
  placeMirror(landmarks, 136, 365, 255, 795)
  placeMirror(landmarks, 172, 397, 240, 760)
  placeMirror(landmarks, 58, 288, 225, 720)
  placeMirror(landmarks, 132, 361, 212, 680)
  placeMirror(landmarks, 93, 323, 200, 630)
  placeMirror(landmarks, 234, 454, 190, 560)
  placeMirror(landmarks, 127, 356, 195, 500)
  placeMirror(landmarks, 162, 389, 210, 440)
  placeMirror(landmarks, 21, 251, 235, 380)
  placeMirror(landmarks, 54, 284, 265, 340)
  placeMirror(landmarks, 103, 332, 300, 320)
  placeMirror(landmarks, 67, 297, 335, 308)
  placeMirror(landmarks, 109, 338, 360, 302)
  place(landmarks, 10, 384, 300)
  place(landmarks, 151, 384, 350) // meio da testa

  // Bochechas / malar / infraorbital / sulco.
  placeMirror(landmarks, 50, 280, 290, 600)
  placeMirror(landmarks, 117, 346, 285, 520)
  placeMirror(landmarks, 118, 347, 300, 540)
  placeMirror(landmarks, 101, 330, 310, 560)
  placeMirror(landmarks, 205, 425, 300, 590)
  placeMirror(landmarks, 123, 352, 255, 560)
  placeMirror(landmarks, 187, 411, 285, 640)
  placeMirror(landmarks, 207, 427, 300, 660)
  placeMirror(landmarks, 216, 436, 320, 660)
  placeMirror(landmarks, 119, 348, 290, 500)
  placeMirror(landmarks, 100, 329, 305, 505)
  placeMirror(landmarks, 203, 423, 330, 630)
  placeMirror(landmarks, 206, 426, 335, 655)

  return landmarks
}

/** Labelmap a 1/4 da foto (192×256) com retângulos de classe. */
export function syntheticMap(): LabelMap {
  const width = FIXTURE_WIDTH / 4
  const height = FIXTURE_HEIGHT / 4
  const labels = new Uint8Array(width * height)
  const fill = (x0: number, y0: number, x1: number, y1: number, classId: number) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) labels[y * width + x] = classId
  }
  fill(50, 75, 143, 222, FACE_CLASSES.skin) // oval do rosto (px 200..572 × 300..888)
  fill(60, 104, 82, 112, FACE_CLASSES.l_eye) // olho imagem-esquerda
  fill(110, 104, 132, 112, FACE_CLASSES.r_eye)
  fill(84, 130, 108, 152, FACE_CLASSES.nose)
  fill(75, 168, 117, 175, FACE_CLASSES.u_lip) // px 300..468 × 672..700
  fill(75, 175, 117, 184, FACE_CLASSES.l_lip) // px 700..734
  fill(45, 40, 148, 75, FACE_CLASSES.hair)
  return { labels, width, height }
}
