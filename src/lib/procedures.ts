/**
 * Procedimentos: a unidade que o profissional escolhe na UI. Um procedimento
 * agrupa regiões anatômicas com proporções fixas — um único slider move
 * lábio superior e inferior juntos, ou os dois malares simetricamente.
 * A verdade continua sendo o DeformMap por região (histórico, campos).
 */

import type { RegionId } from './anatomy'
import { volumeAt } from './calibration'
import type { DeformMap } from './warp/compose'

export type ProcedureId = 'labios' | 'malar' | 'mento' | 'sulco' | 'olheira'

export interface ProcedureInfo {
  id: ProcedureId
  label: string
  description: string
  /** Intensidade da região = intensidade do procedimento × ratio. */
  ratio: Partial<Record<RegionId, number>>
  /** Par simétrico (o rótulo de volume vira "por lado"). */
  symmetric: boolean
}

export const PROCEDURES: Record<ProcedureId, ProcedureInfo> = {
  labios: {
    id: 'labios',
    label: 'Lábios',
    description: 'Preenchimento labial',
    ratio: { 'labio-superior': 0.9, 'labio-inferior': 1 },
    symmetric: false,
  },
  malar: {
    id: 'malar',
    label: 'Malar',
    description: 'Preenchimento malar',
    ratio: { 'malar-direito': 1, 'malar-esquerdo': 1 },
    symmetric: true,
  },
  mento: {
    id: 'mento',
    label: 'Mento',
    description: 'Preenchimento de mento',
    ratio: { mento: 1 },
    symmetric: false,
  },
  sulco: {
    id: 'sulco',
    label: 'Sulco',
    description: 'Preenchimento do sulco nasogeniano',
    ratio: { 'sulco-nasogeniano-direito': 1, 'sulco-nasogeniano-esquerdo': 1 },
    symmetric: true,
  },
  olheira: {
    id: 'olheira',
    label: 'Olheira',
    description: 'Tratamento de olheira',
    ratio: { 'orbital-direita': 1, 'orbital-esquerda': 1 },
    symmetric: true,
  },
}

export const PROCEDURE_ORDER: readonly ProcedureId[] = [
  'labios',
  'malar',
  'mento',
  'sulco',
  'olheira',
]

/** Região tocada → procedimento. O filtro labial pertence a "Lábios". */
export function regionToProcedure(region: RegionId): ProcedureId {
  if (region === 'filtro') return 'labios'
  for (const id of PROCEDURE_ORDER) {
    if (PROCEDURES[id].ratio[region] !== undefined) return id
  }
  // Exaustivo por construção; o fallback nunca deve ocorrer.
  return 'labios'
}

/** Intensidade do procedimento lida do DeformMap (maior região / ratio). */
export function procedureIntensity(id: ProcedureId, deformations: DeformMap): number {
  let intensity = 0
  for (const [region, ratio] of Object.entries(PROCEDURES[id].ratio) as Array<[RegionId, number]>) {
    if (ratio > 0) intensity = Math.max(intensity, (deformations[region] ?? 0) / ratio)
  }
  return Math.min(1, intensity)
}

/** Novo DeformMap com o procedimento na intensidade dada (demais intactos). */
export function applyProcedure(
  id: ProcedureId,
  intensity: number,
  deformations: DeformMap,
): DeformMap {
  const next: DeformMap = { ...deformations }
  const clamped = Math.min(1, Math.max(0, intensity))
  for (const [region, ratio] of Object.entries(PROCEDURES[id].ratio) as Array<[RegionId, number]>) {
    next[region] = clamped * ratio
  }
  return next
}

/** "≈ 1,0 mL por lado" (pares simétricos) ou o total somado das regiões. */
export function procedureVolumeLabel(id: ProcedureId, intensity: number): string {
  const info = PROCEDURES[id]
  const entries = Object.entries(info.ratio) as Array<[RegionId, number]>
  if (info.symmetric) {
    const [region, ratio] = entries[0]
    const volume = volumeAt(region, intensity * ratio)
    if (volume <= 0) return '0 mL'
    return `≈ ${volume.toFixed(1).replace('.', ',')} mL por lado`
  }
  let total = 0
  for (const [region, ratio] of entries) total += volumeAt(region, intensity * ratio)
  if (total <= 0) return '0 mL'
  return `≈ ${total.toFixed(1).replace('.', ',')} mL`
}

/** Linhas para o PDF: um procedimento ativo por linha, com volume. */
export function procedureLines(deformations: DeformMap): string[] {
  const lines: string[] = []
  for (const id of PROCEDURE_ORDER) {
    const intensity = procedureIntensity(id, deformations)
    if (intensity <= 0) continue
    lines.push(`${PROCEDURES[id].description}: ${procedureVolumeLabel(id, intensity)}`)
  }
  return lines
}
