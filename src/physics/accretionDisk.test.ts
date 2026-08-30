import { describe, expect, it } from 'vitest'
import {
  PEAK_TEMPERATURE_KELVIN,
  blackbodyColor,
  combinedRedshiftFactor,
  diskTemperature,
  dopplerFactor,
  orbitalSpeed,
} from './accretionDisk'

describe('diskTemperature', () => {
  const innerRadius = 6 // e.g. Schwarzschild ISCO at M=1

  it('is zero at and inside the inner edge', () => {
    expect(diskTemperature(innerRadius, innerRadius)).toBe(0)
    expect(diskTemperature(innerRadius, innerRadius * 0.5)).toBe(0)
  })

  it('peaks at r = 49/36 * r_in (Shakura-Sunyaev), not at the inner edge itself', () => {
    const peakRadius = innerRadius * (49 / 36)
    const atPeak = diskTemperature(innerRadius, peakRadius)
    const justInside = diskTemperature(innerRadius, peakRadius * 0.9)
    const justOutside = diskTemperature(innerRadius, peakRadius * 1.1)

    expect(atPeak).toBeCloseTo(PEAK_TEMPERATURE_KELVIN)
    expect(atPeak).toBeGreaterThan(justInside)
    expect(atPeak).toBeGreaterThan(justOutside)
  })

  it('decreases monotonically far beyond the peak', () => {
    const a = diskTemperature(innerRadius, innerRadius * 5)
    const b = diskTemperature(innerRadius, innerRadius * 10)
    const c = diskTemperature(innerRadius, innerRadius * 20)
    expect(a).toBeGreaterThan(b)
    expect(b).toBeGreaterThan(c)
  })
})

describe('blackbodyColor', () => {
  it('is reddish/orange at low temperatures', () => {
    const [r, g, b] = blackbodyColor(2000)
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
  })

  it('is roughly neutral (white) near 6600K', () => {
    const [r, g, b] = blackbodyColor(6600)
    expect(Math.abs(r - g)).toBeLessThan(0.1)
    expect(Math.abs(g - b)).toBeLessThan(0.1)
  })

  it('is blue-white at high temperatures (blue channel saturated, red below green)', () => {
    const [r, g, b] = blackbodyColor(20000)
    expect(b).toBeCloseTo(1)
    expect(r).toBeLessThan(g)
  })
})

describe('orbitalSpeed', () => {
  const mass = 1

  it('is exactly 0.5c at the ISCO (r=6M) — a standard, well-known checkpoint', () => {
    expect(orbitalSpeed(mass, 6)).toBeCloseTo(0.5)
  })

  it('is exactly c at the photon sphere (r=3M)', () => {
    expect(orbitalSpeed(mass, 3)).toBeCloseTo(1)
  })

  it('decreases with radius', () => {
    expect(orbitalSpeed(mass, 10)).toBeLessThan(orbitalSpeed(mass, 6))
  })
})

describe('combinedRedshiftFactor / dopplerFactor', () => {
  const mass = 1
  const r = 10

  it('blueshifts (D > 1) when approaching the observer (positive betaLineOfSight)', () => {
    const beta = orbitalSpeed(mass, r)
    expect(dopplerFactor(mass, r, beta)).toBeGreaterThan(1)
  })

  it('redshifts (D < 1) when receding from the observer (negative betaLineOfSight)', () => {
    const beta = orbitalSpeed(mass, r)
    expect(dopplerFactor(mass, r, -beta)).toBeLessThan(1)
  })

  it('is symmetric in the sense that approaching and receding bracket the transverse case', () => {
    const beta = orbitalSpeed(mass, r)
    const transverse = dopplerFactor(mass, r, 0)
    expect(dopplerFactor(mass, r, beta)).toBeGreaterThan(transverse)
    expect(dopplerFactor(mass, r, -beta)).toBeLessThan(transverse)
  })

  it('reduces to pure gravitational redshift in the flat/non-orbiting limit (beta=0 orbital speed)', () => {
    // At very large r, orbital speed -> 0, so the transverse term vanishes
    // and only the gravitational sqrt(1-2M/r) factor remains.
    const largeR = 100000
    expect(combinedRedshiftFactor(mass, largeR, 0)).toBeCloseTo(1, 3)
  })
})
