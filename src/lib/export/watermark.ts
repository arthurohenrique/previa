/**
 * Marca d'água obrigatória em todo resultado exportado (restrição nº 5 do
 * CLAUDE.md): "SIMULAÇÃO ILUSTRATIVA" na diagonal, mais um rodapé com a
 * origem e a data. A geometria é pura e testada; o desenho é Canvas 2D.
 */

export const WATERMARK_TEXT = 'SIMULAÇÃO ILUSTRATIVA'

export interface WatermarkLayout {
  /** Tamanho da fonte em px (proporcional à diagonal da imagem). */
  fontSize: number
  /** Rotação em radianos (sobe da esquerda para a direita). */
  angle: number
  /** Centro do texto. */
  centerX: number
  centerY: number
  alpha: number
  /** Largura estimada do texto (0,6 em por caractere). */
  estimatedWidth: number
  footer: {
    fontSize: number
    height: number
    paddingX: number
  }
}

/** Fração da diagonal usada como tamanho da fonte. */
const FONT_DIAGONAL_FRACTION = 0.03
const CHAR_WIDTH_EM = 0.6

export function watermarkLayout(width: number, height: number): WatermarkLayout {
  const diagonal = Math.hypot(width, height)
  const fontSize = Math.max(12, diagonal * FONT_DIAGONAL_FRACTION)
  const footerFont = Math.max(10, Math.min(width, height) * 0.018)
  return {
    fontSize,
    angle: -Math.atan2(height, width),
    centerX: width / 2,
    centerY: height / 2,
    alpha: 0.35,
    estimatedWidth: WATERMARK_TEXT.length * fontSize * CHAR_WIDTH_EM,
    footer: { fontSize: footerFont, height: footerFont * 2.2, paddingX: footerFont },
  }
}

/** Desenha a marca diagonal e o rodapé sobre um canvas já com a imagem. */
export function drawWatermark(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  footerText: string,
): void {
  const layout = watermarkLayout(width, height)

  context.save()
  context.translate(layout.centerX, layout.centerY)
  context.rotate(layout.angle)
  context.font = `700 ${layout.fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineWidth = Math.max(1, layout.fontSize * 0.06)
  context.strokeStyle = `rgba(0, 0, 0, ${layout.alpha})`
  context.strokeText(WATERMARK_TEXT, 0, 0)
  context.fillStyle = `rgba(255, 255, 255, ${layout.alpha})`
  context.fillText(WATERMARK_TEXT, 0, 0)
  context.restore()

  context.save()
  const { fontSize, height: footerHeight, paddingX } = layout.footer
  context.fillStyle = 'rgba(0, 0, 0, 0.55)'
  context.fillRect(0, height - footerHeight, width, footerHeight)
  context.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`
  context.textAlign = 'right'
  context.textBaseline = 'middle'
  context.fillStyle = 'rgba(255, 255, 255, 0.95)'
  context.fillText(footerText, width - paddingX, height - footerHeight / 2)
  context.restore()
}

/** Texto do rodapé: origem e data no formato brasileiro. */
export function footerText(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `Prévia · simulação ilustrativa · ${day}/${month}/${date.getFullYear()}`
}
