import { describe, expect, it } from 'vitest'
import { DISK_SUPERSAMPLES, INTEGRATOR_QUALITY, pixelRatioForQuality, type QualityLevel } from './renderQuality'

describe('INTEGRATOR_QUALITY', () => {
  it('keeps steps × stepSize (the total integrated range) constant across levels', () => {
    const levels: QualityLevel[] = ['low', 'medium', 'high']
    const schwTotals = levels.map((level) => INTEGRATOR_QUALITY[level].schwSteps * INTEGRATOR_QUALITY[level].schwDPhi)

    for (const total of schwTotals) expect(total).toBeCloseTo(schwTotals[0], 10)
  })

  it('reproduces the original pre-quality-control constants at "medium"', () => {
    expect(INTEGRATOR_QUALITY.medium.schwSteps).toBe(220)
    expect(INTEGRATOR_QUALITY.medium.schwDPhi).toBe(0.03)
  })

  it('takes fewer Schwarzschild steps at "low" and more at "high" than "medium"', () => {
    expect(INTEGRATOR_QUALITY.low.schwSteps).toBeLessThan(INTEGRATOR_QUALITY.medium.schwSteps)
    expect(INTEGRATOR_QUALITY.high.schwSteps).toBeGreaterThan(INTEGRATOR_QUALITY.medium.schwSteps)
  })

})

describe('DISK_SUPERSAMPLES', () => {
  it('supersamples the disk edge regardless of quality level — not gated like schwSteps', () => {
    // Unlike schwSteps/schwDPhi, this isn't part of IntegratorQuality: it fixes
    // a real aliasing bug (see renderQuality.ts's doc comment), not a
    // fidelity/performance trade-off, so every quality level pays for it.
    expect(DISK_SUPERSAMPLES).toBeGreaterThan(1)
  })
})

describe('pixelRatioForQuality', () => {
  it('caps low quality to 1x regardless of display density', () => {
    expect(pixelRatioForQuality('low', 1)).toBe(1)
    expect(pixelRatioForQuality('low', 3)).toBe(1)
  })

  it('never upscales past the display\'s real devicePixelRatio', () => {
    expect(pixelRatioForQuality('high', 1)).toBe(1)
    expect(pixelRatioForQuality('medium', 1)).toBe(1)
  })

  it('orders low <= medium <= high for the same display density', () => {
    const dpr = 3
    expect(pixelRatioForQuality('low', dpr)).toBeLessThanOrEqual(pixelRatioForQuality('medium', dpr))
    expect(pixelRatioForQuality('medium', dpr)).toBeLessThanOrEqual(pixelRatioForQuality('high', dpr))
  })
})
