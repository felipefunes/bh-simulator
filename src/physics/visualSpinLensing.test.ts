import { describe, expect, it } from 'vitest'
import { criticalImpactParameter } from './orbits'
import { effectiveMassForRay, traceVisualSpinRay } from './visualSpinLensing'
import type { Vec3 } from './vec3'

const SCHW_CRIT = 3 * Math.sqrt(3)
const spinAxis: Vec3 = [0, 1, 0]

describe('effectiveMassForRay', () => {
  it('returns the true mass at zero spin, for any sinAngle', () => {
    expect(effectiveMassForRay(1, 0, 1)).toBe(1)
    expect(effectiveMassForRay(1, 0, -1)).toBe(1)
    expect(effectiveMassForRay(1, 0, 0.5)).toBe(1)
  })

  it('returns the true mass for a polar ray (sinAngle = 0), for any spin', () => {
    expect(effectiveMassForRay(1, 0.9, 0)).toBe(1)
    expect(effectiveMassForRay(1, 1, 0)).toBe(1)
  })

  it('at sinAngle = 1 (fully equatorial, prograde), matches 3√3·mass = the real prograde critical impact parameter', () => {
    const mass = 1
    const spin = 0.9
    const effMass = effectiveMassForRay(mass, spin, 1)
    const bCritReal = Math.abs(criticalImpactParameter({ mass, spin, charge: 0 }, 'prograde')!)
    expect(SCHW_CRIT * effMass).toBeCloseTo(bCritReal)
    expect(effMass).toBeLessThan(mass) // prograde shrinks the effective shadow
  })

  it('at sinAngle = -1 (fully equatorial, retrograde), matches 3√3·mass = the real retrograde critical impact parameter', () => {
    const mass = 1
    const spin = 0.9
    const effMass = effectiveMassForRay(mass, spin, -1)
    const bCritReal = Math.abs(criticalImpactParameter({ mass, spin, charge: 0 }, 'retrograde')!)
    expect(SCHW_CRIT * effMass).toBeCloseTo(bCritReal)
    expect(effMass).toBeGreaterThan(mass) // retrograde grows the effective shadow
  })

  it('interpolates linearly in |sinAngle| between the pole and the equator', () => {
    const mass = 1
    const spin = 0.9
    const atPole = effectiveMassForRay(mass, spin, 0)
    const atEquator = effectiveMassForRay(mass, spin, 1)
    const atHalf = effectiveMassForRay(mass, spin, 0.5)
    expect(atHalf).toBeCloseTo(atPole + (atEquator - atPole) * 0.5)
  })
})

describe('traceVisualSpinRay', () => {
  const mass = 1
  const horizonRadius = 2 * mass

  /** Mirrors kerrLensing.test.ts's equatorialInwardRay, in 3D. */
  function equatorialRay(r0: number, b: number) {
    const sinPsi = Math.abs(b) / r0
    const cosPsi = Math.sqrt(1 - sinPsi * sinPsi)
    const cameraPos: Vec3 = [r0, 0, 0]
    const rayDir: Vec3 = [-cosPsi, 0, Math.sign(b) * sinPsi]
    return { cameraPos, rayDir }
  }

  it('reduces to the plain Schwarzschild capture boundary at zero spin', () => {
    const r0 = 60
    for (const b of [1, 2, 3, 4, 6, 10, 50]) {
      const { cameraPos, rayDir } = equatorialRay(r0, b)
      const result = traceVisualSpinRay({ mass, spin: 0, horizonRadius }, cameraPos, rayDir, spinAxis, {
        maxSteps: 2000,
        dPhi: 0.01,
        maxRadius: 300,
      })
      expect(result.captured).toBe(Math.abs(b) < SCHW_CRIT)
    }
  })

  it('shows the shadow-flattening asymmetry: an equatorial ray is captured prograde but escapes retrograde at the same real-physics threshold', () => {
    const spin = 0.9
    const bCritProgradeRaw = criticalImpactParameter({ mass, spin, charge: 0 }, 'prograde')!
    const bCritRetrogradeRaw = criticalImpactParameter({ mass, spin, charge: 0 }, 'retrograde')!
    const r0 = 60
    const options = { maxSteps: 4000, dPhi: 0.005, maxRadius: 500 }

    // Negating (see criticalImpactParameter's sign convention doc comment)
    // to get the "b" input that puts this ray at sinAngle = +1 (prograde).
    const progradeInside = equatorialRay(r0, -bCritProgradeRaw * 0.9)
    const progradeOutside = equatorialRay(r0, -bCritProgradeRaw * 1.1)
    const retrogradeInside = equatorialRay(r0, -bCritRetrogradeRaw * 0.9)
    const retrogradeOutside = equatorialRay(r0, -bCritRetrogradeRaw * 1.1)

    expect(
      traceVisualSpinRay({ mass, spin, horizonRadius }, progradeInside.cameraPos, progradeInside.rayDir, spinAxis, options)
        .captured,
    ).toBe(true)
    expect(
      traceVisualSpinRay({ mass, spin, horizonRadius }, progradeOutside.cameraPos, progradeOutside.rayDir, spinAxis, options)
        .captured,
    ).toBe(false)
    expect(
      traceVisualSpinRay({ mass, spin, horizonRadius }, retrogradeInside.cameraPos, retrogradeInside.rayDir, spinAxis, options)
        .captured,
    ).toBe(true)
    expect(
      traceVisualSpinRay({ mass, spin, horizonRadius }, retrogradeOutside.cameraPos, retrogradeOutside.rayDir, spinAxis, options)
        .captured,
    ).toBe(false)
  })

  it('a purely polar ray (camera on the spin axis) is unbiased regardless of spin', () => {
    const spin = 0.99
    const r0 = 60
    for (const b of [1, 2, 3, 4, 6, 10]) {
      const sinPsi = b / r0
      const cosPsi = Math.sqrt(1 - sinPsi * sinPsi)
      // Camera directly above the pole (on the spin axis) — cross(cameraPos,
      // rayDir)·spinAxis is exactly 0 for any rayDir when cameraPos is
      // parallel to spinAxis, so sinAngle = 0 by construction. Radial
      // (toward the hole) is -Y here since the camera sits on the Y axis,
      // so the impact-parameter tangential component goes on X instead of Z.
      const cameraPos: Vec3 = [0, r0, 0]
      const rayDir: Vec3 = [sinPsi, -cosPsi, 0]
      const result = traceVisualSpinRay({ mass, spin, horizonRadius }, cameraPos, rayDir, spinAxis, {
        maxSteps: 2000,
        dPhi: 0.01,
        maxRadius: 300,
      })
      expect(result.captured).toBe(b < SCHW_CRIT)
    }
  })

  describe('disk crossing', () => {
    it('still reports a diskHit at the expected radius', () => {
      const spin = 0.9
      const cameraPos: Vec3 = [0, 20, 40]
      const target: Vec3 = [0, 0, 10]
      const diff: Vec3 = [target[0] - cameraPos[0], target[1] - cameraPos[1], target[2] - cameraPos[2]]
      const len = Math.hypot(diff[0], diff[1], diff[2])
      const rayDir: Vec3 = [diff[0] / len, diff[1] / len, diff[2] / len]

      const result = traceVisualSpinRay({ mass, spin, horizonRadius }, cameraPos, rayDir, spinAxis, {
        maxRadius: 2000,
        disk: { innerRadius: 6, outerRadius: 60 },
      })

      expect(result.diskHit).toBeDefined()
      expect(result.diskHit!.radius).toBeCloseTo(10, 0)
      expect(result.diskHit!.position[1]).toBeCloseTo(0, 2)
    })
  })
})
