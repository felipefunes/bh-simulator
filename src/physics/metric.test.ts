import { describe, expect, it } from 'vitest'
import {
  classify,
  ergosphereEquatorialRadius,
  horizonRadii,
  isNakedSingularity,
} from './metric'

describe('classify', () => {
  it('is schwarzschild with no spin or charge', () => {
    expect(classify({ spin: 0, charge: 0 })).toBe('schwarzschild')
  })

  it('is kerr with spin only', () => {
    expect(classify({ spin: 0.5, charge: 0 })).toBe('kerr')
  })

  it('is reissner-nordstrom with charge only', () => {
    expect(classify({ spin: 0, charge: 0.5 })).toBe('reissner-nordstrom')
  })

  it('is kerr-newman with both spin and charge', () => {
    expect(classify({ spin: 0.5, charge: 0.5 })).toBe('kerr-newman')
  })
})

describe('isNakedSingularity', () => {
  it('is false for a valid black hole', () => {
    expect(isNakedSingularity({ mass: 1, spin: 0.5, charge: 0.5 })).toBe(false)
  })

  it('is false exactly at the extremal bound', () => {
    expect(isNakedSingularity({ mass: 1, spin: 0.6, charge: 0.8 })).toBe(false)
  })

  it('is true when spin and charge overdrive the mass', () => {
    expect(isNakedSingularity({ mass: 1, spin: 0.9, charge: 0.9 })).toBe(true)
  })
})

describe('horizonRadii', () => {
  it('gives the Schwarzschild radius (2M) with no spin or charge', () => {
    const horizons = horizonRadii({ mass: 1, spin: 0, charge: 0 })
    expect(horizons?.outer).toBeCloseTo(2)
    expect(horizons?.inner).toBeCloseTo(0)
  })

  it('degenerates to a single horizon at the extremal Reissner-Nordstrom bound', () => {
    const horizons = horizonRadii({ mass: 1, spin: 0, charge: 1 })
    expect(horizons?.outer).toBeCloseTo(1)
    expect(horizons?.inner).toBeCloseTo(1)
  })

  it('degenerates to a single horizon at the extremal Kerr bound', () => {
    const horizons = horizonRadii({ mass: 1, spin: 1, charge: 0 })
    expect(horizons?.outer).toBeCloseTo(1)
    expect(horizons?.inner).toBeCloseTo(1)
  })

  it('splits into two horizons for a generic Kerr-Newman hole', () => {
    const horizons = horizonRadii({ mass: 1, spin: 0.6, charge: 0.3 })
    expect(horizons?.outer).toBeCloseTo(1 + Math.sqrt(1 - 0.36 - 0.09))
    expect(horizons?.inner).toBeCloseTo(1 - Math.sqrt(1 - 0.36 - 0.09))
  })

  it('returns null for a naked singularity', () => {
    expect(horizonRadii({ mass: 1, spin: 0.9, charge: 0.9 })).toBeNull()
  })
})

describe('ergosphereEquatorialRadius', () => {
  it('gives 2M for Schwarzschild', () => {
    expect(ergosphereEquatorialRadius({ mass: 1, charge: 0 })).toBeCloseTo(2)
  })

  it('shrinks with charge, independent of spin', () => {
    expect(ergosphereEquatorialRadius({ mass: 1, charge: 0.6 })).toBeCloseTo(1.8)
  })

  it('returns null once charge alone exceeds the mass', () => {
    expect(ergosphereEquatorialRadius({ mass: 1, charge: 1.1 })).toBeNull()
  })
})
