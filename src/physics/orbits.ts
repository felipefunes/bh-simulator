import type { BlackHoleParams } from './metric'

export type OrbitDirection = 'prograde' | 'retrograde'

/**
 * Photon sphere radius, equatorial plane.
 *
 * - Spin ~ 0: closed form for Reissner–Nordström (reduces to Schwarzschild's
 *   3M when charge is also 0), from the circular-photon-orbit condition
 *   r² − 3Mr + 2Q² = 0 → r = (3M + sqrt(9M² − 8Q²)) / 2 (outer root).
 * - Charge ~ 0, spin ≠ 0: closed form for Kerr (Bardeen 1972):
 *   r_ph = 2M [1 + cos((2/3) arccos(∓a/M))], − for prograde, + for retrograde.
 * - Both spin and charge nonzero (general Kerr–Newman): no simple closed
 *   form — photon orbits there require solving a quartic numerically. Not
 *   implemented; returns null.
 */
export function photonSphereRadius(
  { mass, spin, charge }: BlackHoleParams,
  direction: OrbitDirection = 'prograde',
): number | null {
  const hasSpin = spin > 0
  const hasCharge = charge > 0

  if (!hasSpin) {
    const discriminant = 9 * mass ** 2 - 8 * charge ** 2
    if (discriminant < 0) return null
    return (3 * mass + Math.sqrt(discriminant)) / 2
  }

  if (!hasCharge) {
    const a = spin / mass
    const sign = direction === 'prograde' ? -1 : 1
    return 2 * mass * (1 + Math.cos((2 / 3) * Math.acos(sign * a)))
  }

  return null
}

/**
 * Innermost stable circular orbit radius, equatorial plane.
 *
 * - Spin ~ 0, charge ~ 0: Schwarzschild's r_isco = 6M.
 * - Charge ~ 0, spin ≠ 0: the Bardeen–Press–Teukolsky (1972) formula, with
 *   a* = a/M:
 *     Z1 = 1 + (1 − a*²)^(1/3) [ (1 + a*)^(1/3) + (1 − a*)^(1/3) ]
 *     Z2 = sqrt(3a*² + Z1²)
 *     r_isco / M = 3 + Z2 ∓ sqrt((3 − Z1)(3 + Z1 + 2Z2)), − for prograde, + for retrograde.
 * - Any nonzero charge (Reissner–Nordström or Kerr–Newman): no comparably
 *   simple closed form — the effective potential for a massive test particle
 *   there needs root-finding on a quartic. Not implemented; returns null.
 */
export function iscoRadius(
  { mass, spin, charge }: BlackHoleParams,
  direction: OrbitDirection = 'prograde',
): number | null {
  if (charge > 0) return null

  if (spin === 0) return 6 * mass

  const aStar = spin / mass
  const z1 =
    1 +
    Math.cbrt(1 - aStar ** 2) * (Math.cbrt(1 + aStar) + Math.cbrt(1 - aStar))
  const z2 = Math.sqrt(3 * aStar ** 2 + z1 ** 2)
  const sign = direction === 'prograde' ? -1 : 1

  return mass * (3 + z2 + sign * Math.sqrt((3 - z1) * (3 + z1 + 2 * z2)))
}

/**
 * Critical impact parameter for an equatorial photon orbit — the boundary
 * between capture and escape for a ray confined to the equatorial plane,
 * heading in the given rotational sense relative to the spin axis. From the
 * double-root condition R(r_ph) = R'(r_ph) = 0 (Bardeen, Press & Teukolsky
 * 1972), solved for L in terms of the already-verified photon sphere radius:
 *   Δ = r_ph² − 2Mr_ph + a² + Q²,  P = 2r_ph·Δ / (r_ph − M),  b = (r_ph² + a² − P) / a
 *
 * Sign convention matches this file's other direction-signed quantities —
 * it is not a plain magnitude (see kerrLensing.test.ts's criticalImpactParameter
 * test helper, which this promotes to a real, tested module function).
 *
 * At spin = 0 there's no prograde/retrograde distinction (frame dragging
 * vanishes), and the /spin above is undefined there — Reissner–Nordström's
 * own R'(r_ph) = 0 condition gives the direction-independent closed form
 * sqrt(2r_ph³/(r_ph−M)) instead, which also reduces to Schwarzschild's exact
 * 3√3 M when charge = 0 too.
 *
 * At exact extremal spin (a = M) for the prograde direction, r_ph coincides
 * with the horizon and Δ, (r_ph − M) both vanish together — a genuine
 * removable singularity (the limit is finite, 2M) that plain floating-point
 * division can turn into 0/0. Guarded by returning P = 0 there directly
 * (correct in the limit, since Δ → 0 at the same point).
 *
 * Charge ≠ 0 with spin ≠ 0 (general Kerr–Newman) has no known closed form
 * for the photon sphere itself (see photonSphereRadius), so this returns
 * null there too.
 */
export function criticalImpactParameter(
  { mass, spin, charge }: BlackHoleParams,
  direction: OrbitDirection = 'prograde',
): number | null {
  const rph = photonSphereRadius({ mass, spin, charge }, direction)
  if (rph === null) return null

  if (spin === 0) {
    return Math.sqrt((2 * rph ** 3) / (rph - mass))
  }

  const denom = rph - mass
  const delta = rph * rph - 2 * mass * rph + spin * spin + charge * charge
  const p = denom === 0 ? 0 : (2 * rph * delta) / denom
  return (rph * rph + spin * spin - p) / spin
}
