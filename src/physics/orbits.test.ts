import { describe, expect, it } from 'vitest'
import { iscoRadius, photonSphereRadius } from './orbits'

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
