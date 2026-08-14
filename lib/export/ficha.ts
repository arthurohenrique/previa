'use client'

import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

/**
 * Ficha antes/depois em PDF, gerada no cliente.
 *
 * O PDF é montado aqui, no navegador, e apenas baixado ou compartilhado. Ele
 * carrega a foto do paciente, então não pode passar por servidor nenhum (D-01).
 *
 * A marca d'água não é enfeite: é o que impede a ficha de circular como promessa
 * de resultado depois que sai da clínica. Ela é queimada no conteúdo, atrás das
 * imagens e por cima delas, e não é uma camada que se apague num editor de PDF
 * comum.
 */

export const WATERMARK_TEXT = 'SIMULAÇÃO — NÃO CONSTITUI GARANTIA DE RESULTADO'

export interface FichaInput {
  patientName: string
  professionalName: string
  council: string | null
  before: Blob
  after: Blob
  /** Momento da captura. Passado de fora para o PDF ser reprodutível. */
  at: Date
  regions: string[]
}

const PAGE_WIDTH = 842 // A4 paisagem
const PAGE_HEIGHT = 595
const MARGIN = 36

async function toJpegBytes(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer()
  return new Uint8Array(buffer)
}

export async function buildFicha(input: FichaInput): Promise<Blob> {
  const pdf = await PDFDocument.create()
  pdf.setTitle('Prévia — simulação')
  pdf.setSubject(WATERMARK_TEXT)
  pdf.setProducer('Prévia')
  pdf.setCreator('Prévia')

  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const [beforeImage, afterImage] = await Promise.all([
    pdf.embedJpg(await toJpegBytes(input.before)),
    pdf.embedJpg(await toJpegBytes(input.after)),
  ])

  const headerHeight = 54
  const footerHeight = 64
  const gutter = 18
  const slotWidth = (PAGE_WIDTH - MARGIN * 2 - gutter) / 2
  const slotHeight = PAGE_HEIGHT - MARGIN * 2 - headerHeight - footerHeight
  const slotBottom = MARGIN + footerHeight

  const draw = (
    image: typeof beforeImage,
    x: number,
    caption: string,
  ): void => {
    const scale = Math.min(slotWidth / image.width, slotHeight / image.height)
    const width = image.width * scale
    const height = image.height * scale
    const offsetX = x + (slotWidth - width) / 2
    const offsetY = slotBottom + (slotHeight - height) / 2

    page.drawImage(image, { x: offsetX, y: offsetY, width, height })
    page.drawText(caption, {
      x: offsetX,
      y: offsetY + height + 8,
      size: 11,
      font: bold,
      color: rgb(0.1, 0.1, 0.12),
    })
  }

  page.drawText('Prévia', {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 14,
    size: 20,
    font: bold,
    color: rgb(0.06, 0.06, 0.08),
  })
  page.drawText(input.patientName, {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 32,
    size: 11,
    font: regular,
    color: rgb(0.35, 0.35, 0.4),
  })

  draw(beforeImage, MARGIN, 'Antes')
  draw(afterImage, MARGIN + slotWidth + gutter, 'Depois')

  // Marca d'água na diagonal, por cima das duas imagens.
  page.drawText(WATERMARK_TEXT, {
    x: 58,
    y: 132,
    size: 26,
    font: bold,
    color: rgb(0.85, 0.1, 0.1),
    opacity: 0.28,
    rotate: degrees(24),
  })

  const stamp = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(input.at)

  const identification = input.council
    ? `${input.professionalName} · ${input.council}`
    : input.professionalName

  const footer = [
    WATERMARK_TEXT,
    `${identification} · ${stamp}`,
    input.regions.length > 0 ? `Regiões simuladas: ${input.regions.join(', ')}` : null,
  ].filter((line): line is string => line !== null)

  footer.forEach((line, index) => {
    page.drawText(line, {
      x: MARGIN,
      y: MARGIN + (footer.length - 1 - index) * 14,
      size: index === 0 ? 10 : 9,
      font: index === 0 ? bold : regular,
      color: index === 0 ? rgb(0.7, 0.08, 0.08) : rgb(0.35, 0.35, 0.4),
    })
  })

  const bytes = await pdf.save()
  return new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' })
}

/**
 * Entrega o arquivo. Tenta o compartilhamento nativo do iPadOS primeiro, porque
 * é o caminho que o profissional já conhece; cai para download quando não há.
 */
export async function deliverFicha(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: 'application/pdf' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Prévia' })
      return
    } catch {
      // Cancelar o compartilhamento não é erro; segue para o download.
    }
  }

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
