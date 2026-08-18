'use client'

import { useRouter } from 'next/navigation'
import { newId } from '@/lib/id'
import { Button } from '@/components/ui/Button'

/**
 * A sessão nasce no cliente: o id é gerado aqui e a linha de metadados só é
 * gravada depois que a foto passa na validação de qualidade e a detecção termina
 * (a política de RLS exige DIP e ângulo reais). Antes disso não existe nada para
 * gravar — e a foto nunca vai existir no servidor de qualquer forma.
 */
export function StartSessionButton({
  patientId,
  disabled,
}: {
  patientId: string
  disabled: boolean
}) {
  const router = useRouter()

  return (
    <Button
      variant="primary"
      disabled={disabled}
      title={disabled ? 'Registre o consentimento antes de começar.' : undefined}
      onClick={() => {
        const sessionId = newId()
        router.push(`/sessao/${sessionId}?paciente=${patientId}`)
      }}
    >
      Nova prévia
    </Button>
  )
}
