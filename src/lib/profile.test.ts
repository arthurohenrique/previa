import { describe, expect, it } from 'vitest'
import { pickProfile, type DeviceCapabilities } from './profile'

const caps = (partial: Partial<DeviceCapabilities>): DeviceCapabilities => ({
  webgpu: false,
  cores: 4,
  memoryGB: null,
  ...partial,
})

describe('pickProfile', () => {
  it('escolhe alto com WebGPU e 8+ cores', () => {
    expect(pickProfile(caps({ webgpu: true, cores: 8 }))).toBe('alto')
    expect(pickProfile(caps({ webgpu: true, cores: 16, memoryGB: 16 }))).toBe('alto')
  })

  it('sem WebGPU nunca é alto, mesmo com muitos cores', () => {
    expect(pickProfile(caps({ webgpu: false, cores: 16 }))).toBe('medio')
  })

  it('WebGPU com poucos cores fica em médio', () => {
    expect(pickProfile(caps({ webgpu: true, cores: 4 }))).toBe('medio')
  })

  it('menos de 4 cores é baixo', () => {
    expect(pickProfile(caps({ cores: 2 }))).toBe('baixo')
    expect(pickProfile(caps({ cores: 3, webgpu: true }))).toBe('baixo')
  })

  it('memória ≤ 2 GB força baixo, independente do resto', () => {
    expect(pickProfile(caps({ webgpu: true, cores: 8, memoryGB: 2 }))).toBe('baixo')
    expect(pickProfile(caps({ webgpu: true, cores: 16, memoryGB: 1 }))).toBe('baixo')
  })

  it('memória desconhecida (null) não penaliza', () => {
    expect(pickProfile(caps({ webgpu: true, cores: 8, memoryGB: null }))).toBe('alto')
  })
})
