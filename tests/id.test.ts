import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from '@/lib/id'

/**
 * O identificador precisa funcionar em contexto inseguro.
 *
 * `crypto.randomUUID` só existe em HTTPS ou localhost. Testar o produto num
 * celular apontando para o computador da clínica — `http://192.168.x.x:3000` —
 * não é contexto seguro: ali `randomUUID` é `undefined`, e cada foto e cada
 * aplicação morriam num `TypeError` que a interface reportava como "não foi
 * possível preparar a foto". Este arquivo é a rede de segurança dessa lição.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newId', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('devolve UUID v4 no caminho normal', () => {
    expect(newId()).toMatch(UUID_V4)
  })

  it('devolve UUID v4 sem randomUUID, só com getRandomValues', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => {
        for (let index = 0; index < array.length; index += 1) array[index] = index * 7
        return array
      },
    })

    expect(newId()).toMatch(UUID_V4)
  })

  it('devolve UUID v4 mesmo sem crypto nenhum', () => {
    vi.stubGlobal('crypto', undefined)

    expect(newId()).toMatch(UUID_V4)
  })

  it('não repete', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()))
    expect(ids.size).toBe(500)
  })
})
