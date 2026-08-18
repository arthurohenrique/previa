/**
 * Identificador único, em qualquer contexto.
 *
 * `crypto.randomUUID` só existe em **contexto seguro** — HTTPS ou localhost.
 * Testar o produto num celular apontando para o computador da clínica
 * (`http://192.168.x.x:3000`) não é contexto seguro, e ali `randomUUID` é
 * `undefined`: cada foto e cada aplicação morriam num `TypeError` engolido pelo
 * `catch`, com a tela dizendo apenas que não deu para preparar a foto.
 *
 * O formato continua sendo UUID v4 — o Postgres tem coluna `uuid` do outro lado
 * e não aceita outra coisa. Só a fonte de aleatoriedade muda:
 * `crypto.getRandomValues` existe também em contexto inseguro; `Math.random` é
 * o último recurso, e vale porque estes ids identificam linhas locais, não
 * segredos.
 */
export function newId(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined

  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  // Versão 4 e variante RFC 4122, como manda o formato.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80

  const hex: string[] = []
  for (const byte of bytes) hex.push(byte.toString(16).padStart(2, '0'))

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
