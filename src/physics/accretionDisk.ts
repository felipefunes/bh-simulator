/**
 * Reference peak temperature for the disk's blackbody color ramp, in
 * Kelvin. Real accretion disk temperatures depend on accretion rate and
 * black hole mass (neither of which this simulator models) and can reach
 * into the tens of millions of Kelvin near the ISCO — but at that scale
 * the *entire* visible disk (which only extends a few multiples of the
 * inner radius) would sit deep in the blue end of the blackbody curve, so
 * this is tuned down instead to land the outer disk edge around the
 * orange/red part of the spectrum, giving the full ramp visual range.
 */
export const PEAK_TEMPERATURE_KELVIN = 1.4e4

/**
 * Shakura & Sunyaev (1973) steady-state thin-disk temperature profile:
 * T(r)⁴ ∝ r⁻³ (1 − √(r_in/r)) for r > r_in, zero at and inside r_in (the
 * inner disk edge, physically the ISCO). Peaks at r ≈ 1.36 r_in.
 *
 * Returns a temperature in Kelvin, normalized so the profile's own maximum
 * (not r_in itself) equals PEAK_TEMPERATURE_KELVIN — the reference scale
 * above.
 */
export function diskTemperature(innerRadius: number, r: number): number {
  if (r <= innerRadius) return 0

  const shape = (radius: number) => Math.pow(radius, -3) * (1 - Math.sqrt(innerRadius / radius))

  // The profile's peak location (found by setting d/dr[shape]=0) is a fixed
  // multiple of r_in, so its value scales the same way — compute it once
  // relative to r_in to normalize against, rather than a numerical search.
  const peakRadius = innerRadius * (49 / 36)
  const peakShape = shape(peakRadius)

  return PEAK_TEMPERATURE_KELVIN * Math.pow(Math.max(0, shape(r)) / peakShape, 0.25)
}

/**
 * Approximate blackbody color for a given temperature, as normalized
 * (0-1) linear RGB. Piecewise polynomial fit in T/100 (Kelvin), the
 * standard form of the widely-used "Tanner Helland" blackbody
 * approximation — chosen here for its simplicity to port to GLSL, not for
 * spectral precision. Qualitative behavior only is relied on elsewhere
 * (redder below ~4000K, near-neutral white around ~6600K, blue-white
 * above that) — see accretionDisk.test.ts.
 */
export function blackbodyColor(temperatureKelvin: number): [number, number, number] {
  const t = Math.max(1000, Math.min(40000, temperatureKelvin)) / 100

  let r: number
  let g: number
  let b: number

  if (t <= 66) {
    r = 255
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592)
  }

  if (t <= 66) {
    g = 99.4708025861 * Math.log(t) - 161.1195681661
  } else {
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  }

  if (t >= 66) {
    b = 255
  } else if (t <= 19) {
    b = 0
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307
  }

  const clamp01 = (x: number) => Math.max(0, Math.min(255, x)) / 255
  return [clamp01(r), clamp01(g), clamp01(b)]
}

/**
 * Locally-measured circular-orbit speed (in units of c) at radius r around
 * a Schwarzschild mass: v(r) = √(M / (r − 2M)). A standard result — it
 * gives exactly c at the photon sphere (r=3M) and exactly 0.5c at the ISCO
 * (r=6M), both well-known checkpoints (see accretionDisk.test.ts).
 *
 * Used as a first approximation regardless of spin/charge, same as the
 * lensing shader's mass-only deflection before PR 5 — refining this for
 * Kerr/Kerr-Newman frame dragging is future work.
 */
export function orbitalSpeed(mass: number, r: number): number {
  const denominator = Math.max(1e-6, r - 2 * mass)
  return Math.sqrt(mass / denominator)
}

/**
 * Combined gravitational + relativistic Doppler redshift factor (1+z) for
 * light emitted by matter in a circular Schwarzschild orbit at radius r,
 * observed by a distant static observer:
 *
 *   1+z = γ(1 − β·n̂) / √(1 − 2M/r)
 *
 * γ = 1/√(1−β²) from the orbital speed above (transverse Doppler / time
 * dilation), β·n̂ is the orbital velocity's component along n̂ (unit vector
 * from the emitter toward the observer) — positive means moving toward the
 * observer (blueshift), negative means moving away (redshift). Passed in
 * directly so the caller/shader owns the 3D geometry (n̂·velocityDirection,
 * scaled by orbitalSpeed). √(1−2M/r) is the gravitational redshift factor.
 * This is the standard combined treatment used in relativistic
 * accretion-disk imaging (e.g. Luminet 1979).
 */
export function combinedRedshiftFactor(mass: number, r: number, betaLineOfSight: number): number {
  const beta = orbitalSpeed(mass, r)
  const gamma = 1 / Math.sqrt(Math.max(1e-9, 1 - beta * beta))
  const gravitational = Math.sqrt(Math.max(1e-9, 1 - (2 * mass) / r))
  return (gamma * (1 - betaLineOfSight)) / gravitational
}

/** Doppler factor D = 1/(1+z): >1 blueshifted/approaching, <1 redshifted/receding. */
export function dopplerFactor(mass: number, r: number, betaLineOfSight: number): number {
  return 1 / combinedRedshiftFactor(mass, r, betaLineOfSight)
}

/**
 * Smooth brightness falloff for the disk's outer edge — 1 at and inside
 * outerRadius, smoothing down to 0 at outerRadius + fadeWidth, so it
 * dissipates like dust instead of stopping at a razor-sharp cutoff. Purely
 * a visual softening (a standard smoothstep, not a real density/optical-depth
 * model) — the inner edge already fades physically via diskTemperature
 * going to 0 at the ISCO, so this only ever applies to the outer edge.
 * fadeWidth <= 0 reproduces the original hard edge exactly.
 */
export function outerEdgeFade(outerRadius: number, fadeWidth: number, r: number): number {
  if (fadeWidth <= 0) return r <= outerRadius ? 1 : 0
  const t = Math.max(0, Math.min(1, (r - outerRadius) / fadeWidth))
  return 1 - t * t * (3 - 2 * t)
}
