import { create } from 'zustand'
import type { BlackHoleParams } from '../physics/metric'

interface BlackHoleStore {
  mass: number
  /** a* = a / M, in [0, 1]. Normalized so the slider range doesn't depend on mass. */
  spinRatio: number
  /** Q* = Q / M, in [0, 1]. */
  chargeRatio: number
  /** Purely a visual QA toggle — hides AccretionDisk so lensing artifacts near the poles/shadow aren't obscured by disk geometry. */
  showDisk: boolean
  setMass: (mass: number) => void
  setSpinRatio: (spinRatio: number) => void
  setChargeRatio: (chargeRatio: number) => void
  setShowDisk: (showDisk: boolean) => void
}

export const useBlackHoleStore = create<BlackHoleStore>((set) => ({
  mass: 0.75,
  spinRatio: 0,
  chargeRatio: 0,
  showDisk: true,
  setMass: (mass) => set({ mass }),
  setSpinRatio: (spinRatio) => set({ spinRatio }),
  setChargeRatio: (chargeRatio) => set({ chargeRatio }),
  setShowDisk: (showDisk) => set({ showDisk }),
}))

/** The store's sliders as the absolute mass/spin/charge the physics module expects. */
export function useBlackHoleParams(): BlackHoleParams {
  const mass = useBlackHoleStore((state) => state.mass)
  const spinRatio = useBlackHoleStore((state) => state.spinRatio)
  const chargeRatio = useBlackHoleStore((state) => state.chargeRatio)
  return { mass, spin: mass * spinRatio, charge: mass * chargeRatio }
}
