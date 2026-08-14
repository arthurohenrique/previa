'use client'

import { useEffect, useMemo } from 'react'
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'

interface CompareSheetProps {
  open: boolean
  onClose: () => void
  before: Blob | null
  after: Blob | null
  onExport: () => void
  exporting: boolean
}

/** Cortina antes/depois. As duas imagens vivem em memória e nunca sobem. */
export function CompareSheet({
  open,
  onClose,
  before,
  after,
  onExport,
  exporting,
}: CompareSheetProps) {
  // A URL é derivada do blob, não um estado à parte: guardá-la em `useState`
  // dentro de um efeito custa um render extra e abre espaço para vazar a URL
  // quando o blob troca antes do efeito rodar.
  const beforeUrl = useMemo(() => (before ? URL.createObjectURL(before) : null), [before])
  const afterUrl = useMemo(() => (after ? URL.createObjectURL(after) : null), [after])

  useEffect(
    () => () => {
      if (beforeUrl) URL.revokeObjectURL(beforeUrl)
    },
    [beforeUrl],
  )

  useEffect(
    () => () => {
      if (afterUrl) URL.revokeObjectURL(afterUrl)
    },
    [afterUrl],
  )

  return (
    <Sheet open={open} title="Antes e depois" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {beforeUrl && afterUrl ? (
          <ReactCompareSlider
            className="overflow-hidden rounded-md"
            itemOne={<ReactCompareSliderImage src={beforeUrl} alt="Antes" />}
            itemTwo={<ReactCompareSliderImage src={afterUrl} alt="Depois" />}
          />
        ) : (
          <p className="text-body text-label-secondary">Preparando as imagens.</p>
        )}

        <p className="text-footnote text-label-secondary">
          Simulação. Não constitui garantia de resultado.
        </p>

        <div className="flex justify-end gap-1">
          <Button variant="plain" onClick={onClose}>
            Fechar
          </Button>
          <Button variant="primary" disabled={exporting || !afterUrl} onClick={onExport}>
            {exporting ? 'Gerando ficha' : 'Gerar ficha'}
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
