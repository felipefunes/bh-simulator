import { describe, expect, it } from 'vitest'
import { INTEGRATOR_QUALITY, pixelRatioForQuality, type QualityLevel } from './renderQuality'

describe('INTEGRATOR_QUALITY', () => {
  it('keeps steps × stepSize (the total integrated range) constant across levels', () => {
    const levels: QualityLevel[] = ['low', 'medium', 'high']
    const kerrTotals = levels.map((level) => INTEGRATOR_QUALITY[level].kerrSteps * INTEGRATOR_QUALITY[level].kerrDTau)
    const schwTotals = levels.map((level) => INTEGRATOR_QUALITY[level].schwSteps * INTEGRATOR_QUALITY[level].schwDPhi)

    for (const total of kerrTotals) expect(total).toBeCloseTo(kerrTotals[0], 10)
    for (const total of schwTotals) expect(total).toBeCloseTo(schwTotals[0], 10)
  })

  it('reproduces the original pre-quality-control constants at "medium"', () => {
    expect(INTEGRATOR_QUALITY.medium).toEqual({ kerrSteps: 2200, kerrDTau: 0.0007, schwSteps: 220, schwDPhi: 0.03 })
  })

  it('takes fewer steps at "low" and more at "high" than "medium", for both tracers', () => {
    expect(INTEGRATOR_QUALITY.low.kerrSteps).toBeLessThan(INTEGRATOR_QUALITY.medium.kerrSteps)
    expect(INTEGRATOR_QUALITY.high.kerrSteps).toBeGreaterThan(INTEGRATOR_QUALITY.medium.kerrSteps)
    expect(INTEGRATOR_QUALITY.low.schwSteps).toBeLessThan(INTEGRATOR_QUALITY.medium.schwSteps)
    expect(INTEGRATOR_QUALITY.high.schwSteps).toBeGreaterThan(INTEGRATOR_QUALITY.medium.schwSteps)
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
