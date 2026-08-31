import { describe, expect, it } from 'vitest'
import { BlobRelayStore } from './store'

// Integração real contra o store da Vercel (token via env). Roda uma vez
// para validar put/take/uso único; não faz parte da suíte permanente.
describe.skipIf(!process.env.BLOB_READ_WRITE_TOKEN)('BlobRelayStore (integração)', () => {
  it('put → take entrega uma única vez e apaga', async () => {
    const store = new BlobRelayStore()
    const id = 'teste-' + Date.now().toString(36) + '-abcdef'
    const data = new Uint8Array(256 * 1024)
    for (let offset = 0; offset < data.length; offset += 65536) {
      crypto.getRandomValues(data.subarray(offset, offset + 65536))
    }
    expect(await store.put(id, data)).toBe('ok')
    const taken = await store.take(id)
    expect(taken).not.toBeNull()
    expect(Buffer.from(taken!).equals(Buffer.from(data))).toBe(true)
    expect(await store.take(id)).toBeNull()
  }, 60000)
})
