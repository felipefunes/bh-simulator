import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { diskTemperature } from '../../physics/accretionDisk'

const DISK_PARTICLE_COUNT = 8000
const DISK_THICKNESS = 0.15
const POINT_SIZE_SCALE = 260.0

function generateDiskAttributes(mass: number, innerRadius: number, outerRadius: number) {
  const positions = new Float32Array(DISK_PARTICLE_COUNT * 3)
  const baseTemperatures = new Float32Array(DISK_PARTICLE_COUNT)
  const velocityDirs = new Float32Array(DISK_PARTICLE_COUNT * 3)
  const radii = new Float32Array(DISK_PARTICLE_COUNT)
  const angularSpeeds = new Float32Array(DISK_PARTICLE_COUNT)
  const angles = new Float32Array(DISK_PARTICLE_COUNT)

  for (let i = 0; i < DISK_PARTICLE_COUNT; i++) {
    const r = THREE.MathUtils.lerp(innerRadius, outerRadius, Math.random() ** 0.5)
    const theta = Math.random() * Math.PI * 2
    const z = (Math.random() - 0.5) * DISK_THICKNESS * (r / outerRadius)

    radii[i] = r
    angles[i] = theta
    // Keplerian angular velocity Ω(r) = sqrt(M/r^3).
    angularSpeeds[i] = Math.sqrt(mass / (r * r * r))
    baseTemperatures[i] = diskTemperature(innerRadius, r)

    positions[i * 3] = r * Math.cos(theta)
    positions[i * 3 + 1] = z
    positions[i * 3 + 2] = r * Math.sin(theta)

    // Tangential unit vector (direction of orbital motion) at this angle.
    velocityDirs[i * 3] = -Math.sin(theta)
    velocityDirs[i * 3 + 1] = 0
    velocityDirs[i * 3 + 2] = Math.cos(theta)
  }

  return { positions, baseTemperatures, velocityDirs, radii, angularSpeeds, angles }
}

const VERTEX_SHADER = /* glsl */ `
  uniform float uMass;
  attribute float baseTemperature;
  attribute vec3 velocityDir;
  attribute float radius;
  varying vec3 vColor;

  // Mirrors src/physics/accretionDisk.ts — see that module for the
  // derivation and vitest coverage (ISCO/photon-sphere speed checkpoints,
  // blueshift/redshift asymmetry) this GLSL translation relies on.
  float orbitalSpeedGLSL(float mass, float r) {
    return sqrt(mass / max(1e-6, r - 2.0 * mass));
  }

  float dopplerFactorGLSL(float mass, float r, float betaLineOfSight) {
    float beta = orbitalSpeedGLSL(mass, r);
    float gamma = 1.0 / sqrt(max(1e-9, 1.0 - beta * beta));
    float gravitational = sqrt(max(1e-9, 1.0 - 2.0 * mass / r));
    float onePlusZ = (gamma * (1.0 - betaLineOfSight)) / gravitational;
    return 1.0 / onePlusZ;
  }

  vec3 blackbodyColorGLSL(float temperatureKelvin) {
    float t = clamp(temperatureKelvin, 1000.0, 40000.0) / 100.0;

    float r = t <= 66.0 ? 255.0 : 329.698727446 * pow(t - 60.0, -0.1332047592);
    float g = t <= 66.0
      ? 99.4708025861 * log(t) - 161.1195681661
      : 288.1221695283 * pow(t - 60.0, -0.0755148492);
    float b;
    if (t >= 66.0) {
      b = 255.0;
    } else if (t <= 19.0) {
      b = 0.0;
    } else {
      b = 138.5177312231 * log(t - 10.0) - 305.0447927307;
    }

    return clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
  }

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    vec3 towardCamera = normalize(cameraPosition - position);
    float betaLineOfSight = orbitalSpeedGLSL(uMass, radius) * dot(velocityDir, towardCamera);
    float doppler = dopplerFactorGLSL(uMass, radius, betaLineOfSight);

    // Blueshift/redshift both shifts the apparent color (Wien's law: hotter
    // looks bluer) and boosts/dims the observed brightness (relativistic
    // beaming, intensity ~ D^3 for specific intensity).
    vColor = blackbodyColorGLSL(baseTemperature * doppler) * pow(doppler, 3.0);

    gl_PointSize = ${POINT_SIZE_SCALE.toFixed(1)} / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;

  void main() {
    gl_FragColor = vec4(vColor, 0.9);
  }
`

export function AccretionDisk({
  mass,
  innerRadius,
  outerRadius,
}: {
  mass: number
  innerRadius: number
  outerRadius: number
}) {
  const pointsRef = useRef<THREE.Points>(null)
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  // Per-particle simulation state, generated once per mount. It's only ever
  // read/mutated inside useFrame — never during render — so a plain ref (not
  // state/memo) is the right home for it, and in-place mutation is expected.
  // The component remounts (via the `key` its parent sets) whenever
  // innerRadius/outerRadius change, which regenerates this from scratch.
  const dataRef = useRef(generateDiskAttributes(mass, innerRadius, outerRadius))

  useFrame((_, delta) => {
    const geometry = pointsRef.current?.geometry
    if (!geometry) return

    const { positions, baseTemperatures, velocityDirs, radii, angularSpeeds, angles } = dataRef.current

    // Lazy-init: the buffer geometry attributes are wired up on the first
    // frame instead of a separate effect, so this is the only place that
    // touches the ref.
    if (!geometry.attributes.position) {
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('baseTemperature', new THREE.BufferAttribute(baseTemperatures, 1))
      geometry.setAttribute('velocityDir', new THREE.BufferAttribute(velocityDirs, 3))
      geometry.setAttribute('radius', new THREE.BufferAttribute(radii, 1))
    }

    const positionAttribute = geometry.attributes.position as THREE.BufferAttribute
    const velocityDirAttribute = geometry.attributes.velocityDir as THREE.BufferAttribute
    for (let i = 0; i < DISK_PARTICLE_COUNT; i++) {
      angles[i] += angularSpeeds[i] * delta
      const r = radii[i]
      const cosA = Math.cos(angles[i])
      const sinA = Math.sin(angles[i])
      positionAttribute.setX(i, r * cosA)
      positionAttribute.setZ(i, r * sinA)
      velocityDirAttribute.setXYZ(i, -sinA, 0, cosA)
    }
    positionAttribute.needsUpdate = true
    velocityDirAttribute.needsUpdate = true

    if (materialRef.current) {
      materialRef.current.uniforms.uMass.value = mass
    }
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry />
      <shaderMaterial
        ref={materialRef}
        uniforms={{ uMass: { value: mass } }}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        transparent
      />
    </points>
  )
}
