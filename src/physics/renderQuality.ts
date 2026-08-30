export type QualityLevel = 'low' | 'medium' | 'high'

export interface IntegratorQuality {
  /** RK4 iteration cap for the Schwarzschild (u, v) tracer. */
  schwSteps: number
  /** φ step size for the Schwarzschild tracer. */
  schwDPhi: number
}

// "medium" reproduces the original, pre-quality-control Schwarzschild
// constants (see git history of LensedBackground.tsx) exactly, so existing
// renders don't shift under the default setting. Step count and step size
// are scaled inversely around that baseline so steps × stepSize — the total
// integrated range (φ swept) — stays the same across levels: "low" takes
// fewer, coarser steps over the *same* overall path instead of truncating
// the integration early, which would change where rays actually end up
// rather than just how precisely they get there.
const SCHW_TOTAL_PHI = 220 * 0.03

export const INTEGRATOR_QUALITY: Record<QualityLevel, IntegratorQuality> = {
  low: {
    schwSteps: 80,
    schwDPhi: SCHW_TOTAL_PHI / 80,
  },
  medium: {
    schwSteps: 220,
    schwDPhi: 0.03,
  },
  high: {
    schwSteps: 400,
    schwDPhi: SCHW_TOTAL_PHI / 400,
  },
}

/**
 * The Kerr–Newman (r, θ, φ, w_r, w_θ) tracer's RK4 step count/size is
 * *not* driven by the quality selector, unlike Schwarzschild's — it's fixed
 * at a single, generously precise setting instead. This isn't an
 * oversight: lower step counts here aren't just less crisp, they're
 * outright wrong. Found via visual QA at moderate spin — a coarser dτ left
 * a literal wedge/"notch" missing from the lensed disk — and root-caused to
 * the RK4 step itself being too large to reach θ's true extremum near the
 * photon sphere for strongly-bent rays, not merely under-sampling a
 * trajectory that was otherwise computed correctly (confirmed because
 * re-checking already-computed RK4 stage points, and even a fine linear
 * subdivision of a step, left the notch completely unchanged — only
 * shrinking dτ itself, i.e. more real integration steps, fixed it). Since
 * quality's original purpose (roadmap item 7) was performance, not
 * correctness, and a broken-looking disk is worse than a slower one, this
 * value is deliberately not part of that trade-off — true adaptive step
 * sizing (smaller dτ specifically near the photon sphere, standard step
 * size everywhere else) would let this scale back down safely, and is
 * future work.
 */
export const KERR_STEPS = 6000
const KERR_TOTAL_TAU = 2200 * 0.0007
export const KERR_D_TAU = KERR_TOTAL_TAU / KERR_STEPS

/**
 * Caps the render's device pixel ratio by quality level — the other lever
 * (besides integrator steps) for GPU cost, since the lensing fragment
 * shader's cost scales with pixel count. Takes the real devicePixelRatio so
 * a level never *upscales* past what the display actually has. This one
 * still applies uniformly regardless of spin/charge.
 */
export function pixelRatioForQuality(level: QualityLevel, devicePixelRatio: number): number {
  const cap = level === 'low' ? 1 : level === 'medium' ? 1.5 : 2
  return Math.min(devicePixelRatio, cap)
}
