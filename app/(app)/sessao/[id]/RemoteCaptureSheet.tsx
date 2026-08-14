'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { QrCode } from '@/components/QrCode'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { createReceiver, type Receiver } from '@/lib/pairing/webrtc'
import { closePairing, openPairing, pollPairing } from './pairing-actions'

interface RemoteCaptureSheetProps {
  open: boolean
  sessionId: string
  patientId: string
  onClose: () => void
  onPhoto: (photo: { blob: Blob; width: number; height: number }) => void
}

type Phase =
  | { name: 'preparing' }
  | { name: 'waiting'; url: string }
  | { name: 'connecting' }
  | { name: 'receiving'; ratio: number }
  | { name: 'error'; message: string }

const POLL_INTERVAL_MS = 900

/**
 * Captura pelo celular.
 *
 * O computador do consultório costuma ter webcam ruim ou nenhuma, e ninguém
 * fotografa um rosto de perto com a câmera de um monitor. O QR entrega o
 * pareamento ao celular; a foto volta pelo canal de dados do WebRTC, direto de
 * um aparelho ao outro, e o servidor não vê byte de imagem nenhum.
 */
export function RemoteCaptureSheet({
  open,
  sessionId,
  patientId,
  onClose,
  onPhoto,
}: RemoteCaptureSheetProps) {
  const [phase, setPhase] = useState<Phase>({ name: 'preparing' })
  const receiverRef = useRef<Receiver | null>(null)
  const pairIdRef = useRef<string | null>(null)
  // O efeito que monta a ponte não pode depender de `onPhoto`: remontar a
  // conexão a cada render do pai derrubaria o pareamento no meio.
  const onPhotoRef = useRef(onPhoto)
  useEffect(() => {
    onPhotoRef.current = onPhoto
  }, [onPhoto])

  const teardown = useCallback(() => {
    receiverRef.current?.close()
    receiverRef.current = null

    const pairId = pairIdRef.current
    pairIdRef.current = null
    if (pairId) void closePairing(pairId)
  }, [])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    let poller: ReturnType<typeof setInterval> | null = null

    const stopPolling = () => {
      if (poller) clearInterval(poller)
      poller = null
    }

    void (async () => {
      try {
        const receiver = await createReceiver((event) => {
          if (cancelled) return

          switch (event.kind) {
            case 'connected':
              stopPolling()
              setPhase({ name: 'receiving', ratio: 0 })
              break
            case 'progress':
              setPhase({ name: 'receiving', ratio: event.ratio })
              break
            case 'photo':
              stopPolling()
              onPhotoRef.current({
                blob: event.blob,
                width: event.width,
                height: event.height,
              })
              break
            case 'error':
              stopPolling()
              setPhase({ name: 'error', message: event.message })
              break
            default:
              break
          }
        })

        if (cancelled) {
          receiver.close()
          return
        }
        receiverRef.current = receiver

        const opened = await openPairing({
          session_id: sessionId,
          patient_id: patientId,
          offer: receiver.offer,
        })

        if (cancelled) return
        if (!opened.ok) {
          setPhase({ name: 'error', message: opened.message })
          return
        }

        pairIdRef.current = opened.id
        setPhase({ name: 'waiting', url: `${window.location.origin}/captura/${opened.id}` })

        poller = setInterval(() => {
          void (async () => {
            const pairId = pairIdRef.current
            if (!pairId) return

            const status = await pollPairing(pairId)
            if (cancelled) return

            if (status.state === 'gone') {
              stopPolling()
              setPhase({
                name: 'error',
                message: 'O QR expirou. Gere um novo para tentar de novo.',
              })
              return
            }

            if (status.state === 'claimed') {
              setPhase((current) =>
                current.name === 'waiting' ? { name: 'connecting' } : current,
              )
              return
            }

            if (status.state === 'answered') {
              stopPolling()
              setPhase({ name: 'connecting' })
              await receiverRef.current?.acceptAnswer(status.answer)
            }
          })()
        }, POLL_INTERVAL_MS)
      } catch {
        if (!cancelled) {
          setPhase({
            name: 'error',
            message: 'Este navegador não permite a ligação com o celular.',
          })
        }
      }
    })()

    return () => {
      cancelled = true
      stopPolling()
      teardown()
      setPhase({ name: 'preparing' })
    }
  }, [open, patientId, sessionId, teardown])

  return (
    <Sheet open={open} title="Fotografar pelo celular" onClose={onClose}>
      <div className="flex flex-col items-center gap-2 text-center">
        {phase.name === 'waiting' ? (
          <>
            <QrCode
              value={phase.url}
              label="Código para abrir a captura no celular"
              size={240}
            />
            <ol className="flex list-inside list-decimal flex-col gap-0.5 text-left text-subhead text-label-secondary">
              <li>Aponte a câmera do celular para o código.</li>
              <li>Fotografe o paciente pelo celular.</li>
              <li>A foto aparece aqui e a prévia continua nesta tela.</li>
            </ol>
            <p className="text-footnote text-label-secondary">
              Os dois aparelhos precisam estar na mesma rede. A foto vai direto de um para o
              outro — não passa por servidor.
            </p>
          </>
        ) : null}

        {phase.name === 'preparing' ? (
          <p className="py-4 text-body text-label-secondary">Preparando o pareamento.</p>
        ) : null}

        {phase.name === 'connecting' ? (
          <p className="py-4 text-body text-label-secondary">
            Celular encontrado. Fotografe o paciente por lá.
          </p>
        ) : null}

        {phase.name === 'receiving' ? (
          <p className="py-4 text-body text-label" data-numeric>
            Recebendo a foto — {Math.round(phase.ratio * 100)}%
          </p>
        ) : null}

        {phase.name === 'error' ? (
          <p role="alert" className="py-4 text-body text-critical">
            {phase.message}
          </p>
        ) : null}

        <Button variant="plain" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </Sheet>
  )
}
