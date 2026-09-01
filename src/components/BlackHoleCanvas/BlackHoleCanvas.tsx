import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { horizonRadii } from '../../physics/metric'
import { iscoRadius } from '../../physics/orbits'
import { pixelRatioForQuality } from '../../physics/renderQuality'
import { useBlackHoleParams, useBlackHoleStore } from '../../store/blackHoleStore'
import { LensedBackground } from './LensedBackground'

// Wide enough that the temperature profile has room to cool from
// blue-white near the ISCO down to orange at the outer edge — a tighter
// disk stays uniformly hot-looking across its whole visible range.
const DISK_OUTER_TO_INNER_RATIO = 10

export function BlackHoleCanvas() {
  const params = useBlackHoleParams()
  const showDisk = useBlackHoleStore((state) => state.showDisk)
  const quality = useBlackHoleStore((state) => state.quality)
  const horizons = horizonRadii(params)
  const dpr = pixelRatioForQuality(quality, window.devicePixelRatio)

  // iscoRadius is only a closed form for Schwarzschild/Kerr (charge = 0, see
  // physics/orbits.ts); Reissner-Nordström/Kerr-Newman fall back to an
  // approximate multiple of the horizon until that closed form exists.
  const innerRadius = iscoRadius(params) ?? (horizons?.outer ?? params.mass) * 2
  const outerRadius = innerRadius * DISK_OUTER_TO_INNER_RATIO

  // The lensing shader itself renders both the shadow (larger than the true
  // horizon — the photon capture radius, 3√3M ≈ 5.2M vs. 2M — that's the
  // real "black hole photo" look) and, as of roadmap item 8, the disk: the
  // same curved ray that finds the shadow/background also checks for a
  // crossing of the disk plane, so the disk is properly lensed (deformed,
  // duplicated above/below the shadow) instead of drawn as flat, unlensed
  // particle geometry on top. showDisk (the visual-QA toggle added during
  // PR 6's review, to see pole artifacts unobscured) now disables that
  // check by passing null instead of real bounds. For a naked singularity
  // (horizons === null) the shadow just never captures light — see
  // LensedBackground/physics/lensing.ts.
  return (
    <Canvas camera={{ position: [0, 51, 111], fov: 50 }} dpr={dpr}>
      <LensedBackground
        params={params}
        horizonRadius={horizons?.outer ?? 1e-6}
        quality={quality}
        disk={showDisk ? { innerRadius, outerRadius } : null}
      />
      <ambientLight intensity={0.15} />
      <OrbitControls enableDamping minDistance={3} maxDistance={180} />
    </Canvas>
  )
}
