/** Ponto normalizado 0..1 no espaço da foto. */
export interface Point2 {
  x: number
  y: number
}

/** Um landmark do FaceLandmarker, normalizado 0..1 mais profundidade relativa. */
export interface Landmark extends Point2 {
  z: number
}

/** Ângulo da cabeça em graus, extraído da matriz de transformação facial. */
export interface HeadPose {
  yaw: number
  pitch: number
  roll: number
}

/**
 * Resultado congelado da detecção. Calculado uma vez, guardado em `useRef` e
 * nunca recalculado durante a interação (D-06).
 */
export interface FaceGeometry {
  /** 478 landmarks normalizados. */
  landmarks: Landmark[]
  pose: HeadPose
  /** Distância interpupilar em pixels da foto. Base de toda escala (D-04). */
  ipdPx: number
  /** Dimensões da foto processada, em pixels. */
  width: number
  height: number
}
