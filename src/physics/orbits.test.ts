import { describe, expect, it } from 'vitest'
import { criticalImpactParameter, iscoRadius, photonSphereRadius } from './orbits'

describe('photonSphereRadius', () => {
  it('gives 3M for Schwarzschild', () => {
    expect(photonSphereRadius({ mass: 1, spin: 0, charge: 0 })).toBeCloseTo(3)
  })

  it('shrinks with charge for Reissner-Nordstrom', () => {
    const expected = (3 + Math.sqrt(9 - 8 * 0.5 ** 2)) / 2
    expect(photonSphereRadius({ mass: 1, spin: 0, charge: 0.5 })).toBeCloseTo(expected)
  })

  it('shrinks to M for an extremal prograde Kerr orbit', () => {
    expect(
      photonSphereRadius({ mass: 1, spin: 1, charge: 0 }, 'prograde'),
    ).toBeCloseTo(1)
  })

  it('grows to 4M for an extremal retrograde Kerr orbit', () => {
    expect(
      photonSphereRadius({ mass: 1, spin: 1, charge: 0 }, 'retrograde'),
    ).toBeCloseTo(4)
  })

  it('returns null for a general Kerr-Newman hole (spin and charge both nonzero)', () => {
    expect(photonSphereRadius({ mass: 1, spin: 0.5, charge: 0.5 })).toBeNull()
  })
})

describe('iscoRadius', () => {
  it('gives 6M for Schwarzschild', () => {
    expect(iscoRadius({ mass: 1, spin: 0, charge: 0 })).toBeCloseTo(6)
  })

  it('shrinks to M for an extremal prograde Kerr orbit', () => {
    expect(iscoRadius({ mass: 1, spin: 1, charge: 0 }, 'prograde')).toBeCloseTo(1)
  })

  it('grows to 9M for an extremal retrograde Kerr orbit', () => {
    expect(iscoRadius({ mass: 1, spin: 1, charge: 0 }, 'retrograde')).toBeCloseTo(9)
  })

  it('agrees with Schwarzschild in both directions at zero spin', () => {
    expect(iscoRadius({ mass: 1, spin: 0, charge: 0 }, 'retrograde')).toBeCloseTo(6)
  })

  it('returns null whenever charge is nonzero', () => {
    expect(iscoRadius({ mass: 1, spin: 0, charge: 0.5 })).toBeNull()
    expect(iscoRadius({ mass: 1, spin: 0.5, charge: 0.5 })).toBeNull()
  })
})

describe('criticalImpactParameter', () => {
  it('gives the Schwarzschild value 3√3 M at zero spin/charge', () => {
    const expected = 3 * Math.sqrt(3)
    expect(criticalImpactParameter({ mass: 1, spin: 0, charge: 0 })).toBeCloseTo(expected)
    expect(criticalImpactParameter({ mass: 1, spin: 0, charge: 0 }, 'retrograde')).toBeCloseTo(expected)
  })

  it('matches the direction-independent Reissner-Nordström formula at zero spin', () => {
    const rph = photonSphereRadius({ mass: 1, spin: 0, charge: 0.5 })!
    const expected = Math.sqrt((2 * rph ** 3) / (rph - 1))
    expect(criticalImpactParameter({ mass: 1, spin: 0, charge: 0.5 })).toBeCloseTo(expected)
  })

  it('is smaller prograde than retrograde for a spinning hole (frame-dragging asymmetry)', () => {
    const prograde = Math.abs(criticalImpactParameter({ mass: 1, spin: 0.9, charge: 0 }, 'prograde')!)
    const retrograde = Math.abs(criticalImpactParameter({ mass: 1, spin: 0.9, charge: 0 }, 'retrograde')!)
    expect(prograde).toBeLessThan(3 * Math.sqrt(3))
    expect(retrograde).toBeGreaterThan(3 * Math.sqrt(3))
    expect(prograde).toBeLessThan(retrograde)
  })

  it('approaches the known extremal values (prograde 2M, retrograde 7M)', () => {
    const prograde = Math.abs(criticalImpactParameter({ mass: 1, spin: 1, charge: 0 }, 'prograde')!)
    const retrograde = Math.abs(criticalImpactParameter({ mass: 1, spin: 1, charge: 0 }, 'retrograde')!)
    expect(prograde).toBeCloseTo(2, 1)
    expect(retrograde).toBeCloseTo(7, 1)
    expect(Number.isFinite(prograde)).toBe(true)
  })

  it('returns null for a general Kerr-Newman hole (spin and charge both nonzero)', () => {
    expect(criticalImpactParameter({ mass: 1, spin: 0.5, charge: 0.5 })).toBeNull()
  })
})
