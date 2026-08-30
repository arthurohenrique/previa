/**
 * Comparativo antes/depois em PDF (A4 paisagem) com jspdf — gerado no
 * navegador, sem rede. A imagem "depois" já traz a marca d'água; a página
 * repete o aviso e lista os procedimentos simulados.
 */

import { jsPDF } from 'jspdf'
import { footerText, WATERMARK_TEXT } from './watermark'

export interface PdfInput {
  before: HTMLCanvasElement
  after: HTMLCanvasElement
  /** Linhas como "Preenchimento labial — Lábio superior: ≈ 0,5 mL". */
  procedures: readonly string[]
  date?: Date
}

const PAGE_WIDTH = 297
const PAGE_HEIGHT = 210
const MARGIN = 12
const GAP = 8
const TITLE_HEIGHT = 14
const CAPTION_HEIGHT = 7
const FOOTER_HEIGHT = 26
const JPEG_QUALITY = 0.9

/**
 * As fontes padrão do jspdf são WinAnsi: "≈" e "•" não existem lá e saem
 * como lixo com espaçamento quebrado. Troca pelos equivalentes ASCII.
 */
export function pdfSafe(text: string): string {
  return text.replace(/≈/g, '~').replace(/•/g, '-')
}

export interface ImagePlacement {
  x: number
  y: number
  width: number
  height: number
}

/** Ajusta a imagem numa caixa preservando a proporção, centralizada. */
export function fitImage(
  imageWidth: number,
  imageHeight: number,
  box: ImagePlacement,
): ImagePlacement {
  const scale = Math.min(box.width / imageWidth, box.height / imageHeight)
  const width = imageWidth * scale
  const height = imageHeight * scale
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height }
}

/** Caixas das duas imagens na página A4 paisagem. */
export function pageBoxes(): { before: ImagePlacement; after: ImagePlacement } {
  const top = MARGIN + TITLE_HEIGHT
  const height = PAGE_HEIGHT - top - CAPTION_HEIGHT - FOOTER_HEIGHT - MARGIN
  const width = (PAGE_WIDTH - 2 * MARGIN - GAP) / 2
  return {
    before: { x: MARGIN, y: top, width, height },
    after: { x: MARGIN + width + GAP, y: top, width, height },
  }
}

export function buildComparisonPdf(input: PdfInput): Blob {
  const date = input.date ?? new Date()
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const boxes = pageBoxes()

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Prévia — comparativo de simulação', MARGIN, MARGIN + 6)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text(footerText(date), PAGE_WIDTH - MARGIN, MARGIN + 6, { align: 'right' })
  doc.setTextColor(0)

  const placeBefore = fitImage(input.before.width, input.before.height, boxes.before)
  const placeAfter = fitImage(input.after.width, input.after.height, boxes.after)
  doc.addImage(
    input.before.toDataURL('image/jpeg', JPEG_QUALITY),
    'JPEG',
    placeBefore.x,
    placeBefore.y,
    placeBefore.width,
    placeBefore.height,
  )
  doc.addImage(
    input.after.toDataURL('image/jpeg', JPEG_QUALITY),
    'JPEG',
    placeAfter.x,
    placeAfter.y,
    placeAfter.width,
    placeAfter.height,
  )

  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  const captionY = boxes.before.y + boxes.before.height + 5
  doc.text('Antes', boxes.before.x + boxes.before.width / 2, captionY, { align: 'center' })
  doc.text(`Depois — ${WATERMARK_TEXT}`, boxes.after.x + boxes.after.width / 2, captionY, {
    align: 'center',
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  let lineY = captionY + 7
  const procedures = input.procedures.length > 0 ? input.procedures : ['Nenhum procedimento ajustado.']
  for (const line of procedures.slice(0, 4)) {
    doc.text(`- ${pdfSafe(line)}`, MARGIN, lineY)
    lineY += 4.5
  }

  doc.setFontSize(7.5)
  doc.setTextColor(90)
  doc.text(
    'Resultado ilustrativo, gerado por simulação computacional no consultório. Não constitui promessa de resultado nem substitui a avaliação clínica. Volumes são estimativas.',
    MARGIN,
    PAGE_HEIGHT - MARGIN,
    { maxWidth: PAGE_WIDTH - 2 * MARGIN },
  )

  return doc.output('blob')
}
