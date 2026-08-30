/**
 * Moving Least Squares com transformação de similaridade (Schaefer, McPhail
 * & Warren, 2006) — o interpolador do motor de warp.
 *
 * Dado um conjunto de pontos de controle p_i → q_i, cada pixel v recebe a
 * similaridade (rotação + escala uniforme + translação) que melhor ajusta os
 * controles ponderados por w_i = 1/|p_i − v|^{2α}. Propriedades que importam:
 *
 *  - interpola exatamente: f(p_i) = q_i (pinos ficam parados);
 *  - é suave (C∞ fora dos controles) — sem facetas de malha;
 *  - é LINEAR nos destinos q_i. Com q_i(t) = p_i + t·δ_i vale
 *    f(v; t) − v = t · (f(v; 1) − v): o campo na intensidade 1 é calculado
 *    uma vez e o slider só o multiplica. (A variante rígida não tem isso.)
 */

import type { Point2 } from '@/lib/quality'

export interface ControlPoint {
  /** Posição original, em px da foto. */
  p: Point2
  /** Destino, em px da foto. */
  q: Point2
}

/** Abaixo desta distância (px) o pixel "é" o controle e recebe q_i direto. */
const COINCIDENCE_EPSILON = 1e-6

/**
 * Expoente padrão dos pesos: maior = influência mais local, mas transição
 * mais abrupta entre mover e pino (strain alto). 1 é o valor do artigo.
 */
export const MLS_DEFAULT_ALPHA = 1

interface PreparedControls {
  count: number
  px: Float64Array
  py: Float64Array
  qx: Float64Array
  qy: Float64Array
  /** Rascunho dos pesos, reutilizado entre pixels. */
  weights: Float64Array
}

function prepare(controls: readonly ControlPoint[]): PreparedControls {
  const count = controls.length
  const px = new Float64Array(count)
  const py = new Float64Array(count)
  const qx = new Float64Array(count)
  const qy = new Float64Array(count)
  for (let i = 0; i < count; i++) {
    px[i] = controls[i].p.x
    py[i] = controls[i].p.y
    qx[i] = controls[i].q.x
    qy[i] = controls[i].q.y
  }
  return { count, px, py, qx, qy, weights: new Float64Array(count) }
}

/** Avalia f(v) e escreve em `out` (evita alocar por pixel). */
function evaluate(
  prepared: PreparedControls,
  vx: number,
  vy: number,
  alpha: number,
  out: Point2,
): void {
  const { count, px, py, qx, qy, weights } = prepared

  let weightSum = 0
  let pStarX = 0
  let pStarY = 0
  let qStarX = 0
  let qStarY = 0
  for (let i = 0; i < count; i++) {
    const dx = px[i] - vx
    const dy = py[i] - vy
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared < COINCIDENCE_EPSILON * COINCIDENCE_EPSILON) {
      out.x = qx[i]
      out.y = qy[i]
      return
    }
    const weight = Math.pow(distanceSquared, -alpha)
    weights[i] = weight
    weightSum += weight
    pStarX += weight * px[i]
    pStarY += weight * py[i]
    qStarX += weight * qx[i]
    qStarY += weight * qy[i]
  }
  pStarX /= weightSum
  pStarY /= weightSum
  qStarX /= weightSum
  qStarY /= weightSum

  // Σ w_i |p̂_i|² e Σ q̂_i · A_i, com A_i = w_i [p̂; −p̂⊥] [d; −d⊥]ᵀ.
  const dX = vx - pStarX
  const dY = vy - pStarY
  let mu = 0
  let fx = 0
  let fy = 0
  for (let i = 0; i < count; i++) {
    const weight = weights[i]
    const phx = px[i] - pStarX
    const phy = py[i] - pStarY
    const qhx = qx[i] - qStarX
    const qhy = qy[i] - qStarY
    mu += weight * (phx * phx + phy * phy)
    const a00 = phx * dX + phy * dY
    const a01 = phx * dY - phy * dX
    const a10 = phy * dX - phx * dY
    const a11 = phy * dY + phx * dX
    fx += weight * (qhx * a00 + qhy * a10)
    fy += weight * (qhx * a01 + qhy * a11)
  }

  if (mu < 1e-12) {
    // Todos os controles coincidem: só há translação definida.
    out.x = vx + (qStarX - pStarX)
    out.y = vy + (qStarY - pStarY)
    return
  }
  out.x = fx / mu + qStarX
  out.y = fy / mu + qStarY
}

/** f(v) para um único ponto (uso em testes e depuração). */
export function mlsSimilarity(
  v: Point2,
  controls: readonly ControlPoint[],
  alpha: number = MLS_DEFAULT_ALPHA,
): Point2 {
  if (controls.length === 0) return { x: v.x, y: v.y }
  const out = { x: 0, y: 0 }
  evaluate(prepare(controls), v.x, v.y, alpha, out)
  return out
}

/**
 * Rasteriza o campo de deslocamento f(v) − v numa grade fieldWidth ×
 * fieldHeight que cobre a foto inteira. `out` recebe [dx, dy, …] em unidades
 * NORMALIZADAS (fração da largura / altura da foto), para o mesmo campo servir
 * à prévia na tela e à exportação em alta resolução.
 */
export function rasterizeMls(
  controls: readonly ControlPoint[],
  fieldWidth: number,
  fieldHeight: number,
  photoWidth: number,
  photoHeight: number,
  alpha: number,
  out: Float32Array,
): void {
  if (out.length < fieldWidth * fieldHeight * 2) {
    throw new Error('Buffer do campo menor que fieldWidth × fieldHeight × 2.')
  }
  if (controls.length === 0) {
    out.fill(0)
    return
  }
  const prepared = prepare(controls)
  const result = { x: 0, y: 0 }
  const cellWidth = photoWidth / fieldWidth
  const cellHeight = photoHeight / fieldHeight
  for (let j = 0; j < fieldHeight; j++) {
    const vy = (j + 0.5) * cellHeight
    for (let i = 0; i < fieldWidth; i++) {
      const vx = (i + 0.5) * cellWidth
      evaluate(prepared, vx, vy, alpha, result)
      const offset = (j * fieldWidth + i) * 2
      out[offset] = (result.x - vx) / photoWidth
      out[offset + 1] = (result.y - vy) / photoHeight
    }
  }
}
