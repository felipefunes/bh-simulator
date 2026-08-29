// Geometrized units (G = c = 1): mass, spin, and charge all share the same
// length unit, and every radius below is expressed in that unit too.

export interface BlackHoleParams {
  /** Mass M. Sets the length scale for every other radius. */
  mass: number
  /** Spin parameter a = J / (M c), as a non-negative magnitude (0 <= a <= mass). */
  spin: number
  /** Electric charge Q (0 <= charge <= mass). */
  charge: number
}

export type BlackHoleClass = 'schwarzschild' | 'reissner-nordstrom' | 'kerr' | 'kerr-newman'

const EPSILON = 1e-9

/**
 * Classifies which named case applies. Mass alone never changes the case —
 * only whether spin and/or charge are (numerically) nonzero.
 */
export function classify({
  spin,
  charge,
}: Pick<BlackHoleParams, 'spin' | 'charge'>): BlackHoleClass {
  const hasSpin = spin > EPSILON
  const hasCharge = charge > EPSILON
  if (hasSpin && hasCharge) return 'kerr-newman'
  if (hasSpin) return 'kerr'
  if (hasCharge) return 'reissner-nordstrom'
  return 'schwarzschild'
}

/**
 * True when a² + Q² > M²: no horizon forms and the metric describes a naked
 * singularity rather than a black hole.
 */
export function isNakedSingularity({ mass, spin, charge }: BlackHoleParams): boolean {
  return spin ** 2 + charge ** 2 > mass ** 2
}

export interface Horizons {
  /** Event horizon, r+ */
  outer: number
  /** Cauchy (inner) horizon, r- */
  inner: number
}

/**
 * Event and Cauchy horizon radii for the general Kerr–Newman metric:
 * r± = M ± sqrt(M² − a² − Q²). Schwarzschild, Reissner–Nordström, and Kerr
 * are this same formula with spin and/or charge at zero, so one function
 * covers all four cases. Returns null for a naked singularity (no real root).
 */
export function horizonRadii({ mass, spin, charge }: BlackHoleParams): Horizons | null {
  const discriminant = mass ** 2 - spin ** 2 - charge ** 2
  if (discriminant < 0) return null
  const sqrtDiscriminant = Math.sqrt(discriminant)
  return { outer: mass + sqrtDiscriminant, inner: mass - sqrtDiscriminant }
}

/**
 * Equatorial ergosurface radius: M + sqrt(M² − Q²). At the equatorial plane
 * the frame-dragging term (a² cos²θ) vanishes, so the ergosphere's equatorial
 * edge depends only on mass and charge, never on spin.
 */
export function ergosphereEquatorialRadius({
  mass,
  charge,
}: Pick<BlackHoleParams, 'mass' | 'charge'>): number | null {
  const discriminant = mass ** 2 - charge ** 2
  if (discriminant < 0) return null
  return mass + Math.sqrt(discriminant)
}
