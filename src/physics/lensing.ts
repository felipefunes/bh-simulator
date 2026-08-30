export interface RayOutcome {
  captured: boolean
  /**
   * Final direction, as components in the ray's own fixed orbital-plane basis
   * (e1 = initial radial direction, e2 = initial tangential direction).
   * Present only when the ray escapes.
   */
  direction?: { e1: number; e2: number }
}

export interface TraceOptions {
  maxSteps?: number
  /** Step size in φ (radians) for each RK4 integration step. */
  dPhi?: number
  /** Radius beyond which the ray is considered to have escaped to infinity. */
  maxRadius?: number
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
 */
export function traceSchwarzschildRay(
  { mass, horizonRadius }: { mass: number; horizonRadius: number },
  r0: number,
  rdRadial: number,
  rdTangential: number,
  { maxSteps = 300, dPhi = 0.02, maxRadius = 100 * mass }: TraceOptions = {},
): RayOutcome {
  // Radial ray (b = 0): no deflection, no orbital plane to speak of.
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
