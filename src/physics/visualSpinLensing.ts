import { criticalImpactParameter } from './orbits'
import { traceSchwarzschildRay, type DiskBounds as SchwarzschildDiskBounds } from './lensing'
import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from './vec3'

// "Modo Visual" (CLAUDE.md roadmap item 9): this is what LensedBackground.tsx
// actually renders with now, for every spin/charge value. It replaced
// kerrLensing.ts's full Carter-constant Kerr–Newman integrator in the render
// path — that integrator's per-pixel cost (not any remaining disk-crossing
// bug) turned out to be the real ceiling on performance at high spin. The
// motivation: this is fundamentally an educational/visual simulator, nobody
// is reading the geodesic equations off the screen, and frame dragging's one
// actually-recognizable visual signature — the shadow's asymmetric
// flattening — is cheaply reproducible without integrating the real thing.
// kerrLensing.ts stays exactly as rigorous as before; it's just not what
// draws the picture anymore.

const SCHWARZSCHILD_CRITICAL_IMPACT_PARAMETER = 3 * Math.sqrt(3)

/**
 * Effective mass fed to the (otherwise unmodified) Schwarzschild tracer, in
 * place of a true Kerr integration, to fake the one visual signature of spin
 * people actually recognize on sight: the shadow's asymmetric flattening —
 * smaller/tighter on the side where photons orbit prograde, larger on the
 * retrograde side. See traceVisualSpinRay's doc comment for the motivation
 * (this replaces the expensive Carter-constant Kerr integration for
 * rendering, which is what was tipping GPU cost over — physics/kerrLensing.ts
 * stays intact as the rigorous, just-not-used-for-rendering reference).
 *
 * sinAngle is signed and in [-1, 1]: how "equatorial" this specific ray's
 * orbital plane is relative to the spin axis (+1 fully equatorial and
 * prograde, -1 fully equatorial and retrograde, 0 exactly polar). Frame
 * dragging is strongest at the equator and vanishes on the spin axis, so the
 * bias is scaled by |sinAngle| — a polar ray (sinAngle=0) gets the true mass
 * back exactly, matching that physical vanishing.
 *
 * Calibration: at sinAngle = ±1 (a ray confined to the equatorial plane),
 * this returns the mass that makes Schwarzschild's own critical impact
 * parameter (3√3 · mass) exactly equal the *real*, exact Kerr equatorial
 * critical impact parameter for that spin and direction (criticalImpactParameter,
 * itself derived from the already-verified photon sphere radius) — not a
 * guessed constant. Between the pole and the equator, this linearly
 * interpolates in |sinAngle|; real GR doesn't actually interpolate impact
 * parameters this way, but it's the deliberate "less rigorous, more visual"
 * approximation this trades for — smooth, continuous, and exact at both
 * ends (pole and equator).
 */
export function effectiveMassForRay(mass: number, spin: number, sinAngle: number): number {
  if (spin === 0 || sinAngle === 0) return mass

  const direction = sinAngle > 0 ? 'prograde' : 'retrograde'
  const bCritReal = criticalImpactParameter({ mass, spin, charge: 0 }, direction)
  if (bCritReal === null) return mass

  const equatorialMass = (Math.abs(bCritReal) / SCHWARZSCHILD_CRITICAL_IMPACT_PARAMETER) * mass
  return mass + (equatorialMass - mass) * Math.abs(sinAngle)
}

export interface VisualSpinDiskBounds {
  innerRadius: number
  outerRadius: number
}

export interface VisualSpinRayOutcome {
  captured: boolean
  /** World-space unit direction the ray escapes toward. Set only when captured is false. */
  direction?: Vec3
  /** Set when the ray crosses the equatorial (disk) plane within the disk's radii — see traceVisualSpinRay's doc comment. */
  diskHit?: { radius: number; position: Vec3 }
}

export interface VisualSpinTraceOptions {
  maxSteps?: number
  dPhi?: number
  maxRadius?: number
  disk?: VisualSpinDiskBounds
}

/**
 * Traces a light ray using the plain Schwarzschild integrator (fast, robust,
 * never had the near-photon-sphere precision problems the full Carter-constant
 * Kerr integration in kerrLensing.ts did, which is why that integrator has
 * been dropped from rendering — see this module's file-level comment), but
 * with a per-ray effective mass (effectiveMassForRay) standing in for the
 * real Kerr deflection — this is the "Modo Visual" from the roadmap, scoped
 * down to just the shadow shape.
 *
 * horizonRadius is passed through as the *real*, exact Kerr–Newman horizon
 * size (from physics/metric.ts), not derived from the effective mass — the
 * capture/escape boundary for a Schwarzschild ray is governed by comparing
 * its impact parameter to 3√3·(effective mass), essentially independent of
 * the specific horizonRadius value as long as it stays below that effective
 * photon sphere (verified: the real horizon is always ≤ 2·mass, while the
 * effective photon sphere at the most extreme prograde bias is still
 * comfortably larger, ~1.15·mass at exact extremal spin — see
 * visualSpinLensing.test.ts). So the shadow's actual capture threshold ends
 * up governed by the calibrated effective mass, not accidentally clipped by
 * an inconsistent horizon value.
 *
 * Charge is deliberately ignored here (per the roadmap's "Modo Visual"
 * decision) — its effect on a ray's path is visually negligible, and it
 * already affects the shadow/disk *sizes* correctly via the exact metric
 * formulas used elsewhere (physics/metric.ts, physics/orbits.ts) — only the
 * bending itself is approximated.
 */
export function traceVisualSpinRay(
  { mass, spin, horizonRadius }: { mass: number; spin: number; horizonRadius: number },
  cameraPos: Vec3,
  rayDir: Vec3,
  spinAxis: Vec3,
  { maxSteps, dPhi, maxRadius, disk }: VisualSpinTraceOptions = {},
): VisualSpinRayOutcome {
  const r0 = length(cameraPos)
  const e1 = normalize(cameraPos)
  const rdRadial = dot(rayDir, e1)
  const tangential = sub(rayDir, scale(e1, rdRadial))
  const rdTangentialLen = length(tangential)

  // Radial ray: no orbital plane, so no well-defined sinAngle either — matches
  // traceSchwarzschildRay's own degenerate case, reached with probability zero
  // in screen space.
  if (rdTangentialLen < 1e-6) {
    const result = traceSchwarzschildRay({ mass, horizonRadius }, r0, rdRadial, 0)
    if (result.captured) return { captured: true }
    return { captured: false, direction: rayDir }
  }

  const e2 = scale(tangential, 1 / rdTangentialLen)

  const impactVec = cross(cameraPos, rayDir)
  const b = length(impactVec)
  const sinAngle = b > 1e-9 ? dot(impactVec, spinAxis) / b : 0

  const effectiveMass = effectiveMassForRay(mass, spin, sinAngle)

  const schwDisk: SchwarzschildDiskBounds | undefined = disk
    ? { e1, e2, innerRadius: disk.innerRadius, outerRadius: disk.outerRadius }
    : undefined

  const result = traceSchwarzschildRay({ mass: effectiveMass, horizonRadius }, r0, rdRadial, rdTangentialLen, {
    maxSteps,
    dPhi,
    maxRadius,
    disk: schwDisk,
  })

  if (result.diskHit) return { captured: false, diskHit: result.diskHit }
  if (result.captured) return { captured: true }

  const direction = add(scale(e1, result.direction!.e1), scale(e2, result.direction!.e2))
  return { captured: false, direction }
}
