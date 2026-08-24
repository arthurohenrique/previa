import { describe, expect, it } from 'vitest'
import { buildGridMesh, isBorderVertex } from './mesh'

describe('buildGridMesh', () => {
  const mesh = buildGridMesh(1000, 500, 10)

  it('linhas proporcionais ao aspecto (célula ~quadrada)', () => {
    expect(mesh.rows).toBe(5)
  })

  it('tamanhos de buffer corretos', () => {
    const vertexCount = 11 * 6
    expect(mesh.vertices).toHaveLength(vertexCount * 2)
    expect(mesh.uvs).toHaveLength(vertexCount * 2)
    expect(mesh.indices).toHaveLength(10 * 5 * 6)
  })

  it('cantos batem com a foto e UVs ficam em [0,1]', () => {
    expect(mesh.vertices[0]).toBe(0)
    expect(mesh.vertices[1]).toBe(0)
    const last = mesh.vertices.length
    expect(mesh.vertices[last - 2]).toBe(1000)
    expect(mesh.vertices[last - 1]).toBe(500)
    for (let i = 0; i < mesh.uvs.length; i++) {
      expect(mesh.uvs[i]).toBeGreaterThanOrEqual(0)
      expect(mesh.uvs[i]).toBeLessThanOrEqual(1)
    }
  })

  it('índices referenciam vértices existentes', () => {
    const vertexCount = mesh.vertices.length / 2
    for (const index of mesh.indices) {
      expect(index).toBeLessThan(vertexCount)
    }
  })

  it('foto muito alta ainda gera pelo menos 2 linhas', () => {
    expect(buildGridMesh(1000, 10, 10).rows).toBe(2)
  })
})

describe('isBorderVertex', () => {
  const mesh = buildGridMesh(100, 100, 4)
  it('cantos e arestas são borda; centro não', () => {
    expect(isBorderVertex(mesh, 0)).toBe(true) // canto sup. esq.
    expect(isBorderVertex(mesh, 4)).toBe(true) // canto sup. dir.
    expect(isBorderVertex(mesh, 24)).toBe(true) // canto inf. dir.
    expect(isBorderVertex(mesh, 12)).toBe(false) // centro (linha 2, col 2)
  })
})
