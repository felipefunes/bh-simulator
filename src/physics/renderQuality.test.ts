import { describe, expect, it } from 'vitest'
import { INTEGRATOR_QUALITY, pixelRatioForQuality, type QualityLevel } from './renderQuality'

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

  it('only supersamples the disk edge at "high" — "low"/"medium" stay at the original single-ray cost', () => {
    expect(INTEGRATOR_QUALITY.low.diskSupersamples).toBe(1)
    expect(INTEGRATOR_QUALITY.medium.diskSupersamples).toBe(1)
    expect(INTEGRATOR_QUALITY.high.diskSupersamples).toBeGreaterThan(1)
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
