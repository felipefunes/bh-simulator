import { add, scale, type Vec3 } from './vec3'

/**
 * Checks one segment of a ray's step for a crossing of the disk's plane
 * (world-space y=0) within [innerRadius, outerRadius]. Returns the
 * interpolated hit radius and φ, or null.
 *
 * The disk briefly had physical thickness (two faces, a filled slab instead
 * of this infinitesimal plane) — reverted (see git history for the full
 * saga) after it turned out to be the tipping point for GPU cost at high
 * spin/near-edge-on views: every extra per-step branch it added compounds
 * across Kerr's already load-bearing fixed 6000-step integration (see
 * KERR_STEPS's doc comment in renderQuality.ts) and across every pixel of
 * the frame. Given this is fundamentally an educational/visual simulator, a
 * flat disk that renders smoothly beats a thick one that doesn't render at
 * all.
 */
function checkDiskCrossing(
  aR: number, aPhi: number, aY: number,
  bR: number, bPhi: number, bY: number,
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
      for (let i = 1; i < points.length; i++) {
        const [aR, aPhi, aY] = points[i - 1]
        const [bR, bPhi, bY] = points[i]
        const hit = checkDiskCrossing(aR, aPhi, aY, bR, bPhi, bY, disk.innerRadius, disk.outerRadius)
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
