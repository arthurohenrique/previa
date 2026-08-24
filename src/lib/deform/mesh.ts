/**
 * Malha triangular regular sobre a foto — base do motor de deformação.
 * Funções puras; o Pixi só consome os buffers.
 */

import type { ExecutionProfile } from '@/lib/profile'

/** Colunas da grade por perfil de execução (densa / média / esparsa). */
export const MESH_COLUMNS: Record<ExecutionProfile, number> = {
  alto: 64,
  medio: 44,
  baixo: 28,
}

export interface DeformMesh {
  /** Posições base em px da foto, intercaladas [x0, y0, x1, y1, …]. */
  vertices: Float32Array
  /** UVs normalizados correspondentes. */
  uvs: Float32Array
  /** Triângulos (2 por célula). */
  indices: Uint32Array
  columns: number
  rows: number
  width: number
  height: number
}

/**
 * Grade (columns × rows) proporcional à foto: célula aproximadamente
 * quadrada, dois triângulos por célula, UV 1:1 com a posição.
 */
export function buildGridMesh(
  width: number,
  height: number,
  columns: number,
): DeformMesh {
  const rows = Math.max(2, Math.round(columns * (height / width)))
  const vertexCount = (columns + 1) * (rows + 1)
  const vertices = new Float32Array(vertexCount * 2)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(columns * rows * 6)

  let v = 0
  for (let row = 0; row <= rows; row++) {
    for (let col = 0; col <= columns; col++) {
      const u = col / columns
      const t = row / rows
      vertices[v] = u * width
      uvs[v] = u
      v++
      vertices[v] = t * height
      uvs[v] = t
      v++
    }
  }

  let i = 0
  const stride = columns + 1
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const a = row * stride + col
      const b = a + 1
      const c = a + stride
      const d = c + 1
      indices[i++] = a
      indices[i++] = c
      indices[i++] = b
      indices[i++] = b
      indices[i++] = c
      indices[i++] = d
    }
  }

  return { vertices, uvs, indices, columns, rows, width, height }
}

/** true se o vértice está na borda da grade (fica sempre fixo). */
export function isBorderVertex(mesh: DeformMesh, vertexIndex: number): boolean {
  const stride = mesh.columns + 1
  const col = vertexIndex % stride
  const row = Math.floor(vertexIndex / stride)
  return col === 0 || col === mesh.columns || row === 0 || row === mesh.rows
}
