import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { horizonRadii } from '../../physics/metric'
import { iscoRadius } from '../../physics/orbits'
import { useBlackHoleParams, useBlackHoleStore } from '../../store/blackHoleStore'
import { AccretionDisk } from './AccretionDisk'
import { LensedBackground } from './LensedBackground'

// Wide enough that the temperature profile has room to cool from
// blue-white near the ISCO down to orange at the outer edge — a tighter
// disk stays uniformly hot-looking across its whole visible range.
const DISK_OUTER_TO_INNER_RATIO = 10

export function BlackHoleCanvas() {
  const params = useBlackHoleParams()
  const showDisk = useBlackHoleStore((state) => state.showDisk)
  const horizons = horizonRadii(params)

  // iscoRadius is only a closed form for Schwarzschild/Kerr (charge = 0, see
  // physics/orbits.ts); Reissner-Nordström/Kerr-Newman fall back to an
  // approximate multiple of the horizon until that closed form exists.
  const innerRadius = iscoRadius(params) ?? (horizons?.outer ?? params.mass) * 2
  const outerRadius = innerRadius * DISK_OUTER_TO_INNER_RATIO

  // The lensing shader itself renders the shadow (which is larger than the
  // true horizon — the photon capture radius, 3√3M ≈ 5.2M vs. 2M — that's
  // the real "black hole photo" look), so there's no separate horizon mesh
  // to draw. For a naked singularity (horizons === null) it just never
  // captures light — see LensedBackground/physics/lensing.ts.
  return (
    <Canvas camera={{ position: [0, 51, 111], fov: 50 }}>
      <LensedBackground params={params} horizonRadius={horizons?.outer ?? 1e-6} />
      <ambientLight intensity={0.15} />
      {showDisk && (
        <AccretionDisk
          key={`${innerRadius.toFixed(3)}-${outerRadius.toFixed(3)}`}
          mass={params.mass}
          innerRadius={innerRadius}
          outerRadius={outerRadius}
        />
      )}
      <OrbitControls enableDamping minDistance={3} maxDistance={180} />
    </Canvas>
  )
}
