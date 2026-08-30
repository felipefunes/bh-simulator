import { describe, expect, it } from 'vitest'
import { traceSchwarzschildRay } from './lensing'

const mass = 1
const horizonRadius = 2 * mass
// b_crit = 3√3 M ≈ 5.196M — the critical impact parameter separating capture
// from escape, matching photonSphereRadius(3M) / sqrt(1 - 2M/3M).
const CRITICAL_IMPACT_PARAMETER = 3 * Math.sqrt(3)

/**
 * Initial (rdRadial, rdTangential) for a ray starting at r0 (assumed large,
 * i.e. in the flat-space regime) with impact parameter b, aimed inward.
 * b ≈ r0·sin(ψ) is exact in flat space and an excellent approximation at
 * large r0, which is all that's needed to set up a physically meaningful
 * test input.
 */
function inwardRayFromImpactParameter(r0: number, b: number) {
  const sinPsi = b / r0
  const cosPsi = Math.sqrt(1 - sinPsi * sinPsi)
  return { rdRadial: -cosPsi, rdTangential: sinPsi }
}

describe('traceSchwarzschildRay', () => {
  it('captures a ray aimed well inside the critical impact parameter', () => {
    const { rdRadial, rdTangential } = inwardRayFromImpactParameter(1000, 2)
    const result = traceSchwarzschildRay({ mass, horizonRadius }, 1000, rdRadial, rdTangential)
    expect(result.captured).toBe(true)
  })

  it('escapes a ray aimed well outside the critical impact parameter', () => {
    const { rdRadial, rdTangential } = inwardRayFromImpactParameter(1000, 50)
    const result = traceSchwarzschildRay({ mass, horizonRadius }, 1000, rdRadial, rdTangential, {
      maxRadius: 2000,
    })
    expect(result.captured).toBe(false)
  })

  // Right at b_crit, a ray spends a long time (large Δφ) spiraling near the
  // photon sphere before resolving either way, so these need a much bigger
  // step budget than the shader's real-time default to actually resolve.
  const NEAR_CRITICAL_OPTIONS = { maxSteps: 2000, dPhi: 0.01, maxRadius: 5000 }

  it('captures a ray just inside the critical impact parameter', () => {
    const { rdRadial, rdTangential } = inwardRayFromImpactParameter(
      1000,
      CRITICAL_IMPACT_PARAMETER * 0.99,
    )
    const result = traceSchwarzschildRay(
      { mass, horizonRadius },
      1000,
      rdRadial,
      rdTangential,
      NEAR_CRITICAL_OPTIONS,
    )
    expect(result.captured).toBe(true)
  })

  it('escapes a ray just outside the critical impact parameter', () => {
    const { rdRadial, rdTangential } = inwardRayFromImpactParameter(
      1000,
      CRITICAL_IMPACT_PARAMETER * 1.005,
    )
    const result = traceSchwarzschildRay(
      { mass, horizonRadius },
      1000,
      rdRadial,
      rdTangential,
      NEAR_CRITICAL_OPTIONS,
    )
    expect(result.captured).toBe(false)
  })

  it('matches the weak-field deflection angle (δφ ≈ 4M/b) for a large impact parameter', () => {
    const b = 500
    const r0 = 2000
    const { rdRadial, rdTangential } = inwardRayFromImpactParameter(r0, b)
    const result = traceSchwarzschildRay({ mass, horizonRadius }, r0, rdRadial, rdTangential, {
      maxSteps: 2000,
      dPhi: 0.01,
      maxRadius: 10000,
    })

    expect(result.captured).toBe(false)
    const { e1, e2 } = result.direction!
    // Deflection = angle between the escaping direction and the direction
    // the ray would still be heading if it had traveled in a straight line.
    const deflection = Math.acos(rdRadial * e1 + rdTangential * e2)
    expect(deflection).toBeCloseTo(4 * mass / b, 2)
  })

  it('captures a radial ray aimed straight at the black hole', () => {
    const result = traceSchwarzschildRay({ mass, horizonRadius }, 10, -1, 0)
    expect(result.captured).toBe(true)
  })

  it('does not deflect a radial ray heading straight away', () => {
    const result = traceSchwarzschildRay({ mass, horizonRadius }, 10, 1, 0)
    expect(result.captured).toBe(false)
    expect(result.direction).toEqual({ e1: 1, e2: 0 })
  })
})
