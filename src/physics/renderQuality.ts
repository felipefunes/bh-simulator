export type QualityLevel = 'low' | 'medium' | 'high'

export interface IntegratorQuality {
  /** RK4 iteration cap for the Schwarzschild (u, v) tracer. */
  schwSteps: number
  /** φ step size for the Schwarzschild tracer. */
  schwDPhi: number
  /**
   * Total rays traced per pixel for the disk hit/miss decision (1 = no
   * supersampling, the original single-ray behavior). Only the disk boundary
   * needs this: near the shadow, a higher-order lensed image of the disk can
   * get compressed into a couple of screen pixels, so neighboring pixels jump
   * straight from "hits the disk" to "misses entirely" with no way to land
   * in between — not a fade-width bug (see LensedBackground.tsx's
   * outerEdgeFadeGLSL, which already handles the ordinary outer-edge case
   * fine), but plain aliasing from sampling that transition once per pixel.
   * Jittering a few extra rays within the pixel and averaging resolves it,
   * at roughly `diskSupersamples`× the shader's cost — reserved for "high"
   * so the default render is unaffected.
   */
  diskSupersamples: number
}

// This module used to also carry KERR_STEPS/KERR_D_TAU, a *fixed* (not
// quality-tunable) high step count for a full Carter-constant Kerr–Newman
// integrator — removed along with that integrator itself (see git history,
// and LensedBackground.tsx's "Modo Visual" comment) once it became clear its
// per-pixel cost, not disk-crossing bugs, was the actual ceiling on
// performance at high spin. Rendering now always uses the Schwarzschild
// tracer below (with a per-ray effective-mass bias standing in for real
// frame dragging), so this quality selector applies uniformly regardless of
// spin — a spinning hole is no longer a special, more expensive case.

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
    diskSupersamples: 1,
  },
  medium: {
    schwSteps: 220,
    schwDPhi: 0.03,
    diskSupersamples: 1,
  },
  high: {
    schwSteps: 400,
    schwDPhi: SCHW_TOTAL_PHI / 400,
    diskSupersamples: 5,
  },
}

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
