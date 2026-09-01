import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useRef } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { horizonRadii } from '../../physics/metric'
import { iscoRadius } from '../../physics/orbits'
import { pixelRatioForQuality } from '../../physics/renderQuality'
import { useBlackHoleParams, useBlackHoleStore } from '../../store/blackHoleStore'
import './BlackHoleCanvas.css'
import { LensedBackground } from './LensedBackground'

// Wide enough that the temperature profile has room to cool from
// blue-white near the ISCO down to orange at the outer edge — a tighter
// disk stays uniformly hot-looking across its whole visible range.
const DISK_OUTER_TO_INNER_RATIO = 10

const ZOOM_IN_SCALE = 0.8
const ZOOM_OUT_SCALE = 1.25

export function BlackHoleCanvas() {
  const params = useBlackHoleParams()
  const showDisk = useBlackHoleStore((state) => state.showDisk)
  const quality = useBlackHoleStore((state) => state.quality)
  const horizons = horizonRadii(params)
  const dpr = pixelRatioForQuality(quality, window.devicePixelRatio)
  const controlsRef = useRef<OrbitControlsImpl>(null)

  // iscoRadius is only a closed form for Schwarzschild/Kerr (charge = 0, see
  // physics/orbits.ts); Reissner-Nordström/Kerr-Newman fall back to an
  // approximate multiple of the horizon until that closed form exists.
  const innerRadius = iscoRadius(params) ?? (horizons?.outer ?? params.mass) * 2
  const outerRadius = innerRadius * DISK_OUTER_TO_INNER_RATIO

  function zoomBy(scale: number) {
    const controls = controlsRef.current
    if (!controls) return

    const camera = controls.object
    const target = controls.target
    const offset = camera.position.clone().sub(target).multiplyScalar(scale)
    const distance = offset.length()
    if (distance < controls.minDistance || distance > controls.maxDistance) return

    camera.position.copy(target.clone().add(offset))
    controls.update()
  }

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
    <>
      <Canvas camera={{ position: [0, 51, 111], fov: 50 }} dpr={dpr}>
        <LensedBackground
          params={params}
          horizonRadius={horizons?.outer ?? 1e-6}
          quality={quality}
          disk={showDisk ? { innerRadius, outerRadius } : null}
        />
        <ambientLight intensity={0.15} />
        <OrbitControls ref={controlsRef} enableDamping minDistance={3} maxDistance={180} />
      </Canvas>

      <div className="black-hole-canvas__zoom-controls">
        <button
          type="button"
          className="black-hole-canvas__zoom-button"
          aria-label="Acercar"
          onClick={() => zoomBy(ZOOM_IN_SCALE)}
        >
          +
        </button>
        <button
          type="button"
          className="black-hole-canvas__zoom-button"
          aria-label="Alejar"
          onClick={() => zoomBy(ZOOM_OUT_SCALE)}
        >
          −
        </button>
      </div>
    </>
  )
}
