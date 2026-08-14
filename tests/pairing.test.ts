import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE,
  MAX_PHOTO_BYTES,
  PhotoAssembler,
  parseControlMessage,
  splitIntoChunks,
  validateMeta,
  type PhotoMeta,
} from '@/lib/pairing/protocol'

function meta(overrides: Partial<PhotoMeta> = {}): PhotoMeta {
  return {
    kind: 'photo-meta',
    size: 1024,
    mime: 'image/jpeg',
    width: 1536,
    height: 2048,
    ...overrides,
  }
}

function bytes(length: number): ArrayBuffer {
  return new Uint8Array(length).buffer
}

describe('fatiamento', () => {
  it('cobre o buffer inteiro sem sobra nem falta', () => {
    const chunks = splitIntoChunks(bytes(CHUNK_SIZE * 3 + 17))
    expect(chunks).toHaveLength(4)
    expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(CHUNK_SIZE * 3 + 17)
    expect(chunks.at(-1)?.byteLength).toBe(17)
  })

  it('devolve um pedaço só quando cabe', () => {
    expect(splitIntoChunks(bytes(10))).toHaveLength(1)
  })

  it('devolve nada para buffer vazio', () => {
    expect(splitIntoChunks(bytes(0))).toHaveLength(0)
  })
})

describe('cabeçalho', () => {
  it('aceita um cabeçalho válido', () => {
    expect(validateMeta(meta())).toBeNull()
  })

  it('recusa foto acima do teto', () => {
    // Sem teto, uma sequência infinita de pedaços derruba a aba por memória — e
    // do outro lado do canal pode não estar o celular do profissional.
    expect(validateMeta(meta({ size: MAX_PHOTO_BYTES + 1 }))).toContain('excede')
  })

  it('recusa tamanho inválido', () => {
    expect(validateMeta(meta({ size: 0 }))).not.toBeNull()
    expect(validateMeta(meta({ size: Number.NaN }))).not.toBeNull()
  })

  it('recusa formato que não é imagem', () => {
    expect(validateMeta(meta({ mime: 'application/pdf' }))).not.toBeNull()
    expect(validateMeta(meta({ mime: 'text/html' }))).not.toBeNull()
  })

  it('recusa dimensão inválida', () => {
    expect(validateMeta(meta({ width: 0 }))).not.toBeNull()
    expect(validateMeta(meta({ height: 12.5 }))).not.toBeNull()
  })
})

describe('mensagens de controle', () => {
  it('lê as duas mensagens do protocolo', () => {
    expect(parseControlMessage(JSON.stringify(meta()))?.kind).toBe('photo-meta')
    expect(parseControlMessage('{"kind":"photo-end"}')?.kind).toBe('photo-end')
  })

  it('ignora lixo em vez de explodir', () => {
    expect(parseControlMessage('não é json')).toBeNull()
    expect(parseControlMessage('{"kind":"outra-coisa"}')).toBeNull()
    expect(parseControlMessage('[]')).toBeNull()
  })
})

describe('montagem da foto', () => {
  it('junta os pedaços na ordem e devolve o blob', async () => {
    const assembler = new PhotoAssembler(meta({ size: 6 }))
    expect(assembler.push(new Uint8Array([1, 2, 3]).buffer)).toBeNull()
    expect(assembler.progress).toBeCloseTo(0.5, 10)
    expect(assembler.push(new Uint8Array([4, 5, 6]).buffer)).toBeNull()
    expect(assembler.complete).toBe(true)

    const result = assembler.finish()
    expect('error' in result).toBe(false)
    if ('error' in result) return

    expect(result.blob.type).toBe('image/jpeg')
    expect([...new Uint8Array(await result.blob.arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6])
    expect(result.width).toBe(1536)
  })

  it('recusa pedaço que passa do tamanho anunciado', () => {
    const assembler = new PhotoAssembler(meta({ size: 4 }))
    expect(assembler.push(bytes(4))).toBeNull()
    expect(assembler.push(bytes(1))).toContain('excedeu')
  })

  it('recusa terminar incompleta', () => {
    const assembler = new PhotoAssembler(meta({ size: 10 }))
    assembler.push(bytes(4))
    const result = assembler.finish()
    expect('error' in result && result.error).toContain('incompleta')
  })
})
