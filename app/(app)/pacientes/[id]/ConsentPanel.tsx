'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { SignaturePad, type SignaturePadHandle } from '@/components/SignaturePad'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { grantConsent, revokeConsent } from './actions'

interface ConsentPanelProps {
  patientId: string
  consent: { id: string; granted_at: string; terms_version: string } | null
  termsVersion: string
}

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

export function ConsentPanel({ patientId, consent, termsVersion }: ConsentPanelProps) {
  const router = useRouter()
  const padRef = useRef<SignaturePadHandle>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleGrant() {
    const svg = padRef.current?.toSvg()
    if (!svg) {
      setError('Assine no quadro para registrar.')
      return
    }
    setError(null)

    startTransition(async () => {
      const result = await grantConsent({
        patient_id: patientId,
        signature_svg: svg,
        terms_version: termsVersion,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  function handleRevoke() {
    if (!consent) return
    startTransition(async () => {
      await revokeConsent(consent.id, patientId)
      router.refresh()
    })
  }

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-title3 text-label">Consentimento</h2>

      <div className="flex flex-col gap-1.5 rounded-md bg-elevated p-2">
        {consent ? (
          <>
            <p className="text-body text-label">
              Registrado em{' '}
              <time dateTime={consent.granted_at}>
                {dateFormat.format(new Date(consent.granted_at))}
              </time>
            </p>
            <p className="text-footnote text-label-secondary" data-numeric>
              Termos versão {consent.terms_version}
            </p>
            <Button variant="destructive" className="self-start px-0" onClick={handleRevoke}>
              Revogar consentimento
            </Button>
          </>
        ) : (
          <>
            <p className="text-body text-label-secondary">
              Sem consentimento vigente. A prévia só começa depois do registro.
            </p>
            <Button variant="primary" className="self-start" onClick={() => setOpen(true)}>
              Registrar consentimento
            </Button>
          </>
        )}
      </div>

      <Sheet open={open} title="Registrar consentimento" onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-2">
          <p className="text-body text-label-secondary">
            Autorizo a simulação de procedimentos estéticos sobre a minha fotografia, para fim de
            visualização durante a consulta. A imagem permanece neste dispositivo e não é enviada
            para servidor. A simulação é uma prévia e não constitui garantia de resultado.
          </p>
          <p className="text-footnote text-label-secondary" data-numeric>
            Termos versão {termsVersion}
          </p>

          <SignaturePad ref={padRef} label="Quadro de assinatura do paciente" />

          {error ? (
            <p role="alert" className="text-subhead text-critical">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-1">
            <Button variant="plain" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="primary" disabled={pending} onClick={handleGrant}>
              {pending ? 'Registrando' : 'Registrar'}
            </Button>
          </div>
        </div>
      </Sheet>
    </section>
  )
}
