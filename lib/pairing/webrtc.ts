'use client'

import {
  CHUNK_SIZE,
  PhotoAssembler,
  parseControlMessage,
  splitIntoChunks,
  validateMeta,
  type PhotoMeta,
} from './protocol'

/**
 * Ponte direta entre o celular e o computador.
 *
 * A foto vai de um aparelho ao outro por `RTCDataChannel`, cifrada por DTLS. O
 * servidor troca só as descrições de sessão (SDP) e não vê byte de imagem
 * nenhum — é o que mantém a seção 9 da especificação de pé: nenhuma rota de API
 * recebe imagem.
 *
 * **Sem STUN e sem TURN, de propósito.** `iceServers: []` deixa só candidatos de
 * host, então a ponte só fecha se os dois aparelhos estiverem na mesma rede — o
 * caso real da clínica. Um TURN relayaria os bytes por um terceiro; um STUN
 * público entregaria os endereços da clínica a alguém de fora. Preferimos falhar
 * na cara, com mensagem que diz o que fazer, a funcionar por um caminho que a
 * regra de ouro não autoriza.
 */

const CHANNEL_LABEL = 'previa-photo'
const ICE_GATHER_TIMEOUT_MS = 4000
const CONNECT_TIMEOUT_MS = 25_000
const BUFFER_HIGH_WATER = 1024 * 1024

function newConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: [], iceTransportPolicy: 'all' })
}

/**
 * Espera a coleta de candidatos terminar e devolve o SDP completo.
 *
 * Sem trickle: o pareamento troca duas mensagens e acabou. Trickle exigiria um
 * canal de sinalização vivo dos dois lados durante a negociação, e economizaria
 * um segundo num fluxo em que o profissional está andando até o paciente.
 */
async function gatheredDescription(pc: RTCPeerConnection): Promise<string> {
  if (pc.iceGatheringState === 'complete') {
    return JSON.stringify(pc.localDescription)
  }

  await new Promise<void>((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', onChange)
      clearTimeout(timer)
      resolve()
    }
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done()
    }
    // O tempo limite não é desistência: com candidatos de host já coletados, o
    // que falta é o navegador concluir uma varredura que aqui não leva a nada.
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS)
    pc.addEventListener('icegatheringstatechange', onChange)
  })

  return JSON.stringify(pc.localDescription)
}

function parseDescription(raw: string): RTCSessionDescriptionInit {
  const parsed: unknown = JSON.parse(raw)
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { sdp?: unknown }).sdp !== 'string'
  ) {
    throw new Error('Descrição de sessão inválida.')
  }
  return parsed as RTCSessionDescriptionInit
}

export type ReceiverEvent =
  | { kind: 'waiting' }
  | { kind: 'connected' }
  | { kind: 'progress'; ratio: number }
  | { kind: 'photo'; blob: Blob; width: number; height: number }
  | { kind: 'error'; message: string }

export interface Receiver {
  /** SDP da oferta, para ir no QR — indiretamente, via pareamento. */
  offer: string
  acceptAnswer: (answer: string) => Promise<void>
  close: () => void
}

/** Lado do computador: cria o canal, recebe a foto. */
export async function createReceiver(
  onEvent: (event: ReceiverEvent) => void,
): Promise<Receiver> {
  const pc = newConnection()
  const channel = pc.createDataChannel(CHANNEL_LABEL, { ordered: true })
  channel.binaryType = 'arraybuffer'

  let assembler: PhotoAssembler | null = null
  let finished = false

  const fail = (message: string) => {
    if (finished) return
    finished = true
    onEvent({ kind: 'error', message })
  }

  const timeout = setTimeout(() => {
    if (channel.readyState !== 'open') {
      fail('O celular não conseguiu se conectar. Confirme que os dois estão na mesma rede.')
    }
  }, CONNECT_TIMEOUT_MS)

  channel.addEventListener('open', () => {
    clearTimeout(timeout)
    onEvent({ kind: 'connected' })
  })

  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (finished) return

    if (typeof event.data === 'string') {
      const message = parseControlMessage(event.data)
      if (!message) return fail('Mensagem inesperada do celular.')

      if (message.kind === 'photo-meta') {
        const problem = validateMeta(message)
        if (problem) return fail(problem)
        assembler = new PhotoAssembler(message)
        onEvent({ kind: 'progress', ratio: 0 })
        return
      }

      if (!assembler) return fail('A transferência terminou sem ter começado.')
      const result = assembler.finish()
      if ('error' in result) return fail(result.error)

      finished = true
      clearTimeout(timeout)
      onEvent({ kind: 'photo', ...result })
      return
    }

    if (event.data instanceof ArrayBuffer) {
      if (!assembler) return fail('Chegaram dados sem cabeçalho.')
      const problem = assembler.push(event.data)
      if (problem) return fail(problem)
      onEvent({ kind: 'progress', ratio: assembler.progress })
    }
  })

  channel.addEventListener('error', () => {
    fail('A ligação com o celular caiu. Tente de novo.')
  })

  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'failed') {
      fail('Não foi possível conectar ao celular. Confirme que os dois estão na mesma rede.')
    }
  })

  await pc.setLocalDescription(await pc.createOffer())
  const offer = await gatheredDescription(pc)
  onEvent({ kind: 'waiting' })

  return {
    offer,
    async acceptAnswer(answer) {
      await pc.setRemoteDescription(parseDescription(answer))
    },
    close() {
      finished = true
      clearTimeout(timeout)
      channel.close()
      pc.close()
    },
  }
}

export type SenderEvent =
  | { kind: 'connected' }
  | { kind: 'progress'; ratio: number }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

export interface Sender {
  /** SDP da resposta, que volta ao computador pela sinalização. */
  answer: string
  sendPhoto: (blob: Blob, width: number, height: number) => Promise<void>
  close: () => void
}

/** Lado do celular: responde à oferta e envia a foto. */
export async function createSender(
  offer: string,
  onEvent: (event: SenderEvent) => void,
): Promise<Sender> {
  const pc = newConnection()

  let channel: RTCDataChannel | null = null
  const ready = new Promise<RTCDataChannel>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            'Não foi possível conectar ao computador. Confirme que os dois estão na mesma rede.',
          ),
        ),
      CONNECT_TIMEOUT_MS,
    )

    pc.addEventListener('datachannel', (event) => {
      const incoming = event.channel
      incoming.binaryType = 'arraybuffer'
      channel = incoming

      if (incoming.readyState === 'open') {
        clearTimeout(timer)
        onEvent({ kind: 'connected' })
        resolve(incoming)
        return
      }

      incoming.addEventListener('open', () => {
        clearTimeout(timer)
        onEvent({ kind: 'connected' })
        resolve(incoming)
      })
    })
  })

  await pc.setRemoteDescription(parseDescription(offer))
  await pc.setLocalDescription(await pc.createAnswer())
  const answer = await gatheredDescription(pc)

  return {
    answer,

    async sendPhoto(blob, width, height) {
      const open = await ready
      const buffer = await blob.arrayBuffer()

      const meta: PhotoMeta = {
        kind: 'photo-meta',
        size: buffer.byteLength,
        mime: blob.type || 'image/jpeg',
        width,
        height,
      }
      open.send(JSON.stringify(meta))

      const chunks = splitIntoChunks(buffer, CHUNK_SIZE)
      open.bufferedAmountLowThreshold = BUFFER_HIGH_WATER / 2

      for (const [index, chunk] of chunks.entries()) {
        // Contrapressão: sem isto, uma foto de vários megabytes enfileira tudo
        // de uma vez e o Safari fecha o canal por estouro de buffer.
        if (open.bufferedAmount > BUFFER_HIGH_WATER) {
          await new Promise<void>((resolve) => {
            open.addEventListener('bufferedamountlow', () => resolve(), { once: true })
          })
        }
        open.send(chunk)
        onEvent({ kind: 'progress', ratio: (index + 1) / chunks.length })
      }

      open.send(JSON.stringify({ kind: 'photo-end' }))
      onEvent({ kind: 'sent' })
    },

    close() {
      channel?.close()
      pc.close()
    },
  }
}
