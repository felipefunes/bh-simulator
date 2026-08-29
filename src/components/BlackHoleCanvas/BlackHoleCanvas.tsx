import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { horizonRadii } from '../../physics/metric'
import { iscoRadius } from '../../physics/orbits'
import { useBlackHoleParams } from '../../store/blackHoleStore'
import { LensedBackground } from './LensedBackground'

const DISK_PARTICLE_COUNT = 8000
const DISK_THICKNESS = 0.15
const DISK_OUTER_TO_INNER_RATIO = 3.5

// Warm-to-white color ramp standing in for the disk's real temperature
// gradient (blackbody spectrum) and Doppler beaming, which land in a later PR.
const HOT_INNER_COLOR = new THREE.Color('#fff3d6')
const COOL_OUTER_COLOR = new THREE.Color('#ff6a2c')

function generateDiskAttributes(innerRadius: number, outerRadius: number) {
  const positions = new Float32Array(DISK_PARTICLE_COUNT * 3)
  const colors = new Float32Array(DISK_PARTICLE_COUNT * 3)
  const orbitalSpeeds = new Float32Array(DISK_PARTICLE_COUNT)
  const radii = new Float32Array(DISK_PARTICLE_COUNT)
  const angles = new Float32Array(DISK_PARTICLE_COUNT)

  for (let i = 0; i < DISK_PARTICLE_COUNT; i++) {
    const r = THREE.MathUtils.lerp(innerRadius, outerRadius, Math.random() ** 0.5)
    const theta = Math.random() * Math.PI * 2
    const z = (Math.random() - 0.5) * DISK_THICKNESS * (r / outerRadius)

    radii[i] = r
    angles[i] = theta
    // Placeholder Keplerian-like falloff (v ~ 1/sqrt(r)): inner particles
    // orbit faster than outer ones, foreshadowing the real orbital velocity
    // (frame-dragging included) that lands with the lensing shader.
    orbitalSpeeds[i] = 1 / Math.sqrt(r)

    positions[i * 3] = r * Math.cos(theta)
    positions[i * 3 + 1] = z
    positions[i * 3 + 2] = r * Math.sin(theta)

    const t = (r - innerRadius) / (outerRadius - innerRadius)
    const color = HOT_INNER_COLOR.clone().lerp(COOL_OUTER_COLOR, t)
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }

  return { positions, colors, orbitalSpeeds, radii, angles }
}

function AccretionDisk({ innerRadius, outerRadius }: { innerRadius: number; outerRadius: number }) {
  const pointsRef = useRef<THREE.Points>(null)
  // Per-particle simulation state, generated once per mount. It's only ever
  // read/mutated inside useFrame — never during render — so a plain ref (not
  // state/memo) is the right home for it, and in-place mutation is expected.
  // The component remounts (via the `key` its parent sets) whenever
  // innerRadius/outerRadius change, which regenerates this from scratch.
  const dataRef = useRef(generateDiskAttributes(innerRadius, outerRadius))

  useFrame((_, delta) => {
    const geometry = pointsRef.current?.geometry
    if (!geometry) return

    const { positions, colors, orbitalSpeeds, radii, angles } = dataRef.current

    // Lazy-init: the buffer geometry attributes are wired up on the first
    // frame instead of a separate effect, so this is the only place that
    // touches the ref.
    if (!geometry.attributes.position) {
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    }

    const positionAttribute = geometry.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < DISK_PARTICLE_COUNT; i++) {
      angles[i] += orbitalSpeeds[i] * delta
      const r = radii[i]
      positionAttribute.setX(i, r * Math.cos(angles[i]))
      positionAttribute.setZ(i, r * Math.sin(angles[i]))
    }
    positionAttribute.needsUpdate = true
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry />
      <pointsMaterial size={0.05} vertexColors sizeAttenuation transparent opacity={0.9} />
    </points>
  )
}

export function BlackHoleCanvas() {
  const params = useBlackHoleParams()
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
    <Canvas camera={{ position: [0, 18, 39], fov: 50 }}>
      <LensedBackground params={params} horizonRadius={horizons?.outer ?? 1e-6} />
      <ambientLight intensity={0.15} />
      <AccretionDisk
        key={`${innerRadius.toFixed(3)}-${outerRadius.toFixed(3)}`}
        innerRadius={innerRadius}
        outerRadius={outerRadius}
      />
      <OrbitControls enableDamping minDistance={3} maxDistance={60} />
    </Canvas>
  )
}
