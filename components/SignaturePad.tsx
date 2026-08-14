'use client'

import { useCallback, useImperativeHandle, useRef, useState } from 'react'

export interface SignaturePadHandle {
  /** SVG da assinatura, ou `null` se ainda não houver traço. */
  toSvg: () => string | null
  clear: () => void
}

interface SignaturePadProps {
  ref: React.Ref<SignaturePadHandle>
  label: string
}

const WIDTH = 640
const HEIGHT = 220

/**
 * Quadro de assinatura. Pointer Events, então dedo e Apple Pencil funcionam
 * pelo mesmo caminho — `pointerType: 'pen'` não precisa de nada especial.
 *
 * O traço é guardado como polilinha e serializado em SVG: vetor é menor que
 * bitmap, imprime bem na ficha e não vira mais um blob de imagem para proteger.
 */
export function SignaturePad({ ref, label }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Array<Array<[number, number]>>>([])
  const drawingRef = useRef(false)
  const [empty, setEmpty] = useState(true)

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = getComputedStyle(canvas).color

    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue
      ctx.beginPath()
      const [first, ...rest] = stroke
      if (!first) continue
      ctx.moveTo(first[0], first[1])
      for (const [x, y] of rest) ctx.lineTo(x, y)
      ctx.stroke()
    }
  }, [])

  const toLocal = useCallback((event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) / rect.width) * WIDTH,
      ((event.clientY - rect.top) / rect.height) * HEIGHT,
    ]
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        strokesRef.current = []
        setEmpty(true)
        redraw()
      },
      toSvg() {
        const strokes = strokesRef.current.filter((s) => s.length > 1)
        if (strokes.length === 0) return null

        const paths = strokes
          .map((stroke) => {
            const d = stroke
              .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
              .join(' ')
            return `<path d="${d}"/>`
          })
          .join('')

        return (
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" ` +
          `fill="none" stroke="currentColor" stroke-width="2.4" ` +
          `stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
        )
      },
    }),
    [redraw],
  )

  return (
    <div className="flex flex-col gap-1">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        role="img"
        aria-label={label}
        className="w-full touch-none rounded-md bg-elevated-2 text-label"
        style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drawingRef.current = true
          strokesRef.current.push([toLocal(event)])
          setEmpty(false)
        }}
        onPointerMove={(event) => {
          if (!drawingRef.current) return
          const stroke = strokesRef.current.at(-1)
          if (!stroke) return
          // getCoalescedEvents devolve as amostras que o Safari agrupou entre
          // dois frames. Sem isto, o traço rápido do Pencil sai poligonal.
          const points = event.nativeEvent.getCoalescedEvents?.() ?? []
          if (points.length > 0) {
            const rect = event.currentTarget.getBoundingClientRect()
            for (const point of points) {
              stroke.push([
                ((point.clientX - rect.left) / rect.width) * WIDTH,
                ((point.clientY - rect.top) / rect.height) * HEIGHT,
              ])
            }
          } else {
            stroke.push(toLocal(event))
          }
          redraw()
        }}
        onPointerUp={() => {
          drawingRef.current = false
        }}
        onPointerCancel={() => {
          drawingRef.current = false
        }}
      />
      <button
        type="button"
        onClick={() => {
          strokesRef.current = []
          setEmpty(true)
          redraw()
        }}
        disabled={empty}
        className="flex min-h-(--touch-target) items-center self-start text-subhead text-accent disabled:opacity-30"
      >
        Limpar assinatura
      </button>
    </div>
  )
}
