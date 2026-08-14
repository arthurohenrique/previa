import type { RegionId, Side } from '@/lib/face/atlas'
import type { Technique } from '@/lib/supabase/types'

/**
 * Uma aplicação já resolvida para o render: centro em UV da foto, raio em fração
 * de DIP e intensidade adimensional.
 *
 * A conversão de âncora (landmark + offset em DIP) para centro acontece antes,
 * em store/useSessionStore.ts, para que o pipeline nunca precise dos landmarks.
 */
export interface ResolvedApplication {
  id: string
  regionId: RegionId
  side: Side
  /** Chave da instância de região — casa com MaskAtlas.slots. */
  regionKey: string
  technique: Technique
  /** Centro em UV da foto, 0..1. */
  u: number
  v: number
  /** Fração de DIP. Nunca pixel. */
  radiusIpd: number
  /** Adimensional 0..1. Não é dose. */
  intensity: number
}
