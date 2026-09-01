import { add, scale, type Vec3 } from './vec3'

/**
 * True when a point lies inside the disk's slab: within its radial bounds
 * AND within halfThickness of the equatorial (world-space y=0) plane.
 *
 * A first version checked each face (world-y = ∓halfThickness) via a sign
 * change, gating the radius-bounds check to that same step. That misses
 * near-edge-on rays: they can enter the thin Y-band while still far outside
 * [innerRadius, outerRadius] (grazing rays do this well before reaching the
 * hole), and once their radius later shrinks into bounds there's no fresh
 * sign change to trigger on — the crossing already happened, out of bounds,
 * steps ago. Visual QA showed this as a visible gap between what looked like
 * "two disks" (the rays whose Y-crossing and radius-bounds happened to
 * coincide in the same step) instead of one filled slab. Checking the
 * combined region as a single inside/outside predicate, and triggering on
 * its false→true transition, catches the entry step regardless of which
 * condition — radius or thickness — is the one that becomes newly satisfied.
 *
 * An even earlier version made the threshold r·sin(halfAngle) — a fixed
 * *angle* from the equator (a cone from the origin) rather than a fixed
 * height. Visual QA at a near-edge-on camera angle showed why that was wrong
 * too: a cone's half-thickness grows without bound with r, and under the
 * disk's own strong lensing near the shadow that turned into a dramatic
 * hourglass/"hi-hat" shape spanning most of the frame, not a subtly-thick disk.
 */
function isInsideDiskSlab(
  r: number,
  y: number,
  innerRadius: number,
  outerRadius: number,
  halfThickness: number,
): boolean {
  return r >= innerRadius && r <= outerRadius && Math.abs(y) <= halfThickness
}

/**
 * A zero-thickness disk is a genuine edge case for isInsideDiskSlab: "inside
 * the Y-band" degenerates to "y is exactly 0", which a continuously-sampled
 * trajectory essentially never lands on exactly, so the false→true
 * transition it looks for would almost never fire. The reason isInsideDiskSlab
 * needs that transition check at all — a ray can dwell inside the Y-band for
 * many steps while its radius is still out of bounds — doesn't apply here:
 * an infinitesimally thin plane can't be "dwelled inside", only crossed
 * instantaneously. So a zero-thickness disk instead detects the plane
 * crossing directly, the same way this disk check worked before thickness
 * existed at all: a sign change of y itself within the step, interpolated to
 * the exact crossing point and radius.
 */
function checkDiskPlaneCrossing(
  aR: number, aY: number, aPhi: number,
  bR: number, bY: number, bPhi: number,
  innerRadius: number,
  outerRadius: number,
): { radius: number; phi: number } | null {
  if (aY * bY >= 0) return null
  const fraction = aY / (aY - bY)
  const radius = aR + fraction * (bR - aR)
  if (radius < innerRadius || radius > outerRadius) return null
  const phi = aPhi + fraction * (bPhi - aPhi)
  return { radius, phi }
}

/**
 * World-space basis for the ray's fixed orbital plane (e1 = initial radial
 * direction, e2 = initial tangential direction) plus the disk's radial
 * bounds — everything traceSchwarzschildRay needs to reconstruct 3D
 * positions along the ray and check them against the (world-space,
 * equatorial-plane) disk, without otherwise needing to know about 3D
 * vectors at all.
 */
export interface DiskBounds {
  e1: Vec3
  e2: Vec3
  innerRadius: number
  outerRadius: number
  /**
   * Constant half-thickness (in the same length units as mass/radius) of
   * the disk around the equatorial (world-space y=0) plane — see
   * kerrLensing.ts's DiskBounds and this file's isInsideDiskSlab for the
   * rationale. 0 reproduces the original zero-thickness plane.
   */
  halfThickness: number
}

export interface RayOutcome {
  captured: boolean
  /**
   * Final direction, as components in the ray's own fixed orbital-plane basis
   * (e1 = initial radial direction, e2 = initial tangential direction).
   * Present only when the ray escapes.
   */
  direction?: { e1: number; e2: number }
  /**
   * Set when the ray crosses the disk's plane (world-space y=0, since the
   * spin axis is world-space Y) within [innerRadius, outerRadius] before
   * being captured or escaping — see traceSchwarzschildRay's doc comment.
   */
  diskHit?: { radius: number; position: Vec3 }
}

export interface TraceOptions {
  maxSteps?: number
  /** Step size in φ (radians) for each RK4 integration step. */
  dPhi?: number
  /** Radius beyond which the ray is considered to have escaped to infinity. */
  maxRadius?: number
  /** When set, the ray is checked for crossing the disk plane within these radii — see traceSchwarzschildRay's doc comment. */
  disk?: DiskBounds
}


/**
 * Traces a light ray through the Schwarzschild deflection field.
 *
 * The ray starts at distance r0 from the black hole, with direction given by
 * its radial and tangential components (rdRadial, rdTangential — a unit
 * vector, rdRadial² + rdTangential² = 1) in its own orbital plane.
 *
 * Integrates the standard null-geodesic equation in u = 1/r,
 *   d²u/dφ² + u = 3Mu²
 * via RK4, stepping φ forward until the ray is captured (r < horizonRadius),
 * escapes (r > maxRadius), or the step budget runs out — which only happens
 * for rays spiraling near the photon sphere, and is treated as captured,
 * since such a ray is on an unstable orbit headed for the horizon.
 *
 * When options.disk is set, the trace also terminates early — same as a
 * capture — the first time it crosses the disk's plane (world-space y=0)
 * within [innerRadius, outerRadius], returning the crossing radius and
 * world position instead of an escape direction. The ray's own orbital
 * plane is generally tilted relative to the disk's (this function has no
 * notion of "up" otherwise), so disk.e1/e2 — the same world-space basis
 * vectors the caller uses to reconstruct the escape direction — are what
 * let this reconstruct a 3D position each step and check its y-component
 * for a sign change, i.e. a crossing.
 */
export function traceSchwarzschildRay(
  { mass, horizonRadius }: { mass: number; horizonRadius: number },
  r0: number,
  rdRadial: number,
  rdTangential: number,
  { maxSteps = 300, dPhi = 0.02, maxRadius = 100 * mass, disk }: TraceOptions = {},
): RayOutcome {
  // Radial ray (b = 0): no deflection, no orbital plane to speak of — and
  // no disk check either, since there isn't a well-defined plane basis for
  // this degenerate case, but reaching it is measure-zero in screen space.
  if (rdTangential < 1e-6) {
    if (rdRadial < 0) return { captured: true }
    return { captured: false, direction: { e1: 1, e2: 0 } }
  }

  let u = 1 / r0
  let v = -u * (rdRadial / rdTangential) // du/dphi
  let phi = 0

  const uHorizon = 1 / horizonRadius
  const uMin = 1 / maxRadius

  let escaped = false
  for (let step = 0; step < maxSteps; step++) {
    const prevU = u
    const prevPhi = phi

    const k1u = v
    const k1v = -u + 3 * mass * u * u

    const u2 = u + (dPhi / 2) * k1u
    const v2 = v + (dPhi / 2) * k1v
    const k2u = v2
    const k2v = -u2 + 3 * mass * u2 * u2

    const u3 = u + (dPhi / 2) * k2u
    const v3 = v + (dPhi / 2) * k2v
    const k3u = v3
    const k3v = -u3 + 3 * mass * u3 * u3

    const u4 = u + dPhi * k3u
    const v4 = v + dPhi * k3v
    const k4u = v4
    const k4v = -u4 + 3 * mass * u4 * u4

    u += (dPhi / 6) * (k1u + 2 * k2u + 2 * k3u + k4u)
    v += (dPhi / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
    phi += dPhi

    if (disk) {
      // Checked via the RK4 stage points (start → stage 2 → stage 3 →
      // stage 4 → end), not a linear subdivision of the two endpoints —
      // see kerrLensing.ts's traceKerrRay for why: linear interpolation
      // between two points on the same side of the disk plane is
      // monotonic and cannot reveal an in-between dip no matter how
      // finely subdivided, while the stage points are real evaluations
      // through the step (here, r2/r3/r4 = 1/u2, 1/u3, 1/u4 are already
      // computed above; this φ parametrization makes the stage φ values
      // exact rather than approximated — φ is the independent variable
      // here, not integrated, so stages 2 and 3 both land at exactly
      // prevPhi + dPhi/2 and stage 4 at exactly prevPhi + dPhi).
      const prevR = 1 / prevU
      const r2 = 1 / u2
      const r3 = 1 / u3
      const r4 = 1 / u4
      const phiMid = prevPhi + dPhi / 2
      const phiEnd = prevPhi + dPhi
      const newR = 1 / u

      const pointsRPhi: readonly [number, number][] = [
        [prevR, prevPhi],
        [r2, phiMid],
        [r3, phiMid],
        [r4, phiEnd],
        [newR, phiEnd],
      ]
      const points = pointsRPhi.map(([pr, pphi]): readonly [number, number, number] => [
        pr,
        pphi,
        pr * (Math.cos(pphi) * disk.e1[1] + Math.sin(pphi) * disk.e2[1]),
      ])
      // For halfThickness > 0, a hit is the step where the ray's (r, y)
      // newly satisfies both the radial bounds and the thickness bound
      // together — see isInsideDiskSlab's doc comment for why this must be
      // one combined predicate rather than a per-face crossing gated on
      // radius at that same instant. For halfThickness = 0 (an
      // infinitesimal plane), see checkDiskPlaneCrossing's doc comment for
      // why that case needs a different check instead.
      for (let i = 1; i < points.length; i++) {
        const [aR, aPhi, aY] = points[i - 1]
        const [bR, bPhi, bY] = points[i]

        let hit: { radius: number; phi: number } | null = null
        if (disk.halfThickness > 0) {
          if (
            !isInsideDiskSlab(aR, aY, disk.innerRadius, disk.outerRadius, disk.halfThickness) &&
            isInsideDiskSlab(bR, bY, disk.innerRadius, disk.outerRadius, disk.halfThickness)
          ) {
            hit = { radius: bR, phi: bPhi }
          }
        } else {
          hit = checkDiskPlaneCrossing(aR, aY, aPhi, bR, bY, bPhi, disk.innerRadius, disk.outerRadius)
        }

        if (hit) {
          const position = add(scale(disk.e1, hit.radius * Math.cos(hit.phi)), scale(disk.e2, hit.radius * Math.sin(hit.phi)))
          return { captured: false, diskHit: { radius: hit.radius, position } }
        }
      }
    }

    if (u > uHorizon) return { captured: true }
    if (u < uMin) {
      escaped = true
      break
    }
  }

  if (!escaped) return { captured: true }

  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const e1Comp = -(v / u) * cosPhi - sinPhi
  const e2Comp = -(v / u) * sinPhi + cosPhi
  const length = Math.hypot(e1Comp, e2Comp)

  return { captured: false, direction: { e1: e1Comp / length, e2: e2Comp / length } }
}
