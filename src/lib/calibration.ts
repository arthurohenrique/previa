/**
 * Calibração clínica: traduz a intensidade do slider (0..1) num volume
 * aproximado de preenchedor, para o profissional falar a língua do
 * procedimento ("≈ 0,5 mL") em vez de porcentagem.
 *
 * ATENÇÃO: os volumes por região são PLACEHOLDERS de engenharia, ainda não
 * validados por profissional. A UI sempre rotula como estimativa ilustrativa.
 * O teto anatômico (quanto a região pode deformar) tem fonte única nos
 * templates do warp; aqui só se traduz para mL.
 */

import type { RegionId } from './anatomy'
import { REGION_TEMPLATES } from './warp/templates'

export interface ClinicalScale {
  unit: 'mL'
  /** Volume correspondente à intensidade 1 (100%). */
  max: number
}

export const CLINICAL_SCALE: Record<RegionId, ClinicalScale> = {
  'labio-superior': { unit: 'mL', max: 0.5 },
  'labio-inferior': { unit: 'mL', max: 0.5 },
  filtro: { unit: 'mL', max: 0.2 },
  'malar-direito': { unit: 'mL', max: 1.0 },
  'malar-esquerdo': { unit: 'mL', max: 1.0 },
  mento: { unit: 'mL', max: 1.5 },
  'sulco-nasogeniano-direito': { unit: 'mL', max: 0.8 },
  'sulco-nasogeniano-esquerdo': { unit: 'mL', max: 0.8 },
  'orbital-direita': { unit: 'mL', max: 0.5 },
  'orbital-esquerda': { unit: 'mL', max: 0.5 },
}

/** Passo de exibição do volume (mL). */
const VOLUME_STEP = 0.1

/** Volume estimado na intensidade dada, arredondado ao passo de exibição. */
export function volumeAt(region: RegionId, intensity: number): number {
  const clamped = Math.min(1, Math.max(0, intensity))
  const raw = CLINICAL_SCALE[region].max * clamped
  return Math.round(raw / VOLUME_STEP) * VOLUME_STEP
}

/** "≈ 0,5 mL" em pt-BR; "0 mL" na intensidade zero. */
export function volumeLabel(region: RegionId, intensity: number): string {
  const volume = volumeAt(region, intensity)
  if (volume <= 0) return `0 ${CLINICAL_SCALE[region].unit}`
  return `≈ ${volume.toFixed(1).replace('.', ',')} ${CLINICAL_SCALE[region].unit}`
}

/** Teto de deslocamento da região (× interocular) — fonte única: o template. */
export function anatomicalCeiling(region: RegionId): number {
  return REGION_TEMPLATES[region].maxDeltaFactor
}
