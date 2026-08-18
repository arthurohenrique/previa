import type { RegionId } from '@/lib/face/atlas'
import type { Technique } from '@/lib/supabase/types'

/**
 * Limite de amplitude por região e por técnica — no código, não na interface.
 *
 * Simulação exagerada é o maior risco do produto. O paciente vê um resultado
 * impossível, faz o procedimento, não se reconhece, e a clínica responde por
 * isso. O teto conservador é requisito de segurança, não preferência estética,
 * e por isso vive aqui e não num controle da tela (D-05).
 *
 * Todos os valores são fração de DIP. Numa DIP típica de 63 mm, 0.03 DIP ≈
 * 1,9 mm de deslocamento aparente na foto.
 */

export interface Clamp {
  /** Deslocamento máximo do tecido, em fração de DIP. */
  maxAmplitudeIpd: number
  /** Raio mínimo e máximo do efeito, em fração de DIP. */
  minRadiusIpd: number
  maxRadiusIpd: number
  /** Mistura máxima de suavização (só a toxina usa). */
  maxSmoothing: number
}

const NONE: Clamp = { maxAmplitudeIpd: 0, minRadiusIpd: 0.05, maxRadiusIpd: 0.4, maxSmoothing: 0 }

/** Teto por técnica, antes do ajuste por região. */
const BY_TECHNIQUE: Record<Technique, Clamp> = {
  // Preenchedor: deslocamento radial para fora. É a técnica de maior amplitude,
  // e ainda assim o teto fica na casa de 2 mm aparentes.
  filler: { maxAmplitudeIpd: 0.038, minRadiusIpd: 0.08, maxRadiusIpd: 0.32, maxSmoothing: 0.12 },

  // Toxina: praticamente sem deslocamento. O efeito é separação de frequência —
  // atenuar o vinco preservando a textura de poro.
  toxin: { maxAmplitudeIpd: 0.006, minRadiusIpd: 0.1, maxRadiusIpd: 0.42, maxSmoothing: 0.72 },

  // Bioestimulador: amplitude baixa, raio grande, direção superior-lateral.
  biostimulator: {
    maxAmplitudeIpd: 0.02,
    minRadiusIpd: 0.18,
    maxRadiusIpd: 0.5,
    maxSmoothing: 0.15,
  },

  // Rinomodelação: máscara estreita e ganho maior, com limite rígido de ±5% da
  // largura nasal. A largura nasal fica em torno de 0.62 DIP, então 5% dela é
  // ≈ 0.031 DIP — este é o teto absoluto e não é negociável por região.
  rhinomodeling: {
    maxAmplitudeIpd: 0.031,
    minRadiusIpd: 0.05,
    maxRadiusIpd: 0.16,
    maxSmoothing: 0.08,
  },
}

/** Ajustes por região. Ausente = vale o teto da técnica. */
const BY_REGION: Partial<Record<RegionId, Partial<Record<Technique, Partial<Clamp>>>>> = {
  // Pálpebra é fina e o olho é o que o paciente mais reconhece. Amplitude curta.
  periorbital: {
    filler: { maxAmplitudeIpd: 0.018, maxRadiusIpd: 0.2 },
    toxin: { maxSmoothing: 0.6 },
  },
  // Vermelhão do lábio é onde o exagero fica evidente primeiro.
  upper_lip: { filler: { maxAmplitudeIpd: 0.03, maxRadiusIpd: 0.2 } },
  lower_lip: { filler: { maxAmplitudeIpd: 0.03, maxRadiusIpd: 0.2 } },
  // Sulco: o efeito real é preencher a depressão, não projetar a bochecha.
  nasolabial_fold: { filler: { maxAmplitudeIpd: 0.026, maxRadiusIpd: 0.22 } },
  malar: { filler: { maxAmplitudeIpd: 0.034, maxRadiusIpd: 0.34 } },
  chin: { filler: { maxAmplitudeIpd: 0.036 } },
  jawline: { filler: { maxAmplitudeIpd: 0.03, maxRadiusIpd: 0.3 } },
  // A testa não recebe preenchedor neste produto; só toxina.
  frontal: { toxin: { maxSmoothing: 0.75 } },
  glabella: { toxin: { maxSmoothing: 0.78 } },
  nasal_dorsum: { filler: { maxAmplitudeIpd: 0.02, maxRadiusIpd: 0.14 } },
}

export function clampFor(regionId: RegionId, technique: Technique): Clamp {
  const base = BY_TECHNIQUE[technique] ?? NONE
  const override = BY_REGION[regionId]?.[technique]
  if (!override) return base
  return { ...base, ...override }
}

/** Restringe um valor ao intervalo. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** Aplica o teto sobre um raio pedido pela interface ou por um protocolo. */
export function clampRadius(
  radiusIpd: number,
  regionId: RegionId,
  technique: Technique,
): number {
  const limits = clampFor(regionId, technique)
  return clamp(radiusIpd, limits.minRadiusIpd, limits.maxRadiusIpd)
}

/**
 * Amplitude efetiva em fração de DIP.
 *
 * `intensity` é adimensional 0..1 e não tem qualquer relação com dose. O mapa é
 * linear: metade do controle é metade do deslocamento máximo seguro daquela
 * região.
 *
 * Era quadrático, com o argumento de dar resolução fina perto de zero. O efeito
 * real foi outro: o teto já é conservador — 0.038 DIP são cerca de 2,4 mm
 * aparentes —, e elevar ao quadrado punha o padrão de 45% em 20% desse teto,
 * meio milímetro. Somado à máscara, a simulação virava uma foto que não muda, e
 * um simulador que não simula não protege ninguém: o profissional sobe o
 * controle até o fim e trabalha sempre no limite. O teto continua sendo o
 * limite de segurança (D-05); a curva não é lugar de escondê-lo.
 */
export function amplitudeFor(
  intensity: number,
  regionId: RegionId,
  technique: Technique,
): number {
  const limits = clampFor(regionId, technique)
  return limits.maxAmplitudeIpd * clamp(intensity, 0, 1)
}

/**
 * Raio padrão de uma aplicação nova, a partir do raio inscrito da região.
 *
 * O raio fixo de antes ignorava o tamanho da região: 0.16 DIP transbordava a
 * glabela e cabia folgado na linha mandibular. Transbordar é o caso ruim — o
 * pico do perfil de bojo fica em um terço do raio, e se o raio for grande demais
 * esse pico cai fora da máscara, onde não há tecido para empurrar.
 *
 * Uma vez e meia o raio inscrito põe o pico a meio caminho do núcleo, com a
 * borda do efeito morrendo junto com a máscara.
 */
export function defaultRadiusIpd(
  inscribedIpd: number,
  regionId: RegionId,
  technique: Technique,
): number {
  return clampRadius(inscribedIpd * 1.5, regionId, technique)
}

/** Mistura de suavização efetiva. Só a toxina usa em quantidade relevante. */
export function smoothingFor(
  intensity: number,
  regionId: RegionId,
  technique: Technique,
): number {
  const limits = clampFor(regionId, technique)
  return limits.maxSmoothing * clamp(intensity, 0, 1)
}
