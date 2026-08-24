import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, commit, createHistory, redo, undo } from './history'

describe('history', () => {
  it('estado inicial não desfaz nem refaz', () => {
    const h = createHistory('a')
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
    expect(undo(h)).toBe(h)
    expect(redo(h)).toBe(h)
  })

  it('commit empilha e limpa o redo', () => {
    let h = createHistory('a')
    h = commit(h, 'b')
    h = undo(h)
    expect(canRedo(h)).toBe(true)
    h = commit(h, 'c')
    expect(canRedo(h)).toBe(false)
    expect(h.present).toBe('c')
    expect(h.past).toEqual(['a'])
  })

  it('undo/redo são inversos e preservam a sequência', () => {
    let h = createHistory('a')
    h = commit(h, 'b')
    h = commit(h, 'c')

    h = undo(h)
    expect(h.present).toBe('b')
    h = undo(h)
    expect(h.present).toBe('a')
    expect(canUndo(h)).toBe(false)

    h = redo(h)
    expect(h.present).toBe('b')
    h = redo(h)
    expect(h.present).toBe('c')
    expect(canRedo(h)).toBe(false)
  })
})
