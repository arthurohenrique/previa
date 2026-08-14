'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { preparePhoto } from '@/lib/image/prepare'
import { createSender, type Sender } from '@/lib/pairing/webrtc'
import { answer, claim } from './actions'

type Phase =
  | { name: 'pairing' }
  | { name: 'ready'; patientName: string }
  | { name: 'preparing' }
  | { name: 'sending'; ratio: number }
  | { name: 'sent' }
  | { name: 'error'; message: string }

export function PhoneCapture({ pairId }: { pairId: string }) {
  const [phase, setPhase] = useState<Phase>({ name: 'pairing' })
  const senderRef = useRef<Sender | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const claimed = await claim(pairId)
      if (cancelled) return
      if (!claimed.ok) {
        setPhase({ name: 'error', message: claimed.message })
        return
      }

      try {
        const sender = await createSender(claimed.offer, (event) => {
          if (cancelled) return
          if (event.kind === 'progress') setPhase({ name: 'sending', ratio: event.ratio })
          if (event.kind === 'sent') setPhase({ name: 'sent' })
          if (event.kind === 'error') setPhase({ name: 'error', message: event.message })
        })

        if (cancelled) {
          sender.close()
          return
        }
        senderRef.current = sender

        const answered = await answer(pairId, sender.answer)
        if (cancelled) return
        if (!answered.ok) {
          setPhase({ name: 'error', message: answered.message })
          return
        }

        setPhase({ name: 'ready', patientName: claimed.patientName })
      } catch {
        if (!cancelled) {
          setPhase({
            name: 'error',
            message: 'Este navegador não permite a ligação com o computador.',
          })
        }
      }
    })()

    return () => {
      cancelled = true
      senderRef.current?.close()
      senderRef.current = null
    }
  }, [pairId])

  const handleFile = useCallback(async (file: File) => {
    const sender = senderRef.current
    if (!sender) return

    setPhase({ name: 'preparing' })
    try {
      // A limpeza acontece aqui, antes de a foto sair do celular: HEIC vira
      // JPEG, o lado maior cai para 2048 px e o EXIF inteiro morre — inclusive
      // o GPS, que num celular é a coordenada da clínica.
      const prepared = await preparePhoto(file)
      await sender.sendPhoto(prepared.blob, prepared.width, prepared.height)
    } catch (error) {
      setPhase({
        name: 'error',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Não foi possível enviar a foto. Tente de novo.',
      })
    }
  }, [])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 safe-x safe-t safe-b">
      <div className="flex w-full max-w-45 flex-col gap-2">
        <h1 className="text-large-title text-label">Prévia</h1>

        {phase.name === 'pairing' ? (
          <p className="text-body text-label-secondary">Conectando ao computador.</p>
        ) : null}

        {phase.name === 'ready' ? (
          <>
            <p className="text-body text-label">
              Fotografe {phase.patientName} de frente, com os olhos na horizontal.
            </p>
            <p className="text-footnote text-label-secondary">
              A foto vai direto para o computador. Ela não fica salva neste celular e não passa
              por servidor.
            </p>

            <label htmlFor={inputId} className="sr-only">
              Foto do paciente
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void handleFile(file)
              }}
            />

            <Button
              variant="primary"
              className="w-full"
              onClick={() => inputRef.current?.click()}
            >
              Fotografar
            </Button>
          </>
        ) : null}

        {phase.name === 'preparing' ? (
          <p className="text-body text-label-secondary">Preparando a foto.</p>
        ) : null}

        {phase.name === 'sending' ? (
          <p className="text-body text-label" data-numeric>
            Enviando — {Math.round(phase.ratio * 100)}%
          </p>
        ) : null}

        {phase.name === 'sent' ? (
          <>
            <p className="text-body text-label">Foto enviada.</p>
            <p className="text-body text-label-secondary">Continue no computador.</p>
          </>
        ) : null}

        {phase.name === 'error' ? (
          <p role="alert" className="text-body text-critical">
            {phase.message}
          </p>
        ) : null}
      </div>
    </main>
  )
}
