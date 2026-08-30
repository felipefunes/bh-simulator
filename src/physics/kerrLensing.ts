type Vec3 = readonly [number, number, number]

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
function length(a: Vec3): number {
  return Math.sqrt(dot(a, a))
}
function normalize(a: Vec3): Vec3 {
  const l = length(a)
  return [a[0] / l, a[1] / l, a[2] / l]
}

export interface KerrRayOutcome {
  captured: boolean
  /** World-space unit direction the ray escapes toward. Set only when captured is false. */
  direction?: Vec3
}

export interface KerrTraceOptions {
  maxSteps?: number
  /** Step size in Mino time (dτ = dλ/Σ) — see the derivation note below. */
  dTau?: number
  maxRadius?: number
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
  { maxSteps = 20000, dTau = 0.0005, maxRadius = 100 * mass }: KerrTraceOptions = {},
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
    const k1 = derivatives(r, theta, wr, wth)
    const k2 = derivatives(r + (dTau / 2) * k1[0], theta + (dTau / 2) * k1[1], wr + (dTau / 2) * k1[3], wth + (dTau / 2) * k1[4])
    const k3 = derivatives(r + (dTau / 2) * k2[0], theta + (dTau / 2) * k2[1], wr + (dTau / 2) * k2[3], wth + (dTau / 2) * k2[4])
    const k4 = derivatives(r + dTau * k3[0], theta + dTau * k3[1], wr + dTau * k3[3], wth + dTau * k3[4])

    r += (dTau / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
    theta += (dTau / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
    phi += (dTau / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2])
    wr += (dTau / 6) * (k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3])
    wth += (dTau / 6) * (k1[4] + 2 * k2[4] + 2 * k3[4] + k4[4])

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
