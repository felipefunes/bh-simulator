import { create } from 'zustand'
import type { BlackHoleParams } from '../physics/metric'
import type { QualityLevel } from '../physics/renderQuality'

interface BlackHoleStore {
  mass: number
  /** a* = a / M, in [0, 1]. Normalized so the slider range doesn't depend on mass. */
  spinRatio: number
  /** Q* = Q / M, in [0, 1]. */
  chargeRatio: number
  /** Disables the lensed accretion disk (originally a visual-QA toggle, from before the disk was rendered by the lensing shader, so lensing artifacts near the poles/shadow weren't obscured by disk geometry — still useful for that). */
  showDisk: boolean
  /** Integrator steps + pixel ratio trade-off — see physics/renderQuality.ts. */
  quality: QualityLevel
  /** Labeled diagram overlay (event horizon / photon sphere / shadow / disk) — see components/BlackHoleCanvas/InfoTooltips.tsx. */
  showTooltips: boolean
  setMass: (mass: number) => void
  setSpinRatio: (spinRatio: number) => void
  setChargeRatio: (chargeRatio: number) => void
  setShowDisk: (showDisk: boolean) => void
  setQuality: (quality: QualityLevel) => void
  setShowTooltips: (showTooltips: boolean) => void
}

export const useBlackHoleStore = create<BlackHoleStore>((set) => ({
  mass: 0.75,
  spinRatio: 0,
  chargeRatio: 0,
  showDisk: true,
  quality: 'medium',
  showTooltips: false,
  setMass: (mass) => set({ mass }),
  setSpinRatio: (spinRatio) => set({ spinRatio }),
  setChargeRatio: (chargeRatio) => set({ chargeRatio }),
  setShowDisk: (showDisk) => set({ showDisk }),
  setQuality: (quality) => set({ quality }),
  setShowTooltips: (showTooltips) => set({ showTooltips }),
}))

/** The store's sliders as the absolute mass/spin/charge the physics module expects. */
export function useBlackHoleParams(): BlackHoleParams {
  const mass = useBlackHoleStore((state) => state.mass)
  const spinRatio = useBlackHoleStore((state) => state.spinRatio)
  const chargeRatio = useBlackHoleStore((state) => state.chargeRatio)
  return { mass, spin: mass * spinRatio, charge: mass * chargeRatio }
}
