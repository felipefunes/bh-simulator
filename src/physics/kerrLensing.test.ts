import { describe, expect, it } from 'vitest'
import { photonSphereRadius } from './orbits'
import { traceKerrRay } from './kerrLensing'
import { traceSchwarzschildRay } from './lensing'

const mass = 1
const spinAxis = [0, 1, 0] as const

/** Equatorial camera position + inward ray direction with impact parameter b. */
function equatorialInwardRay(r0: number, b: number) {
  const sinPsi = Math.abs(b) / r0
  const cosPsi = Math.sqrt(1 - sinPsi * sinPsi)
  const cameraPos = [r0, 0, 0] as const
  // Sign of b picks which tangential sense (prograde/retrograde relative to
  // +spinAxis) the ray heads in — see traceKerrRay's L = impactVec·spinAxis.
  const rayDir = [-cosPsi, 0, Math.sign(b) * sinPsi] as const
  return { cameraPos, rayDir }
}

/**
 * Exact critical impact parameter for an equatorial Kerr photon orbit, from
 * the double-root condition R(r_ph) = R'(r_ph) = 0, solved for L in terms of
 * the (already independently-derived and tested) photon sphere radius.
 */
function criticalImpactParameter(a: number, rph: number, charge = 0) {
  const Delta = rph * rph - 2 * mass * rph + a * a + charge * charge
  const P = (2 * rph * Delta) / (rph - mass)
  return (rph * rph + a * a - P) / a
}

/**
 * Same double-root condition, specialized to a=0 (Reissner–Nordström),
 * where criticalImpactParameter's /a blows up — solved directly instead:
 * R'(r_ph)=0 gives L² = 2r_ph³/(r_ph−M), independent of the sign convention
 * criticalImpactParameter uses (RN has no prograde/retrograde distinction).
 */
function criticalImpactParameterRN(rph: number) {
  return Math.sqrt((2 * rph ** 3) / (rph - mass))
}

describe('traceKerrRay', () => {
  it('reduces to the Schwarzschild tracer at spin = 0 (away from the critical impact parameter)', () => {
    const horizonRadius = 2 * mass
    const r0 = 60

    for (const b of [1, 2, 3, 4, 6, 10, 50]) {
      const { cameraPos, rayDir } = equatorialInwardRay(r0, b)
      const kerr = traceKerrRay({ mass, spin: 0, horizonRadius }, cameraPos, rayDir, spinAxis, {
        maxSteps: 20000,
        dTau: 0.0005,
        maxRadius: 300,
      })

      const sinPsi = b / r0
      const cosPsi = Math.sqrt(1 - sinPsi * sinPsi)
      const schwarzschild = traceSchwarzschildRay({ mass, horizonRadius }, r0, -cosPsi, sinPsi, {
        maxSteps: 2000,
        dPhi: 0.01,
        maxRadius: 300,
      })

      expect(kerr.captured).toBe(schwarzschild.captured)
    }
  })

  it('matches the exact equatorial critical impact parameter for a spinning hole', () => {
    const a = 0.9
    const horizonRadius = mass + Math.sqrt(mass * mass - a * a)
    const r0 = 60

    for (const direction of ['prograde', 'retrograde'] as const) {
      const rph = photonSphereRadius({ mass, spin: a, charge: 0 }, direction)!
      // equatorialInwardRay(r0, x) produces L = -x (built from -cosPsi,
      // sign(x)*sinPsi), so the ray with L = criticalImpactParameter(...)
      // needs the negated value passed in as its "b".
      const bCrit = -criticalImpactParameter(a, rph)

      const inside = equatorialInwardRay(r0, bCrit * 0.7)
      const outside = equatorialInwardRay(r0, bCrit * 1.3)

      const insideResult = traceKerrRay({ mass, spin: a, horizonRadius }, inside.cameraPos, inside.rayDir, spinAxis, {
        maxSteps: 40000,
        dTau: 0.0003,
        maxRadius: 500,
      })
      const outsideResult = traceKerrRay(
        { mass, spin: a, horizonRadius },
        outside.cameraPos,
        outside.rayDir,
        spinAxis,
        { maxSteps: 40000, dTau: 0.0003, maxRadius: 500 },
      )

      expect(insideResult.captured).toBe(true)
      expect(outsideResult.captured).toBe(false)
    }
  })

  it('matches the exact equatorial critical impact parameter for a charged, non-spinning hole (Reissner-Nordström)', () => {
    const charge = 0.6
    const horizonRadius = mass + Math.sqrt(mass * mass - charge * charge)
    const r0 = 60

    const rph = photonSphereRadius({ mass, spin: 0, charge })!
    const bCrit = criticalImpactParameterRN(rph)

    const inside = equatorialInwardRay(r0, bCrit * 0.7)
    const outside = equatorialInwardRay(r0, bCrit * 1.3)

    const insideResult = traceKerrRay(
      { mass, spin: 0, charge, horizonRadius },
      inside.cameraPos,
      inside.rayDir,
      spinAxis,
      { maxSteps: 40000, dTau: 0.0003, maxRadius: 500 },
    )
    const outsideResult = traceKerrRay(
      { mass, spin: 0, charge, horizonRadius },
      outside.cameraPos,
      outside.rayDir,
      spinAxis,
      { maxSteps: 40000, dTau: 0.0003, maxRadius: 500 },
    )

    expect(insideResult.captured).toBe(true)
    expect(outsideResult.captured).toBe(false)
  })

  it('stays numerically finite for a ray aimed close to the spin axis (near the pole singularity)', () => {
    const a = 0.9
    const horizonRadius = mass + Math.sqrt(mass * mass - a * a)
    // Camera almost directly above the pole, aimed almost straight down at
    // the black hole — theta stays close to 0 for most of the trajectory,
    // right where Θ(θ)'s sin²θ/sin³θ terms are most sensitive. Regression
    // test for the pole-singularity artifact found via visual review (a
    // bright line straight along the spin axis at high spin).
    const cameraPos = [1, 60, 0] as const
    const rayDir = [-1 / Math.sqrt(3601), -60 / Math.sqrt(3601), 0] as const

    const result = traceKerrRay({ mass, spin: a, horizonRadius }, cameraPos, rayDir, spinAxis, {
      maxSteps: 20000,
      dTau: 0.0005,
      maxRadius: 300,
    })

    expect(typeof result.captured).toBe('boolean')
    if (!result.captured) {
      expect(result.direction!.every((component) => Number.isFinite(component))).toBe(true)
    }
  })

  it('shows the frame-dragging asymmetry: the same |b| can be captured prograde but escape retrograde', () => {
    const a = 0.99
    const horizonRadius = mass + Math.sqrt(mass * mass - a * a)
    const r0 = 60
    const b = 4.5 // between the prograde (~2.8M) and retrograde (~6.8M) critical values at a=0.99

    // equatorialInwardRay(r0, x) produces L = -x, and positive L is
    // prograde (same convention as criticalImpactParameter above) — so
    // "prograde with impact parameter b" is equatorialInwardRay(r0, -b).
    const prograde = equatorialInwardRay(r0, -b)
    const retrograde = equatorialInwardRay(r0, b)

    const progradeResult = traceKerrRay({ mass, spin: a, horizonRadius }, prograde.cameraPos, prograde.rayDir, spinAxis, {
      maxSteps: 40000,
      dTau: 0.0003,
      maxRadius: 500,
    })
    const retrogradeResult = traceKerrRay(
      { mass, spin: a, horizonRadius },
      retrograde.cameraPos,
      retrograde.rayDir,
      spinAxis,
      { maxSteps: 40000, dTau: 0.0003, maxRadius: 500 },
    )

    expect(progradeResult.captured).toBe(false)
    expect(retrogradeResult.captured).toBe(true)
  })

  describe('disk crossing', () => {
    const horizonRadius = mass + Math.sqrt(mass * mass - 0.5 * 0.5)
    // Off-axis, off-equatorial camera aimed (in flat space) at a point
    // (0,0,10) in the disk plane — weak field at r0≈45 with mass=1, so the
    // real GR trajectory should cross the equatorial plane very close to
    // that same radius, same setup as lensing.test.ts's equivalent check.
    const cameraPos = [0, 20, 40] as const
    const target = [0, 0, 10] as const
    const rayDir = (() => {
      const diff = [target[0] - cameraPos[0], target[1] - cameraPos[1], target[2] - cameraPos[2]] as const
      const len = Math.hypot(diff[0], diff[1], diff[2])
      return [diff[0] / len, diff[1] / len, diff[2] / len] as const
    })()

    it('reports a diskHit at the expected radius when the disk bounds contain the crossing (spin=0)', () => {
      const result = traceKerrRay({ mass, spin: 0, horizonRadius }, cameraPos, rayDir, spinAxis, {
        maxSteps: 20000,
        dTau: 0.0005,
        maxRadius: 2000,
        disk: { innerRadius: 6, outerRadius: 60, halfThickness: 0 },
      })

      expect(result.diskHit).toBeDefined()
      expect(result.diskHit!.radius).toBeCloseTo(10, 0)
      expect(result.diskHit!.position[1]).toBeCloseTo(0, 2)
    })

    it('falls through to a normal escape when the crossing radius is outside the disk bounds', () => {
      const result = traceKerrRay({ mass, spin: 0, horizonRadius }, cameraPos, rayDir, spinAxis, {
        maxSteps: 20000,
        dTau: 0.0005,
        maxRadius: 2000,
        disk: { innerRadius: 15, outerRadius: 60, halfThickness: 0 },
      })

      expect(result.diskHit).toBeUndefined()
      expect(result.captured).toBe(false)
    })

    it('reports no diskHit when disk options are omitted', () => {
      const result = traceKerrRay({ mass, spin: 0, horizonRadius }, cameraPos, rayDir, spinAxis, {
        maxSteps: 20000,
        dTau: 0.0005,
        maxRadius: 2000,
      })

      expect(result.diskHit).toBeUndefined()
    })

    it('still detects the crossing with spin (frame dragging shifts φ, not the crossing radius/plane)', () => {
      const spinHorizon = mass + Math.sqrt(mass * mass - 0.9 * 0.9)
      const result = traceKerrRay({ mass, spin: 0.9, horizonRadius: spinHorizon }, cameraPos, rayDir, spinAxis, {
        maxSteps: 20000,
        dTau: 0.0005,
        maxRadius: 2000,
        disk: { innerRadius: 6, outerRadius: 60, halfThickness: 0 },
      })

      expect(result.diskHit).toBeDefined()
      expect(result.diskHit!.position[1]).toBeCloseTo(0, 2)
    })

    it('detects a diskHit for a ray whose y sits inside the thickness band far outside the radial bounds, only reaching them later (regression: "two disks with a gap")', () => {
      // Camera and target share the same y (0.3, well inside halfThickness
      // =0.5) — this ray's y stays ~constant near 0.3 for its whole path, so
      // it's already inside the Y-band from r0≈45 (well outside
      // [innerRadius=6, outerRadius=20]), long before its radius shrinks
      // into bounds. A per-face sign-change check (the version this
      // replaced) never sees a boundary crossed at all, since y never
      // approaches ±halfThickness from outside it — this is exactly the gap
      // the user reported as looking like "two disks" with empty space
      // between them at a near-edge-on camera angle.
      const grazingCamera = [0, 0.3, 45] as const
      const grazingTarget = [0, 0.3, 10] as const
      const diff = [
        grazingTarget[0] - grazingCamera[0],
        grazingTarget[1] - grazingCamera[1],
        grazingTarget[2] - grazingCamera[2],
      ] as const
      const len = Math.hypot(diff[0], diff[1], diff[2])
      const grazingRayDir = [diff[0] / len, diff[1] / len, diff[2] / len] as const

      const result = traceKerrRay({ mass, spin: 0, horizonRadius }, grazingCamera, grazingRayDir, spinAxis, {
        maxSteps: 20000,
        dTau: 0.0005,
        maxRadius: 2000,
        disk: { innerRadius: 6, outerRadius: 20, halfThickness: 0.5 },
      })

      expect(result.diskHit).toBeDefined()
    })

    it('with a thick disk, hits a face offset from the exact equatorial plane', () => {
      const thin = traceKerrRay({ mass, spin: 0, horizonRadius }, cameraPos, rayDir, spinAxis, {
        maxSteps: 20000,
        dTau: 0.0005,
        maxRadius: 2000,
        disk: { innerRadius: 6, outerRadius: 60, halfThickness: 0 },
      })
      const thick = traceKerrRay({ mass, spin: 0, horizonRadius }, cameraPos, rayDir, spinAxis, {
        maxSteps: 20000,
        dTau: 0.0005,
        maxRadius: 2000,
        disk: { innerRadius: 6, outerRadius: 60, halfThickness: 0.5 },
      })

      expect(thin.diskHit).toBeDefined()
      expect(thick.diskHit).toBeDefined()
      // The ray approaches from above (camera y=20 > 0), so it should enter
      // through the upper half of the slab, somewhere in (0, halfThickness]
      // — this is an entry-into-the-region check rather than an exact
      // boundary interpolation (see isInsideDiskSlab's doc comment in
      // kerrLensing.ts for why that tradeoff fixes a worse bug: rays that
      // silently entered the Y-band before their radius reached the disk's
      // bounds).
      expect(thick.diskHit!.position[1]).toBeGreaterThan(0)
      expect(thick.diskHit!.position[1]).toBeLessThanOrEqual(0.5)
      expect(thick.diskHit!.position[1]).not.toBeCloseTo(thin.diskHit!.position[1], 2)
    })
  })
})
