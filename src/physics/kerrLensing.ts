import { add, cross, dot, length, normalize, scale, sub, type Vec3 } from './vec3'

// No longer used for rendering — see physics/visualSpinLensing.ts, which
// replaced this module's role in LensedBackground.tsx with a much cheaper
// per-ray effective-mass bias on the Schwarzschild tracer, calibrated
// against this module's own exact photon-sphere/critical-impact-parameter
// physics. Kept intact, tested, and unmodified as the rigorous reference —
// exact Kerr–Newman geodesics via the Carter constant — for anyone running
// this on hardware that can afford it, or extending the physics further.
// See CLAUDE.md's roadmap ("Modo Visual vs. Riguroso") for the full
// rationale.

/**
 * Checks one segment of a ray's step for a crossing of the equatorial plane
 * (θ=π/2, y = r·cosθ since the spin axis is world Y) within [innerRadius,
 * outerRadius]. Returns the interpolated hit radius and φ, or null.
 *
 * The disk briefly had physical thickness (two faces, a filled slab instead
 * of this infinitesimal plane) — reverted (see git history for the full
 * saga) after it turned out to be the tipping point for GPU cost at high
 * spin/near-edge-on views, back when this was the integrator every spinning
 * ray actually ran through for rendering. Never revisited after that — given
 * this is fundamentally an educational/visual simulator, a flat disk that
 * renders smoothly beats a thick one that doesn't render at all.
 */
function checkDiskCrossing(
  aR: number, aTheta: number, aPhi: number,
  bR: number, bTheta: number, bPhi: number,
  innerRadius: number,
  outerRadius: number,
): { radius: number; phi: number } | null {
  const aY = aR * Math.cos(aTheta)
  const bY = bR * Math.cos(bTheta)
  if (aY * bY >= 0) return null
  const fraction = aY / (aY - bY)
  const radius = aR + fraction * (bR - aR)
  if (radius < innerRadius || radius > outerRadius) return null
  const phi = aPhi + fraction * (bPhi - aPhi)
  return { radius, phi }
}

export interface DiskBounds {
  innerRadius: number
  outerRadius: number
}

export interface KerrRayOutcome {
  captured: boolean
  /** World-space unit direction the ray escapes toward. Set only when captured is false. */
  direction?: Vec3
  /**
   * Set when the ray crosses the equatorial (disk) plane within
   * [innerRadius, outerRadius] before being captured or escaping — the disk
   * is opaque, so this takes priority over whatever direction/captured
   * would otherwise apply (see traceKerrRay's disk option).
   */
  diskHit?: { radius: number; position: Vec3 }
}

export interface KerrTraceOptions {
  maxSteps?: number
  /** Step size in Mino time (dτ = dλ/Σ) — see the derivation note below. */
  dTau?: number
  maxRadius?: number
  /** When set, the ray is checked for crossing the equatorial plane within these radii — see traceKerrRay's doc comment. */
  disk?: DiskBounds
}

/**
 * Traces a light ray through the full Kerr–Newman deflection field (frame
 * dragging and charge both included), via the exact Carter-constant
 * separation of the null geodesic equations — general (non-equatorial)
 * orbits, not the equatorial-only approximation.
 *
 * Standard Boyer–Lindquist result (Carter 1968; Chandrasekhar 1983), with
 * E = 1 (fixes the affine parameter's overall scale — only ratios to E
 * matter for the path shape):
 *
 *   Σ ṙ = ±√R(r),      R(r)  = P(r)² − Δ[(L−a)² + Q],     P(r) = r²+a²−aL
 *   Σ θ̇ = ±√Θ(θ),      Θ(θ)  = Q + cos²θ(a² − L²/sin²θ)
 *   Σ φ̇ = −(a − L/sin²θ) + (a/Δ) P(r)
 *   Σ = r² + a²cos²θ,  Δ = r² − 2Mr + a² + e²   (e = electric charge)
 *
 * A photon carries no charge, so it doesn't feel the electromagnetic field
 * directly — only through the metric, and Kerr–Newman's metric is Kerr's
 * same ansatz with Δ carrying the extra +e² term (a standard, well-known
 * fact: Carter's original separation covers uncharged-test-particle
 * geodesics in Kerr–Newman too, not just Kerr). Since d(e²)/dr = 0, R'(r)
 * below is *exactly* the same expression as the pure-Kerr case — only Δ
 * itself picks up the charge term, in R(r) and dφ/dλ.
 *
 * Rather than integrate r, θ with an explicit ± sign that has to flip at
 * every turning point (awkward for RK4), this tracks w_r ≡ Σṙ and w_θ ≡ Σθ̇
 * as dynamical variables in their own right. Differentiating the algebraic
 * identities w_r² = R(r) and w_θ² = Θ(θ) gives smooth, sign-free equations
 * of motion for them (valid straight through a turning point, where w → 0):
 *
 *   dw_r/dλ = R'(r)/(2Σ),   dw_θ/dλ = Θ'(θ)/(2Σ)
 *
 * Switching the integration variable from λ to Mino time τ (dτ = dλ/Σ,
 * Mino 2003 — the standard reparametrization for numerical Kerr geodesics)
 * removes the Σ from every equation, which is what actually gets integrated
 * here:
 *
 *   dr/dτ = w_r,  dθ/dτ = w_θ,  dφ/dτ = Σ·(above),  dw_r/dτ = R'(r)/2,  dw_θ/dτ = Θ'(θ)/2
 *
 * L (angular momentum about the spin axis) and Q (Carter's constant) are set
 * from the camera ray's flat-space impact-parameter vector b⃗ = cameraPos × rayDir
 * (valid since a ≪ r0 for any camera actually outside the black hole):
 * L = b⃗·spinAxis, Q = |b⃗|² − L² (Q reduces to exactly this, the "off-axis"
 * part of the angular momentum, in the flat-space/a→0 limit — a standard,
 * easily-checked property of the Carter constant).
 *
 * Critically, w_r(0) and w_θ(0) are seeded from the *exact* R(r0)/Θ(θ0)
 * formulas, not a flat-space approximation of ṙ/θ̇ themselves — the two
 * differ by an amount that's negligible far away but becomes catastrophic
 * once R(r) shrinks to a comparable size near the photon sphere (this was
 * empirically the difference between a ray falling in correctly and
 * "bouncing" at the wrong radius during development).
 *
 * Verified against: the a=0 case reproducing traceSchwarzschildRay's
 * capture/escape boundary; the equatorial critical impact parameter
 * (prograde and retrograde) matching photonSphereRadius from physics/orbits;
 * and the qualitative frame-dragging asymmetry (same |b|, opposite outcome
 * for prograde vs. retrograde at high spin). See kerrLensing.test.ts.
 *
 * When options.disk is set, the trace also terminates early — same as a
 * capture — the first time it crosses the equatorial plane (θ=π/2, where
 * the disk lives) within [innerRadius, outerRadius], returning the crossing
 * radius and world position instead of an escape direction. This is what
 * lets the disk appear properly lensed (deformed, and duplicated above/below
 * the shadow) rather than as flat, unlensed particle geometry — see
 * LensedBackground.tsx's GLSL mirror and roadmap item 8.
 */
export function traceKerrRay(
  {
    mass,
    spin,
    charge = 0,
    horizonRadius,
  }: { mass: number; spin: number; charge?: number; horizonRadius: number },
  cameraPos: Vec3,
  rayDir: Vec3,
  spinAxis: Vec3,
  { maxSteps = 20000, dTau = 0.0005, maxRadius = 100 * mass, disk }: KerrTraceOptions = {},
): KerrRayOutcome {
  const M = mass
  const a = spin
  const e2 = charge * charge

  const r0 = length(cameraPos)
  const rHat = normalize(cameraPos)
  const xRef = normalize(sub([1, 0, 0], scale(spinAxis, dot([1, 0, 0], spinAxis))))
  const yRef = cross(spinAxis, xRef)

  const theta0 = Math.acos(Math.max(-1, Math.min(1, dot(rHat, spinAxis))))
  const phi0 = Math.atan2(dot(rHat, yRef), dot(rHat, xRef))

  const impactVec = cross(cameraPos, rayDir)
  const L = dot(impactVec, spinAxis)
  const Q = Math.max(0, dot(impactVec, impactVec) - L * L)

  const thetaHat = normalize(sub(scale(rHat, dot(rHat, spinAxis)), spinAxis))
  const rdRadial = dot(rayDir, rHat)
  const rdTheta = dot(rayDir, thetaHat)

  const R = (r: number) => {
    const P = r * r + a * a - a * L
    const Delta = r * r - 2 * M * r + a * a + e2
    return P * P - Delta * ((L - a) * (L - a) + Q)
  }
  const Rprime = (r: number) => {
    const P = r * r + a * a - a * L
    const RmL = (L - a) * (L - a) + Q
    return 4 * r * P - 2 * (r - M) * RmL
  }
  // Θ(θ) and its derivative divide by sin²θ/sin³θ, which blow up as θ
  // approaches the poles. A genuine photon orbit with L≠0 never actually
  // reaches sin θ = 0 (Θ goes negative first, forcing a turning point), but
  // floating-point roundoff right at that boundary can send a stray ray
  // through the singularity — this clamp leaves every real trajectory
  // unaffected while avoiding NaN/Inf blow-ups for rays that pass close to
  // the spin axis (empirically, without it, this produced a spurious bright
  // line straight along the axis in the shader translation of this module).
  const safeSin = (theta: number) => {
    const s = Math.sin(theta)
    return s >= 0 ? Math.max(s, 1e-3) : Math.min(s, -1e-3)
  }
  const Theta = (theta: number) => {
    const c = Math.cos(theta)
    const s = safeSin(theta)
    return Q + c * c * (a * a - L * L / (s * s))
  }
  const Thetaprime = (theta: number) => {
    const c = Math.cos(theta)
    const s = safeSin(theta)
    return 2 * c * (L * L / (s * s * s) - a * a * s)
  }

  let r = r0
  let theta = theta0
  let phi = phi0
  let wr = Math.sign(rdRadial || 1) * Math.sqrt(Math.max(0, R(r0)))
  let wth = Math.sign(rdTheta || 1) * Math.sqrt(Math.max(0, Theta(theta0)))

  const derivatives = (r: number, theta: number, wr: number, wth: number) => {
    const sinTheta = safeSin(theta)
    const sin2 = sinTheta * sinTheta
    const Delta = r * r - 2 * M * r + a * a + e2
    const P = r * r + a * a - a * L
    const dPhi = -(a - L / sin2) + (a / Delta) * P
    return [wr, wth, dPhi, Rprime(r) / 2, Thetaprime(theta) / 2] as const
  }

  let escaped = false
  // A real photon orbit with L≠0 turns around before reaching the pole
  // (Θ(θ) hits zero first); a single RK4 step can overshoot past that
  // turning point numerically right at the singularity. Reflect theta/wth
  // like a wall there instead of letting the ray punch through.
  //
  // But a ray with L≈0 (near the vertical plane through the camera and the
  // spin axis) has no turning point at all — Θ(θ) = Q + a²cos²θ stays ≥ 0
  // for every θ, so the ray genuinely passes over the pole and continues
  // into the opposite half of the sky (φ → φ + π), the same way walking
  // over the north pole of a globe in a straight line puts you 180° around
  // in longitude on the way back down. Treating that crossing as a bounce
  // (this block's original behavior) traps the ray oscillating between the
  // two poles instead of letting it continue outward, producing a periodic
  // chain of duplicate star images climbing the spin axis — found via
  // visual QA as a faint dashed/"beaded" line, persisting even at much
  // higher integration precision (ruling out step-size error as the cause,
  // and pointing at this wrong reflection rule instead). Distinguish the
  // two cases by evaluating Θ right at the guard latitude: if it's still
  // clearly positive there, there's no turning point nearby and this is a
  // genuine pole crossing, so add the π shift; if it's ~0 (or the guard
  // itself is closer to the pole than the true turning point), it's a real
  // bounce and φ is left alone.
  const POLE_GUARD = 0.02
  const sinGuard = Math.sin(POLE_GUARD)
  const cosGuard = Math.cos(POLE_GUARD)
  const thetaNearPole = Q + cosGuard * cosGuard * (a * a - (L * L) / (sinGuard * sinGuard))
  const isPoleCrossing = thetaNearPole > 0

  for (let step = 0; step < maxSteps; step++) {
    const prevR = r
    const prevTheta = theta
    const prevPhi = phi

    const k1 = derivatives(r, theta, wr, wth)
    const r2 = r + (dTau / 2) * k1[0]
    const th2 = theta + (dTau / 2) * k1[1]
    const phi2 = phi + (dTau / 2) * k1[2]
    const k2 = derivatives(r2, th2, wr + (dTau / 2) * k1[3], wth + (dTau / 2) * k1[4])
    const r3 = r + (dTau / 2) * k2[0]
    const th3 = theta + (dTau / 2) * k2[1]
    const phi3 = phi + (dTau / 2) * k2[2]
    const k3 = derivatives(r3, th3, wr + (dTau / 2) * k2[3], wth + (dTau / 2) * k2[4])
    const r4 = r + dTau * k3[0]
    const th4 = theta + dTau * k3[1]
    const phi4 = phi + dTau * k3[2]
    const k4 = derivatives(r4, th4, wr + dTau * k3[3], wth + dTau * k3[4])

    r += (dTau / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
    theta += (dTau / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
    phi += (dTau / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])
    wr += (dTau / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3])
    wth += (dTau / 6) * (k1[4] + 2 * k2[4] + 2 * k3[4] + k4[4])

    // The disk is opaque and lies exactly in the equatorial plane (θ=π/2),
    // so a crossing here terminates the trace immediately, the same way
    // capture does. Must be checked before the POLE_GUARD block below,
    // which only ever adjusts theta near the poles (far from π/2) and
    // would otherwise be irrelevant either way.
    //
    // Checking only the step's two endpoints (as this originally did) can
    // miss a crossing: near the photon sphere, θ can swing past π/2 and
    // back within a *single* RK4 step (strongly-bent, near-critical rays
    // are exactly where this happens), and if both endpoints land on the
    // same side, the endpoint-only check sees no sign change — found via
    // visual QA as a literal wedge/"notch" bitten out of the disk's lensed
    // image at moderate-to-high spin, confirmed as a step-size issue (not a
    // deeper physics/algorithm bug) because the "high" quality preset's
    // finer dτ made it vanish with no other change.
    //
    // The fix is *not* to linearly interpolate more points between the two
    // endpoints — that can't work: linear interpolation between two points
    // on the same side of π/2 is monotonic and mathematically cannot dip to
    // the other side no matter how finely it's subdivided, regardless of
    // what the true curve did in between (confirmed empirically: an
    // 8-point subdivision of just the endpoints left the notch completely
    // unchanged). What actually carries curvature information are the RK4
    // stage evaluations themselves — (r2,θ2), (r3,θ3), (r4,θ4) above are
    // already real evaluations of the derivative at three different points
    // through the step, not interpolation, so a same-step dip that reaches
    // an actual stage point does show up. Checking consecutive pairs
    // (start → stage 2 → stage 3 → stage 4 → end) costs nothing extra
    // (those stage values are already computed for the RK4 update above,
    // this only adds the phi2/phi3/phi4 bookkeeping) and resolved the notch
    // in visual testing where the subdivision approach did not.
    if (disk) {
      const points: readonly [number, number, number][] = [
        [prevR, prevTheta, prevPhi],
        [r2, th2, phi2],
        [r3, th3, phi3],
        [r4, th4, phi4],
        [r, theta, phi],
      ]

      for (let i = 1; i < points.length; i++) {
        const [aR, aTheta, aPhi] = points[i - 1]
        const [bR, bTheta, bPhi] = points[i]
        const hit = checkDiskCrossing(aR, aTheta, aPhi, bR, bTheta, bPhi, disk.innerRadius, disk.outerRadius)
        if (hit) {
          // At θ=π/2 exactly, ρ=r (the reconstructed point lies fully in the
          // xRef/yRef plane, no spinAxis component).
          const position = add(scale(xRef, hit.radius * Math.cos(hit.phi)), scale(yRef, hit.radius * Math.sin(hit.phi)))
          return { captured: false, diskHit: { radius: hit.radius, position } }
        }
      }
    }

    if (theta < POLE_GUARD) {
      theta = 2 * POLE_GUARD - theta
      wth = -wth
      if (isPoleCrossing) phi += Math.PI
    }
    if (theta > Math.PI - POLE_GUARD) {
      theta = 2 * (Math.PI - POLE_GUARD) - theta
      wth = -wth
      if (isPoleCrossing) phi += Math.PI
    }

    if (!Number.isFinite(r) || !Number.isFinite(theta)) break
    if (r < horizonRadius) break
    if (r > maxRadius) {
      escaped = true
      break
    }
  }

  if (!escaped) return { captured: true }

  const sinThetaFinal = Math.sin(theta)
  const direction = normalize(
    add(
      add(scale(xRef, sinThetaFinal * Math.cos(phi)), scale(yRef, sinThetaFinal * Math.sin(phi))),
      scale(spinAxis, Math.cos(theta)),
    ),
  )

  return { captured: false, direction }
}
