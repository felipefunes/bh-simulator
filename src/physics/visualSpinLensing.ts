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
//
// First version of this varied each ray's *mass* (effectiveMassForRay,
// removed — see git history) continuously across the screen, calibrated so
// an equatorial ray reproduced the exact real critical impact parameter.
// That reintroduced a version of exactly the problem "Modo Visual" itself
// was meant to solve: null geodesics that wind multiple times near the
// photon sphere are extremely sensitive to mass, so even a smooth,
// continuous per-pixel mass variation makes neighboring pixels resolve to
// wildly different winding counts there — visible as dashed/aliased
// concentric arcs fanning out from the shadow at high spin (reported by the
// user; reproduced and confirmed absent at spin=0). Two attempts to tune
// this away (a smoother sinAngle² blend to remove a derivative kink at the
// pole; damping the bias magnitude to 30%) both left the artifact visually
// unchanged — it isn't proportional to the bias or its smoothness, it's a
// consequence of varying mass *at all* in the delicate near-photon-sphere
// regime, at any strength.
//
// This version never varies mass in the trace itself — every ray always
// uses the *true* mass, so the bending/photon-ring behavior is byte-for-byte
// what spin=0 already had (proven artifact-free). Instead, only the final
// capture/escape *decision* for rays that would otherwise show background is
// overridden, by comparing the ray's impact parameter against the real
// interpolated critical value — retrogradeCriticalImpactParameter's doc
// comment explains why this only works cleanly for retrograde (shadow
// grows: some escaping rays get reclassified as captured, trivial, no
// direction needed) and not prograde (shadow would need to shrink: some
// genuinely-captured rays would need a fake escape trajectory, which has no
// principled answer). Accepted trade-off, confirmed with the user: the
// shadow grows on the retrograde side and stays exactly Schwarzschild-sized
// on the prograde side, rather than the fully bidirectional (but broken)
// flattening the first version attempted.

const SCHWARZSCHILD_CRITICAL_IMPACT_PARAMETER = 3 * Math.sqrt(3)

/**
 * The critical impact parameter used to decide capture for a ray with this
 * sinAngle — equal to the plain Schwarzschild value (3√3·mass) except for
 * retrograde rays (sinAngle < 0), where it grows smoothly (sinAngle²,
 * vanishing at the pole where frame dragging genuinely vanishes too) toward
 * the real Kerr equatorial retrograde critical impact parameter as
 * sinAngle → -1. Prograde/polar rays (sinAngle >= 0) and spin <= 0 always
 * get the unbiased Schwarzschild value back — see this module's file-level
 * comment for why only the retrograde (growing) direction is handled here.
 */
export function retrogradeCriticalImpactParameter(mass: number, spin: number, sinAngle: number): number {
  const schwarzschildCrit = SCHWARZSCHILD_CRITICAL_IMPACT_PARAMETER * mass
  if (spin <= 0 || sinAngle >= 0) return schwarzschildCrit

  const bCritRetrograde = criticalImpactParameter({ mass, spin, charge: 0 }, 'retrograde')
  if (bCritRetrograde === null) return schwarzschildCrit

  return schwarzschildCrit + (Math.abs(bCritRetrograde) - schwarzschildCrit) * sinAngle * sinAngle
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
 * Traces a light ray using the plain Schwarzschild integrator, always at the
 * *true* mass (see this module's file-level comment for why varying it per
 * ray was reverted) — bending, the disk crossing, and the photon-ring
 * behavior are all exactly what a spin=0 render already had, for every
 * pixel, regardless of spin.
 *
 * The only place spin enters is a post-hoc override, applied only when the
 * ray would otherwise show the background (not already captured, not a disk
 * hit — the disk itself already uses the real Kerr–Newman ISCO/horizon via
 * physics/orbits.ts, unrelated to this): if the ray's impact parameter falls
 * under retrogradeCriticalImpactParameter's (sinAngle-dependent) threshold,
 * it's reclassified as captured instead of sampling the background. This is
 * always a no-op for prograde/polar rays (that function returns the plain
 * Schwarzschild value there, which is exactly what the unbiased trace above
 * already used to decide captured/escaped) — the shadow only ever grows,
 * never shrinks, in this version.
 *
 * Charge is deliberately ignored here (per the roadmap's "Modo Visual"
 * decision) — its effect on a ray's path is visually negligible, and it
 * already affects the shadow/disk *sizes* correctly via the exact metric
 * formulas used elsewhere (physics/metric.ts, physics/orbits.ts).
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

  const schwDisk: SchwarzschildDiskBounds | undefined = disk
    ? { e1, e2, innerRadius: disk.innerRadius, outerRadius: disk.outerRadius }
    : undefined

  const result = traceSchwarzschildRay({ mass, horizonRadius }, r0, rdRadial, rdTangentialLen, {
    maxSteps,
    dPhi,
    maxRadius,
    disk: schwDisk,
  })

  if (result.diskHit) return { captured: false, diskHit: result.diskHit }
  if (result.captured) return { captured: true }

  if (b < retrogradeCriticalImpactParameter(mass, spin, sinAngle)) {
    return { captured: true }
  }

  const direction = add(scale(e1, result.direction!.e1), scale(e2, result.direction!.e2))
  return { captured: false, direction }
}
