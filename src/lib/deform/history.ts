/**
 * Histórico linear de desfazer/refazer — puro e genérico.
 * `present` é o último estado CONFIRMADO; edições ao vivo ficam fora daqui
 * e só entram via commit (soltar o slider).
 */

export interface History<T> {
  past: readonly T[]
  present: T
  future: readonly T[]
}

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [] }
}

/** Confirma um novo estado; ramo de redo é descartado. */
export function commit<T>(history: History<T>, next: T): History<T> {
  return { past: [...history.past, history.present], present: next, future: [] }
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history
  const previous = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history
  const [next, ...rest] = history.future
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  }
}
