'use client'

import { useId, useRef } from 'react'
import { Button } from '@/components/ui/Button'
import type { QualityIssue } from '@/lib/face/quality'

export type CaptureProblem =
  | { kind: 'message'; message: string }
  | { kind: 'quality'; issues: QualityIssue[] }

interface PhotoCaptureProps {
  patientName: string
  busy: boolean
  problem: CaptureProblem | null
  onFile: (file: File) => void
}

/**
 * Captura e enquadramento.
 *
 * A silhueta não é decoração: ela é o que faz o profissional entregar uma foto
 * frontal na primeira tentativa, em vez de descobrir o ângulo errado depois da
 * detecção. O bloqueio de qualidade vem em seguida (E-04) e diz o que corrigir.
 */
export function PhotoCapture({ patientName, busy, problem, onFile }: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 safe-x safe-b safe-t">
      <div className="relative flex aspect-3/4 w-full max-w-50 items-center justify-center overflow-hidden rounded-lg bg-elevated">
        <svg
          viewBox="0 0 300 400"
          className="absolute inset-0 h-full w-full text-label-tertiary"
          aria-hidden="true"
        >
          <ellipse
            cx="150"
            cy="190"
            rx="92"
            ry="122"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="10 8"
          />
          <line x1="150" y1="52" x2="150" y2="330" stroke="currentColor" strokeWidth="1" />
          <line x1="58" y1="175" x2="242" y2="175" stroke="currentColor" strokeWidth="1" />
        </svg>
        <p className="relative max-w-40 px-2 text-center text-body text-label-secondary">
          Alinhe os olhos na linha horizontal e o nariz na vertical.
        </p>
      </div>

      <div className="flex w-full max-w-50 flex-col gap-2">
        <h1 className="text-large-title text-label">Prévia de {patientName}</h1>

        {problem ? (
          <div role="alert" className="flex flex-col gap-0.5">
            {problem.kind === 'message' ? (
              <p className="text-body text-critical">{problem.message}</p>
            ) : (
              problem.issues.map((issue) => (
                <p key={issue.code} className="text-body text-critical">
                  {issue.message}
                </p>
              ))
            )}
          </div>
        ) : (
          <p className="text-body text-label-secondary">
            Fotografe o paciente para começar. A foto fica neste dispositivo.
          </p>
        )}

        <label htmlFor={inputId} className="sr-only">
          Foto do paciente
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/*"
          capture="user"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Limpa o valor para que escolher a mesma foto de novo dispare o
            // change — sem isto, refazer a captura falha em silêncio.
            event.target.value = ''
            if (file) onFile(file)
          }}
        />

        <Button
          variant="primary"
          disabled={busy}
          className="w-full"
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Analisando' : 'Fotografar'}
        </Button>
      </div>
    </div>
  )
}
