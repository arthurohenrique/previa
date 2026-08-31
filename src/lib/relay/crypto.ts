/**
 * Criptografia do relay QR → computador (emenda à restrição nº 1).
 *
 * A chave AES-GCM vive SOMENTE no fragmento da URL do QR (`#id.chave`) — o
 * fragmento nunca é enviado em requisições HTTP, então o servidor só vê
 * bytes cifrados. O celular cifra a foto já sem EXIF; o computador decifra
 * com a chave que ele mesmo gerou ao montar o QR.
 */

/** Canal: id público (rota) + chave secreta (só no fragmento). */
export interface RelayChannel {
  id: string
  keyBase64: string
}

const ID_BYTES = 16
const IV_BYTES = 12

export const RELAY_ID_PATTERN = /^[A-Za-z0-9_-]{10,64}$/

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Novo canal: id aleatório + chave AES-GCM 256 exportada. */
export async function createChannel(): Promise<RelayChannel> {
  const id = toBase64Url(crypto.getRandomValues(new Uint8Array(ID_BYTES)))
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  return { id, keyBase64: toBase64Url(raw) }
}

/** Fragmento da URL do QR ("id.chave") e o parse no celular. */
export function channelFragment(channel: RelayChannel): string {
  return `${channel.id}.${channel.keyBase64}`
}

export function parseChannelFragment(fragment: string): RelayChannel | null {
  const clean = fragment.startsWith('#') ? fragment.slice(1) : fragment
  const dot = clean.indexOf('.')
  if (dot <= 0) return null
  const id = clean.slice(0, dot)
  const keyBase64 = clean.slice(dot + 1)
  if (!RELAY_ID_PATTERN.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(keyBase64)) return null
  return { id, keyBase64 }
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64Url(keyBase64)
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/** Cifra: IV (12 bytes) prefixado ao ciphertext. */
export async function encryptPayload(data: Uint8Array, keyBase64: string): Promise<Uint8Array> {
  const key = await importKey(keyBase64)
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as BufferSource),
  )
  const output = new Uint8Array(IV_BYTES + ciphertext.length)
  output.set(iv, 0)
  output.set(ciphertext, IV_BYTES)
  return output
}

/** Decifra o formato IV || ciphertext; lança se a chave não bater. */
export async function decryptPayload(payload: Uint8Array, keyBase64: string): Promise<Uint8Array> {
  if (payload.length <= IV_BYTES) throw new Error('Payload cifrado truncado.')
  const key = await importKey(keyBase64)
  const iv = payload.slice(0, IV_BYTES)
  const ciphertext = payload.slice(IV_BYTES)
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    ),
  )
}
