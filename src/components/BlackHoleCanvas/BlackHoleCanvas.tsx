import { OrbitControls, Stars } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'

const EVENT_HORIZON_RADIUS = 1.5
const DISK_PARTICLE_COUNT = 8000
const DISK_INNER_RADIUS = EVENT_HORIZON_RADIUS * 2
const DISK_OUTER_RADIUS = EVENT_HORIZON_RADIUS * 7
const DISK_THICKNESS = 0.15

// Warm-to-white color ramp standing in for the disk's real temperature
// gradient (blackbody spectrum), which arrives with the physics module.
const HOT_INNER_COLOR = new THREE.Color('#fff3d6')
const COOL_OUTER_COLOR = new THREE.Color('#ff6a2c')

function generatePlaceholderDiskAttributes() {
  const positions = new Float32Array(DISK_PARTICLE_COUNT * 3)
  const colors = new Float32Array(DISK_PARTICLE_COUNT * 3)
  const orbitalSpeeds = new Float32Array(DISK_PARTICLE_COUNT)
  const radii = new Float32Array(DISK_PARTICLE_COUNT)
  const angles = new Float32Array(DISK_PARTICLE_COUNT)

  for (let i = 0; i < DISK_PARTICLE_COUNT; i++) {
    const r = THREE.MathUtils.lerp(
      DISK_INNER_RADIUS,
      DISK_OUTER_RADIUS,
      Math.random() ** 0.5,
    )
    const theta = Math.random() * Math.PI * 2
    const z = (Math.random() - 0.5) * DISK_THICKNESS * (r / DISK_OUTER_RADIUS)

    radii[i] = r
    angles[i] = theta
    // Placeholder Keplerian-like falloff (v ~ 1/sqrt(r)): inner particles
    // orbit faster than outer ones, foreshadowing the real rotation curve
    // that lands with the physics module.
    orbitalSpeeds[i] = 1 / Math.sqrt(r)

    positions[i * 3] = r * Math.cos(theta)
    positions[i * 3 + 1] = z
    positions[i * 3 + 2] = r * Math.sin(theta)

    const t = (r - DISK_INNER_RADIUS) / (DISK_OUTER_RADIUS - DISK_INNER_RADIUS)
    const color = HOT_INNER_COLOR.clone().lerp(COOL_OUTER_COLOR, t)
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }

  return { positions, colors, orbitalSpeeds, radii, angles }
}

function AccretionDisk() {
  const pointsRef = useRef<THREE.Points>(null)
  // Per-particle simulation state, generated once. It's only ever read/mutated
  // inside useFrame — never during render — so a plain ref (not state/memo)
  // is the right home for it, and in-place mutation is expected.
  const dataRef = useRef(generatePlaceholderDiskAttributes())

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

function EventHorizon() {
  return (
    <mesh>
      <sphereGeometry args={[EVENT_HORIZON_RADIUS, 64, 64]} />
      <meshBasicMaterial color="#000000" />
    </mesh>
  )
}

export function BlackHoleCanvas() {
  return (
    <Canvas camera={{ position: [0, 12, 26], fov: 50 }}>
      <color attach="background" args={['#000000']} />
      {/*
        Placeholder starfield standing in for the background galaxy image
        that the gravitational lensing shader will bend, once it lands.
      */}
      <Stars radius={80} depth={40} count={4000} factor={2} fade />
      <ambientLight intensity={0.15} />
      <EventHorizon />
      <AccretionDisk />
      <OrbitControls enableDamping minDistance={3} maxDistance={40} />
    </Canvas>
  )
}
