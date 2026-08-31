import { describe, expect, it } from 'vitest'
import {
  channelFragment,
  createChannel,
  decryptPayload,
  encryptPayload,
  parseChannelFragment,
  RELAY_ID_PATTERN,
} from './crypto'

describe('createChannel / fragmento', () => {
  it('gera id válido para a rota e chave de 256 bits; fragmento faz ida e volta', async () => {
    const channel = await createChannel()
    expect(channel.id).toMatch(RELAY_ID_PATTERN)
    expect(channel.keyBase64).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const parsed = parseChannelFragment(`#${channelFragment(channel)}`)
    expect(parsed).toEqual(channel)
  })

  it('canais são independentes (id e chave nunca repetem)', async () => {
    const a = await createChannel()
    const b = await createChannel()
    expect(a.id).not.toBe(b.id)
    expect(a.keyBase64).not.toBe(b.keyBase64)
  })

  it('fragmentos malformados são rejeitados', () => {
    expect(parseChannelFragment('')).toBeNull()
    expect(parseChannelFragment('#semponto')).toBeNull()
    expect(parseChannelFragment('#curto.abc')).toBeNull()
    expect(parseChannelFragment('#id!invalido.' + 'a'.repeat(43))).toBeNull()
  })
})

describe('encrypt/decrypt', () => {
  it('ida e volta preserva os bytes; IVs diferentes a cada cifra', async () => {
    const channel = await createChannel()
    const data = crypto.getRandomValues(new Uint8Array(4096))
    const first = await encryptPayload(data, channel.keyBase64)
    const second = await encryptPayload(data, channel.keyBase64)
    expect(first.slice(0, 12)).not.toEqual(second.slice(0, 12))
    expect(await decryptPayload(first, channel.keyBase64)).toEqual(data)
    expect(await decryptPayload(second, channel.keyBase64)).toEqual(data)
  })

  it('chave errada ou payload adulterado não decifram', async () => {
    const a = await createChannel()
    const b = await createChannel()
    const payload = await encryptPayload(new Uint8Array([1, 2, 3]), a.keyBase64)
    await expect(decryptPayload(payload, b.keyBase64)).rejects.toThrow()
    const tampered = payload.slice()
    tampered[tampered.length - 1] ^= 0xff
    await expect(decryptPayload(tampered, a.keyBase64)).rejects.toThrow()
    await expect(decryptPayload(new Uint8Array(4), a.keyBase64)).rejects.toThrow()
  })
})
