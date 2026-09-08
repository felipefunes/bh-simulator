import { describe, expect, it } from 'vitest'
import { criticalImpactParameter } from './orbits'
import { retrogradeCriticalImpactParameter, traceVisualSpinRay } from './visualSpinLensing'
import type { Vec3 } from './vec3'

const SCHW_CRIT = 3 * Math.sqrt(3)
const spinAxis: Vec3 = [0, 1, 0]

describe('retrogradeCriticalImpactParameter', () => {
  it('returns the plain Schwarzschild value at zero spin, for any sinAngle', () => {
    expect(retrogradeCriticalImpactParameter(1, 0, -1)).toBeCloseTo(SCHW_CRIT)
    expect(retrogradeCriticalImpactParameter(1, 0, 1)).toBeCloseTo(SCHW_CRIT)
    expect(retrogradeCriticalImpactParameter(1, 0, -0.5)).toBeCloseTo(SCHW_CRIT)
  })

  it('returns the plain Schwarzschild value for prograde and polar rays (sinAngle >= 0), for any spin', () => {
    expect(retrogradeCriticalImpactParameter(1, 0.9, 0)).toBeCloseTo(SCHW_CRIT)
    expect(retrogradeCriticalImpactParameter(1, 0.9, 1)).toBeCloseTo(SCHW_CRIT)
    expect(retrogradeCriticalImpactParameter(1, 1, 0.5)).toBeCloseTo(SCHW_CRIT)
  })

  it('at sinAngle = -1 (fully equatorial, retrograde), matches the real retrograde critical impact parameter exactly', () => {
    const mass = 1
    const spin = 0.9
    const bCritReal = Math.abs(criticalImpactParameter({ mass, spin, charge: 0 }, 'retrograde')!)
    expect(retrogradeCriticalImpactParameter(mass, spin, -1)).toBeCloseTo(bCritReal)
  })

  it('only ever grows the threshold — never below the Schwarzschild value', () => {
    const mass = 1
    const spin = 0.9
    for (const sinAngle of [-1, -0.75, -0.5, -0.25]) {
      expect(retrogradeCriticalImpactParameter(mass, spin, sinAngle)).toBeGreaterThanOrEqual(SCHW_CRIT * mass)
    }
  })

  it('interpolates smoothly (sinAngle²) between the pole and the equator', () => {
    const mass = 1
    const spin = 0.9
    const atPole = retrogradeCriticalImpactParameter(mass, spin, 0)
    const atEquator = retrogradeCriticalImpactParameter(mass, spin, -1)
    const atHalf = retrogradeCriticalImpactParameter(mass, spin, -0.5)
    expect(atHalf).toBeCloseTo(atPole + (atEquator - atPole) * 0.25)
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

  it('prograde rays are unbiased — same Schwarzschild capture boundary as spin=0, even at high spin', () => {
    // Deliberate trade-off (see this module's file-level comment): only the
    // retrograde side grows. A prograde ray between the real prograde
    // critical value (which the first, reverted version of this module
    // would have shrunk the shadow to) and the plain Schwarzschild value
    // should now escape, not be captured — the shadow never shrinks here.
    const spin = 0.9
    const bCritProgradeRaw = Math.abs(criticalImpactParameter({ mass, spin, charge: 0 }, 'prograde')!)
    const r0 = 60
    const options = { maxSteps: 4000, dPhi: 0.005, maxRadius: 500 }

    // Negating (see criticalImpactParameter's sign convention doc comment)
    // to get the "b" input that puts this ray at sinAngle = +1 (prograde).
    const betweenRealAndSchwarzschild = equatorialRay(r0, -(bCritProgradeRaw + SCHW_CRIT) / 2)
    const wellInsideSchwarzschild = equatorialRay(r0, -SCHW_CRIT * 0.5)
    const wellOutsideSchwarzschild = equatorialRay(r0, -SCHW_CRIT * 1.5)

    expect(
      traceVisualSpinRay(
        { mass, spin, horizonRadius },
        betweenRealAndSchwarzschild.cameraPos,
        betweenRealAndSchwarzschild.rayDir,
        spinAxis,
        options,
      ).captured,
    ).toBe(true) // still inside the (unbiased) Schwarzschild threshold
    expect(
      traceVisualSpinRay({ mass, spin, horizonRadius }, wellInsideSchwarzschild.cameraPos, wellInsideSchwarzschild.rayDir, spinAxis, options)
        .captured,
    ).toBe(true)
    expect(
      traceVisualSpinRay({ mass, spin, horizonRadius }, wellOutsideSchwarzschild.cameraPos, wellOutsideSchwarzschild.rayDir, spinAxis, options)
        .captured,
    ).toBe(false)
  })

  it('retrograde rays show the (one-sided) shadow growth: captured between the Schwarzschild and real retrograde thresholds', () => {
    const spin = 0.9
    const bCritRetrogradeRaw = Math.abs(criticalImpactParameter({ mass, spin, charge: 0 }, 'retrograde')!)
    const r0 = 60
    const options = { maxSteps: 4000, dPhi: 0.005, maxRadius: 500 }

    // Positive b (unnegated) puts the ray at sinAngle = -1 (retrograde) —
    // see criticalImpactParameter's sign convention doc comment.
    const betweenSchwarzschildAndReal = equatorialRay(r0, (SCHW_CRIT + bCritRetrogradeRaw) / 2)
    const wellOutsideReal = equatorialRay(r0, bCritRetrogradeRaw * 1.2)

    expect(
      traceVisualSpinRay(
        { mass, spin, horizonRadius },
        betweenSchwarzschildAndReal.cameraPos,
        betweenSchwarzschildAndReal.rayDir,
        spinAxis,
        options,
      ).captured,
    ).toBe(true) // grown shadow catches this one, unlike plain Schwarzschild
    expect(
      traceVisualSpinRay({ mass, spin, horizonRadius }, wellOutsideReal.cameraPos, wellOutsideReal.rayDir, spinAxis, options).captured,
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
