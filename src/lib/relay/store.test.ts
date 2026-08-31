import { describe, expect, it } from 'vitest'
import { MemoryRelayStore, RELAY_MAX_BYTES, RELAY_TTL_MS } from './store'

describe('MemoryRelayStore', () => {
  it('entrega uma única vez e apaga', async () => {
    const store = new MemoryRelayStore()
    const data = new Uint8Array([1, 2, 3])
    expect(await store.put('canal-1234567890', data)).toBe('ok')
    expect(await store.take('canal-1234567890')).toEqual(data)
    expect(await store.take('canal-1234567890')).toBeNull()
  })

  it('não sobrescreve um canal já ocupado', async () => {
    const store = new MemoryRelayStore()
    await store.put('canal-1234567890', new Uint8Array([1]))
    expect(await store.put('canal-1234567890', new Uint8Array([2]))).toBe('exists')
    expect(await store.take('canal-1234567890')).toEqual(new Uint8Array([1]))
  })

  it('expira pelo TTL', async () => {
    let clock = 0
    const store = new MemoryRelayStore(() => clock)
    await store.put('canal-1234567890', new Uint8Array([1]))
    clock = RELAY_TTL_MS - 1
    expect(await store.take('canal-1234567890')).toEqual(new Uint8Array([1]))
    await store.put('canal-1234567890', new Uint8Array([2]))
    clock = RELAY_TTL_MS * 2
    expect(await store.take('canal-1234567890')).toBeNull()
  })

  it('recusa payload acima do limite', async () => {
    const store = new MemoryRelayStore()
    expect(await store.put('canal-1234567890', new Uint8Array(RELAY_MAX_BYTES + 1))).toBe(
      'too-large',
    )
    expect(await store.take('canal-1234567890')).toBeNull()
  })

  it('sob abuso descarta o canal mais antigo, não o novo', async () => {
    let clock = 0
    const store = new MemoryRelayStore(() => clock)
    for (let i = 0; i < 50; i++) await store.put(`canal-${String(i).padStart(10, '0')}`, new Uint8Array([i]))
    await store.put('canal-novo000000', new Uint8Array([99]))
    expect(await store.take('canal-0000000000')).toBeNull()
    expect(await store.take('canal-novo000000')).toEqual(new Uint8Array([99]))
  })
})
