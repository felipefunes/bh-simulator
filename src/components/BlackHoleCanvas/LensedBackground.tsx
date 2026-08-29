import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BlackHoleParams } from '../../physics/metric'

const SPHERE_RADIUS = 500
const TEXTURE_WIDTH = 2048
const TEXTURE_HEIGHT = 1024
const STAR_COUNT = 3000

function generateGalaxyBackgroundTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = TEXTURE_WIDTH
  canvas.height = TEXTURE_HEIGHT
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#04040c'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // A distant galaxy smudge, off-center so the lensing warp has a clear,
  // recognizable shape to bend around the shadow (the classic Einstein-ring
  // look when it lines up behind the black hole).
  ctx.save()
  ctx.translate(canvas.width * 0.62, canvas.height * 0.42)
  ctx.rotate(-0.35)
  ctx.scale(1, 0.4)
  const galaxyRadius = canvas.width * 0.16
  const galaxyGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, galaxyRadius)
  galaxyGradient.addColorStop(0, 'rgba(255, 244, 214, 0.95)')
  galaxyGradient.addColorStop(0.35, 'rgba(255, 205, 150, 0.5)')
  galaxyGradient.addColorStop(1, 'rgba(255, 205, 150, 0)')
  ctx.fillStyle = galaxyGradient
  ctx.beginPath()
  ctx.arc(0, 0, galaxyRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  for (let i = 0; i < STAR_COUNT; i++) {
    const x = Math.random() * canvas.width
    const y = Math.random() * canvas.height
    const brightness = Math.random()
    const radius = brightness > 0.97 ? 1.6 : brightness > 0.85 ? 1.0 : 0.6
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.3 + brightness * 0.7).toFixed(3)})`
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPos;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

// Mirrors src/physics/lensing.ts's traceSchwarzschildRay — see that module
// for the derivation and vitest coverage (weak-field deflection formula,
// critical impact parameter) this GLSL translation relies on.
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uCameraPos;
  uniform sampler2D uBackgroundTexture;
  uniform float uMass;
  uniform float uHorizonRadius;
  uniform float uMaxRadius;
  varying vec3 vWorldPos;

  const int MAX_STEPS = 220;
  const float D_PHI = 0.03;
  const float PI = 3.14159265359;

  vec2 equirectUv(vec3 dir) {
    float phi = atan(dir.z, dir.x);
    float theta = acos(clamp(dir.y, -1.0, 1.0));
    return vec2(phi / (2.0 * PI) + 0.5, theta / PI);
  }

  void main() {
    vec3 rd = normalize(vWorldPos - uCameraPos);
    float r0 = length(uCameraPos);
    vec3 e1 = uCameraPos / r0;

    vec3 tangential = rd - dot(rd, e1) * e1;
    float rdTangential = length(tangential);

    // Radial ray (b = 0): no deflection, no orbital plane to speak of.
    if (rdTangential < 1e-4) {
      if (dot(rd, e1) < 0.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      } else {
        gl_FragColor = texture2D(uBackgroundTexture, equirectUv(rd));
      }
      return;
    }

    vec3 e2 = tangential / rdTangential;
    float rdRadial = dot(rd, e1);

    float u = 1.0 / r0;
    float v = -u * (rdRadial / rdTangential);
    float phi = 0.0;
    float uHorizon = 1.0 / uHorizonRadius;
    float uMin = 1.0 / uMaxRadius;

    bool captured = false;
    bool escaped = false;

    for (int i = 0; i < MAX_STEPS; i++) {
      float k1u = v;
      float k1v = -u + 3.0 * uMass * u * u;

      float u2 = u + (D_PHI * 0.5) * k1u;
      float v2 = v + (D_PHI * 0.5) * k1v;
      float k2u = v2;
      float k2v = -u2 + 3.0 * uMass * u2 * u2;

      float u3 = u + (D_PHI * 0.5) * k2u;
      float v3 = v + (D_PHI * 0.5) * k2v;
      float k3u = v3;
      float k3v = -u3 + 3.0 * uMass * u3 * u3;

      float u4 = u + D_PHI * k3u;
      float v4 = v + D_PHI * k3v;
      float k4u = v4;
      float k4v = -u4 + 3.0 * uMass * u4 * u4;

      u += (D_PHI / 6.0) * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
      v += (D_PHI / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
      phi += D_PHI;

      if (u > uHorizon) {
        captured = true;
        break;
      }
      if (u < uMin) {
        escaped = true;
        break;
      }
    }

    // Ran out of steps without resolving: a ray spiraling near the photon
    // sphere, on an unstable orbit headed for the horizon either way.
    if (!escaped) {
      captured = true;
    }

    if (captured) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    float cosPhi = cos(phi);
    float sinPhi = sin(phi);
    float e1Comp = -(v / u) * cosPhi - sinPhi;
    float e2Comp = -(v / u) * sinPhi + cosPhi;
    vec3 finalDir = normalize(e1Comp * e1 + e2Comp * e2);

    gl_FragColor = texture2D(uBackgroundTexture, equirectUv(finalDir));
  }
`

export function LensedBackground({
  params,
  horizonRadius,
}: {
  params: BlackHoleParams
  horizonRadius: number
}) {
  const { camera } = useThree()
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const texture = useMemo(() => generateGalaxyBackgroundTexture(), [])

  useEffect(() => () => texture.dispose(), [texture])

  // Initial uniform values only — every frame after that, updates go through
  // materialRef (see useFrame below), never by mutating this object, so it's
  // fine for it to live in useMemo.
  const uniforms = useMemo(
    () => ({
      uCameraPos: { value: new THREE.Vector3() },
      uBackgroundTexture: { value: texture },
      uMass: { value: params.mass },
      uHorizonRadius: { value: horizonRadius },
      uMaxRadius: { value: 100 * params.mass },
    }),
    [texture, params.mass, horizonRadius],
  )

  useFrame(() => {
    const material = materialRef.current
    if (!material) return
    material.uniforms.uCameraPos.value.copy(camera.position)
    material.uniforms.uMass.value = params.mass
    material.uniforms.uHorizonRadius.value = horizonRadius
    material.uniforms.uMaxRadius.value = 100 * params.mass
  })

  return (
    <mesh>
      <sphereGeometry args={[SPHERE_RADIUS, 64, 64]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  )
}
