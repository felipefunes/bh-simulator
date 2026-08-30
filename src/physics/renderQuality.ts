export type QualityLevel = 'low' | 'medium' | 'high'

export interface IntegratorQuality {
  /** RK4 iteration cap for the Kerr–Newman (r, θ, φ, w_r, w_θ) tracer. */
  kerrSteps: number
  /** Mino-time step size (dτ = dλ/Σ) for the Kerr–Newman tracer. */
  kerrDTau: number
  /** RK4 iteration cap for the Schwarzschild (u, v) tracer. */
  schwSteps: number
  /** φ step size for the Schwarzschild tracer. */
  schwDPhi: number
}

// "medium" reproduces the original, pre-quality-control constants (see git
// history of LensedBackground.tsx) exactly, so existing renders don't shift
// under the default setting. Step count and step size are scaled inversely
// around that baseline so steps × stepSize — the total integrated range,
// Mino time for Kerr and φ for Schwarzschild — stays the same across levels:
// "low" takes fewer, coarser steps over the *same* overall path instead of
// truncating the integration early, which would change where rays actually
// end up rather than just how precisely they get there.
const KERR_TOTAL_TAU = 2200 * 0.0007
const SCHW_TOTAL_PHI = 220 * 0.03

export const INTEGRATOR_QUALITY: Record<QualityLevel, IntegratorQuality> = {
  low: {
    kerrSteps: 700,
    kerrDTau: KERR_TOTAL_TAU / 700,
    schwSteps: 80,
    schwDPhi: SCHW_TOTAL_PHI / 80,
  },
  medium: {
    kerrSteps: 2200,
    kerrDTau: 0.0007,
    schwSteps: 220,
    schwDPhi: 0.03,
  },
  high: {
    kerrSteps: 4000,
    kerrDTau: KERR_TOTAL_TAU / 4000,
    schwSteps: 400,
    schwDPhi: SCHW_TOTAL_PHI / 400,
  },
}

/**
 * Caps the render's device pixel ratio by quality level — the other lever
 * (besides integrator steps) for GPU cost, since the lensing fragment
 * shader's cost scales with pixel count. Takes the real devicePixelRatio so
 * a level never *upscales* past what the display actually has.
 */
export function pixelRatioForQuality(level: QualityLevel, devicePixelRatio: number): number {
  const cap = level === 'low' ? 1 : level === 'medium' ? 1.5 : 2
  return Math.min(devicePixelRatio, cap)
}
