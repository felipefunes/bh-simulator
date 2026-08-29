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
