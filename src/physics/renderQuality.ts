export type QualityLevel = 'low' | 'medium' | 'high'

export interface IntegratorQuality {
  /** RK4 iteration cap for the Schwarzschild (u, v) tracer. */
  schwSteps: number
  /** φ step size for the Schwarzschild tracer. */
  schwDPhi: number
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

// DISK_SUPERSAMPLES follows that same "fixed regardless of quality" pattern,
// for the same reason KERR_STEPS did: it was first added (see git history)
// gated to "high" only, as a genuine quality/performance trade-off — but a
// user report reproduced the exact aliasing it fixes (a dashed/cross-hatched
// patch right where the disk's edge grazes a higher-order lensed image of
// itself) at "low" and "medium" too, from a below-the-plane camera angle.
// Isolated by testing DISK_SUPERSAMPLES=5 at "medium"'s cheaper schwSteps,
// and separately at "low"'s (the coarsest integrator), with no other change:
// the artifact disappeared completely both times, regardless of integrator
// precision — proving this is purely single-ray aliasing, not an
// under-resolved-integration issue like the Kerr one above. So, matching the
// Kerr precedent: reducing it isn't a softer-but-cheaper option, it's a
// correctness bug, and "quality" only governs schwSteps/schwDPhi and pixel
// ratio (pixelRatioForQuality below) — the axes safe to reduce.
//
// A first version paid this 5x cost on *every* pixel at every quality level —
// rejected (before merge) for tanking performance at "medium", since it ran
// full-cost even over plain background and the wide, uncompressed part of
// the disk that was never at risk. LensedBackground.tsx's main() now gates
// it to pixels near the critical impact parameter (the strong-lensing region
// where this compression actually happens), so this constant is still always
// 5 — it's paid by far fewer pixels, not a smaller multiplier.
export const DISK_SUPERSAMPLES = 5

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
