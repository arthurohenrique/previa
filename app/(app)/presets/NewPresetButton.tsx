'use client'

import { useRouter } from 'next/navigation'
import { useId, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { createPreset } from './actions'

const TECHNIQUES = [
  { value: 'filler', label: 'Preenchedor' },
  { value: 'toxin', label: 'Toxina botulínica' },
  { value: 'biostimulator', label: 'Bioestimulador' },
  { value: 'rhinomodeling', label: 'Rinomodelação' },
] as const

export function NewPresetButton({ regions }: { regions: Array<{ id: string; label: string }> }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const labelId = useId()
  const regionId = useId()
  const techniqueId = useId()
  const intensityId = useId()
  const radiusId = useId()
  const notesId = useId()

  const field =
    'w-full rounded-sm bg-elevated-2 px-2 py-1.5 text-body text-label placeholder:text-label-tertiary'

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    setError(null)

    startTransition(async () => {
      const result = await createPreset(formData)
      if (!result.ok) {
        setError(result.message)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="plain" onClick={() => setOpen(true)}>
        Cadastrar
      </Button>

      <Sheet open={open} title="Cadastrar protocolo" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <label htmlFor={labelId} className="text-subhead text-label-secondary">
              Nome do protocolo
            </label>
            <input id={labelId} name="label" required autoFocus className={field} />
          </div>

          <div className="flex flex-col gap-0.5">
            <label htmlFor={regionId} className="text-subhead text-label-secondary">
              Região
            </label>
            <select id={regionId} name="region_id" required className={field}>
              {regions.map((region) => (
                <option key={region.id} value={region.id}>
                  {region.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-0.5">
            <label htmlFor={techniqueId} className="text-subhead text-label-secondary">
              Técnica
            </label>
            <select id={techniqueId} name="technique" required className={field}>
              {TECHNIQUES.map((technique) => (
                <option key={technique.value} value={technique.value}>
                  {technique.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-0.5">
              <label htmlFor={intensityId} className="text-subhead text-label-secondary">
                Intensidade inicial
              </label>
              <input
                id={intensityId}
                name="default_intensity"
                type="number"
                min={0}
                max={1}
                step={0.01}
                defaultValue={0.4}
                data-numeric
                className={field}
              />
            </div>

            <div className="flex flex-1 flex-col gap-0.5">
              <label htmlFor={radiusId} className="text-subhead text-label-secondary">
                Área inicial (DIP)
              </label>
              <input
                id={radiusId}
                name="default_radius_ipd"
                type="number"
                min={0.01}
                max={1}
                step={0.01}
                defaultValue={0.16}
                data-numeric
                className={field}
              />
            </div>
          </div>

          <div className="flex flex-col gap-0.5">
            <label htmlFor={notesId} className="text-subhead text-label-secondary">
              Produto, diluição e dose
            </label>
            <textarea id={notesId} name="notes" rows={3} className={field} />
            <p className="text-footnote text-label-secondary">
              Este campo é do profissional. O Prévia não calcula nem sugere dose.
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-subhead text-critical">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-1">
            <Button variant="plain" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Salvando' : 'Salvar'}
            </Button>
          </div>
        </form>
      </Sheet>
    </>
  )
}
