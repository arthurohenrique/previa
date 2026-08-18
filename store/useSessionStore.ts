'use client'

import { create } from 'zustand'
import { useStore } from 'zustand'
import { temporal } from 'zundo'
import {
  anchorIndexFor,
  buildRegionInstances,
  type RegionId,
  type RegionInstance,
  type Side,
} from '@/lib/face/atlas'
import { applyIpdOffset, offsetToIpd } from '@/lib/face/scale'
import { newId } from '@/lib/id'
import type { FaceGeometry, Point2 } from '@/lib/face/types'
import { clamp, clampRadius } from '@/lib/warp/clamps'
import { MAX_APPLICATIONS } from '@/lib/warp/filters/constants'
import type { ResolvedApplication } from '@/lib/warp/types'
import type { Technique } from '@/lib/supabase/types'

/**
 * Estado da sessão de simulação.
 *
 * O undo/redo é requisito, não extra: o profissional marca na frente do
 * paciente e precisa poder voltar sem refazer a sessão. O `zundo` só acompanha
 * a lista de aplicações — geometria e seleção fora do histórico, senão desfazer
 * mexeria na foto ou no que está selecionado, que ninguém espera.
 */

export interface SessionApplication {
  id: string
  regionId: RegionId
  side: Side
  regionKey: string
  technique: Technique
  /** Landmark âncora. A posição é reconstruída a partir dele (D-07). */
  anchorLandmark: number
  /** Deslocamento da âncora, em fração de DIP. */
  anchorOffsetU: number
  anchorOffsetV: number
  /** Adimensional 0..1. Não é dose. */
  intensity: number
  /** Fração de DIP. Nunca pixel. */
  radiusIpd: number
  createdAt: number
}

interface SessionState {
  geometry: FaceGeometry | null
  regionInstances: RegionInstance[]
  applications: SessionApplication[]
  selectedId: string | null
  activeTechnique: Technique
  /** Mensagem curta de limite atingido, para a interface mostrar e limpar. */
  notice: string | null

  setGeometry: (geometry: FaceGeometry) => void
  setActiveTechnique: (technique: Technique) => void
  select: (id: string | null) => void
  clearNotice: () => void

  addApplication: (input: {
    instance: RegionInstance
    point: Point2
    technique: Technique
    intensity: number
    radiusIpd: number
  }) => string | null
  setIntensity: (id: string, intensity: number) => void
  setRadius: (id: string, radiusIpd: number) => void
  moveApplication: (id: string, point: Point2) => void
  removeApplication: (id: string) => void
  reset: () => void
  hydrate: (applications: SessionApplication[]) => void
}

export const useSessionStore = create<SessionState>()(
  temporal(
    (set, get) => ({
      geometry: null,
      regionInstances: [],
      applications: [],
      selectedId: null,
      activeTechnique: 'filler',
      notice: null,

      setGeometry(geometry) {
        set({
          geometry,
          regionInstances: buildRegionInstances(
            geometry.landmarks,
            geometry.width / geometry.height,
          ),
        })
      },

      setActiveTechnique(technique) {
        set({ activeTechnique: technique })
      },

      select(id) {
        set({ selectedId: id })
      },

      clearNotice() {
        set({ notice: null })
      },

      addApplication({ instance, point, technique, intensity, radiusIpd }) {
        const { geometry, applications } = get()
        if (!geometry) return null

        if (applications.length >= MAX_APPLICATIONS) {
          set({ notice: `Limite de ${MAX_APPLICATIONS} aplicações por prévia.` })
          return null
        }

        if (!instance.region.techniques.includes(technique)) {
          set({ notice: `${instance.region.label} não recebe esta técnica.` })
          return null
        }

        const anchorLandmark = anchorIndexFor(instance.region, instance.side)
        const anchor = geometry.landmarks[anchorLandmark]
        if (!anchor) return null

        const offset = offsetToIpd(
          anchor,
          point,
          geometry.width,
          geometry.height,
          geometry.ipdPx,
        )

        const application: SessionApplication = {
          id: newId(),
          regionId: instance.region.id,
          side: instance.side,
          regionKey: instance.key,
          technique,
          anchorLandmark,
          anchorOffsetU: offset.x,
          anchorOffsetV: offset.y,
          intensity: clamp(intensity, 0, 1),
          radiusIpd: clampRadius(radiusIpd, instance.region.id, technique),
          createdAt: Date.now(),
        }

        set({ applications: [...applications, application], selectedId: application.id })
        return application.id
      },

      setIntensity(id, intensity) {
        set({
          applications: get().applications.map((application) =>
            application.id === id
              ? { ...application, intensity: clamp(intensity, 0, 1) }
              : application,
          ),
        })
      },

      setRadius(id, radiusIpd) {
        set({
          applications: get().applications.map((application) =>
            application.id === id
              ? {
                  ...application,
                  radiusIpd: clampRadius(radiusIpd, application.regionId, application.technique),
                }
              : application,
          ),
        })
      },

      moveApplication(id, point) {
        const { geometry, applications } = get()
        if (!geometry) return

        set({
          applications: applications.map((application) => {
            if (application.id !== id) return application
            const anchor = geometry.landmarks[application.anchorLandmark]
            if (!anchor) return application
            const offset = offsetToIpd(
              anchor,
              point,
              geometry.width,
              geometry.height,
              geometry.ipdPx,
            )
            return { ...application, anchorOffsetU: offset.x, anchorOffsetV: offset.y }
          }),
        })
      },

      removeApplication(id) {
        set((state) => ({
          applications: state.applications.filter((application) => application.id !== id),
          selectedId: state.selectedId === id ? null : state.selectedId,
        }))
      },

      reset() {
        set({ applications: [], selectedId: null, notice: null })
      },

      hydrate(applications) {
        set({ applications, selectedId: null })
      },
    }),
    {
      // Só a lista de aplicações entra no histórico.
      partialize: (state) => ({ applications: state.applications }),
      limit: 100,
      equality: (a, b) => a.applications === b.applications,
    },
  ),
)

/** Posição atual da aplicação, reconstruída da âncora. */
export function resolvePoint(
  application: SessionApplication,
  geometry: FaceGeometry,
): Point2 | null {
  const anchor = geometry.landmarks[application.anchorLandmark]
  if (!anchor) return null
  return applyIpdOffset(
    anchor,
    { x: application.anchorOffsetU, y: application.anchorOffsetV },
    geometry.width,
    geometry.height,
    geometry.ipdPx,
  )
}

/** Converte o estado para o formato que o pipeline de warp consome. */
export function resolveApplications(
  applications: readonly SessionApplication[],
  geometry: FaceGeometry,
): ResolvedApplication[] {
  const resolved: ResolvedApplication[] = []

  for (const application of applications) {
    const point = resolvePoint(application, geometry)
    if (!point) continue
    resolved.push({
      id: application.id,
      regionId: application.regionId,
      side: application.side,
      regionKey: application.regionKey,
      technique: application.technique,
      u: point.x,
      v: point.y,
      radiusIpd: application.radiusIpd,
      intensity: application.intensity,
    })
  }

  return resolved
}

interface TemporalSlice {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

/**
 * Undo/redo prontos para a barra de ferramentas.
 *
 * Os seletores devolvem booleanos, não objetos: `useSyncExternalStore` compara
 * o snapshot por identidade, e devolver um objeto novo a cada render entra em
 * laço infinito.
 */
export function useTemporalSession(): TemporalSlice {
  const canUndo = useStore(useSessionStore.temporal, (state) => state.pastStates.length > 0)
  const canRedo = useStore(useSessionStore.temporal, (state) => state.futureStates.length > 0)

  return {
    canUndo,
    canRedo,
    undo: () => useSessionStore.temporal.getState().undo(),
    redo: () => useSessionStore.temporal.getState().redo(),
  }
}
