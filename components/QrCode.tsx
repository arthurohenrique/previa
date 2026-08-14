'use client'

import { useMemo } from 'react'
import { encode } from 'uqr'

interface QrCodeProps {
  value: string
  label: string
  /** Lado do código, em pixels de CSS. */
  size?: number
}

/**
 * QR desenhado em SVG, sem imagem e sem canvas.
 *
 * A correção de erro é média: o código fica na tela por segundos, a distância de
 * um braço, e nível alto só engrossaria a matriz sem ganho aqui.
 *
 * Os módulos viram um único `path`, não um retângulo por módulo. Uma matriz de
 * versão 4 tem mais de mil módulos, e mil elementos de SVG custam mais para o
 * navegador desenhar do que a foto inteira.
 */
export function QrCode({ value, label, size = 256 }: QrCodeProps) {
  const { path, modules } = useMemo(() => {
    const result = encode(value, { ecc: 'M', border: 2 })
    const commands: string[] = []

    result.data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) commands.push(`M${x} ${y}h1v1h-1z`)
      })
    })

    return { path: commands.join(''), modules: result.size }
  }, [value])

  return (
    <svg
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className="rounded-md bg-qr-paper"
    >
      <path d={path} className="fill-qr-ink" />
    </svg>
  )
}
