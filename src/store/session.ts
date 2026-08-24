/**
 * Estado de sessão (Zustand). Vive só em memória: fechar/recarregar a aba
 * descarta a foto — comportamento exigido pela LGPD nesta fase.
 */

import { create } from 'zustand'
import type { RegionId } from '@/lib/anatomy'
import type { DeformMap } from '@/lib/deform/field'
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  undo,
  type History,
} from '@/lib/deform/history'
import type { ProcessedPhoto } from '@/lib/image'
import type { FaceAnalysis } from '@/lib/landmarker'
import type { DeviceCapabilities, ExecutionProfile } from '@/lib/profile'
import type { SegmentationOutput, SegmentationStrategy } from '@/lib/segmentation/types'

interface SessionState {
  /** Foto sanitizada em alta resolução (exportação futura). */
  originalPhoto: Blob | null
  /** Foto de trabalho redimensionada pelo perfil. */
  workingPhoto: Blob | null
  /** Object URL da foto de trabalho, para exibição. */
  workingPhotoUrl: string | null
  photoWidth: number | null
  photoHeight: number | null

  capabilities: DeviceCapabilities | null
  detectedProfile: ExecutionProfile | null
  /** Escolha manual na tela de configuração; null = automático. */
  profileOverride: ExecutionProfile | null

  /** Resultado do FaceLandmarker para a foto atual (Fase 2). */
  analysis: FaceAnalysis | null

  /** Resultado da segmentação para a foto atual (Fase 2.5). */
  segmentation: SegmentationOutput | null
  /** Estratégia de segmentação escolhida na configuração. */
  segmentationStrategy: SegmentationStrategy

  /** Região anatômica ativa (Fase 3), escolhida pelo toque na foto. */
  activeRegion: RegionId | null

  /** Intensidades ao vivo por região (Fase 4). */
  deformations: DeformMap
  /** Histórico de estados CONFIRMADOS (commit no soltar do slider). */
  deformHistory: History<DeformMap>

  setCapabilities(caps: DeviceCapabilities, profile: ExecutionProfile): void
  setProfileOverride(profile: ExecutionProfile | null): void
  setPhoto(photo: ProcessedPhoto): void
  setAnalysis(analysis: FaceAnalysis): void
  setSegmentation(segmentation: SegmentationOutput): void
  setSegmentationStrategy(strategy: SegmentationStrategy): void
  setActiveRegion(region: RegionId | null): void
  /** Ajuste ao vivo (arrasto do slider) — não entra no histórico. */
  previewDeformation(region: RegionId, intensity: number): void
  /** Confirma o estado ao vivo no histórico (soltar o slider). */
  commitDeformation(): void
  undoDeformation(): void
  redoDeformation(): void
  resetDeformations(): void
  clearPhoto(): void
}

export const useSession = create<SessionState>()((set, get) => ({
  originalPhoto: null,
  workingPhoto: null,
  workingPhotoUrl: null,
  photoWidth: null,
  photoHeight: null,

  capabilities: null,
  detectedProfile: null,
  profileOverride: null,
  analysis: null,
  segmentation: null,
  segmentationStrategy: 'auto',
  activeRegion: null,
  deformations: {},
  deformHistory: createHistory<DeformMap>({}),

  setCapabilities: (capabilities, detectedProfile) =>
    set({ capabilities, detectedProfile }),

  setProfileOverride: (profileOverride) => set({ profileOverride }),

  setPhoto: (photo) => {
    const previousUrl = get().workingPhotoUrl
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    set({
      originalPhoto: photo.original,
      workingPhoto: photo.working,
      workingPhotoUrl: URL.createObjectURL(photo.working),
      photoWidth: photo.width,
      photoHeight: photo.height,
      // Foto nova invalida análise, segmentação e deformações anteriores.
      analysis: null,
      segmentation: null,
      activeRegion: null,
      deformations: {},
      deformHistory: createHistory<DeformMap>({}),
    })
  },

  setActiveRegion: (activeRegion) => set({ activeRegion }),

  previewDeformation: (region, intensity) =>
    set((state) => ({ deformations: { ...state.deformations, [region]: intensity } })),

  commitDeformation: () =>
    set((state) => {
      const current = state.deformHistory.present
      const live = state.deformations
      const regions = new Set([...Object.keys(current), ...Object.keys(live)])
      let changed = false
      for (const region of regions) {
        if (current[region as RegionId] !== live[region as RegionId]) {
          changed = true
          break
        }
      }
      if (!changed) return state
      return { deformHistory: commit(state.deformHistory, { ...live }) }
    }),

  undoDeformation: () =>
    set((state) => {
      if (!canUndo(state.deformHistory)) return state
      const history = undo(state.deformHistory)
      return { deformHistory: history, deformations: { ...history.present } }
    }),

  redoDeformation: () =>
    set((state) => {
      if (!canRedo(state.deformHistory)) return state
      const history = redo(state.deformHistory)
      return { deformHistory: history, deformations: { ...history.present } }
    }),

  resetDeformations: () =>
    set((state) => ({
      deformations: {},
      deformHistory: commit(state.deformHistory, {}),
    })),

  setAnalysis: (analysis) => set({ analysis }),

  setSegmentation: (segmentation) => set({ segmentation }),

  // Trocar a estratégia invalida a máscara já calculada.
  setSegmentationStrategy: (segmentationStrategy) =>
    set({ segmentationStrategy, segmentation: null }),

  clearPhoto: () => {
    const previousUrl = get().workingPhotoUrl
    if (previousUrl) URL.revokeObjectURL(previousUrl)
    set({
      originalPhoto: null,
      workingPhoto: null,
      workingPhotoUrl: null,
      photoWidth: null,
      photoHeight: null,
      analysis: null,
      segmentation: null,
      activeRegion: null,
      deformations: {},
      deformHistory: createHistory<DeformMap>({}),
    })
  },
}))

/** Perfil efetivo: override manual vence o detectado; sem nada, o mais seguro. */
export function selectEffectiveProfile(state: {
  detectedProfile: ExecutionProfile | null
  profileOverride: ExecutionProfile | null
}): ExecutionProfile {
  return state.profileOverride ?? state.detectedProfile ?? 'baixo'
}
