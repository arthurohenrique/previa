'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { createPatient } from './actions'

export function NewPatientButton() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const nameId = useId()
  const yearId = useId()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setError(null)

    startTransition(async () => {
      const result = await createPatient(formData)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  const field =
    'w-full rounded-sm bg-elevated-2 px-2 py-1.5 text-body text-label placeholder:text-label-tertiary'

  return (
    <>
      <Button variant="plain" onClick={() => setOpen(true)}>
        Cadastrar
      </Button>

      <Sheet open={open} title="Cadastrar paciente" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <label htmlFor={nameId} className="text-subhead text-label-secondary">
              Nome
            </label>
            <input id={nameId} name="full_name" required autoFocus className={field} />
          </div>

          <div className="flex flex-col gap-0.5">
            <label htmlFor={yearId} className="text-subhead text-label-secondary">
              Ano de nascimento
            </label>
            <input
              id={yearId}
              name="birth_year"
              inputMode="numeric"
              pattern="[0-9]{4}"
              data-numeric
              className={field}
            />
          </div>

          <p className="text-footnote text-label-secondary">
            O Prévia guarda só o mínimo para identificar a sessão. Sem CPF, sem endereço, sem
            telefone.
          </p>

          {error ? (
            <p role="alert" className="text-subhead text-critical">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-1 pt-1">
            <Button variant="plain" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Cadastrando' : 'Cadastrar'}
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  )
}
