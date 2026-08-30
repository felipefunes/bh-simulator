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

// Two ray tracers, selected by a uniform (spin/charge ~ 0 branches the same
// way for every pixel, so this costs nothing extra in the Schwarzschild
// case):
//
// - Schwarzschild (spin ~ 0 and charge ~ 0): mirrors physics/lensing.ts's
//   traceSchwarzschildRay — the ray stays in a fixed 2D plane, integrated in
//   φ. Much cheaper, used whenever there's no spin or charge to bend light
//   off-plane / change Δ.
// - Kerr–Newman (spin > 0 or charge > 0): mirrors physics/kerrLensing.ts's
//   traceKerrRay — full Carter-constant geodesics via Mino-time RK4 on
//   (r, θ, φ, w_r, w_θ). See that module for the derivation and the vitest
//   coverage (Schwarzschild reduction at a=0/e=0, exact critical impact
//   parameter for both spin and charge, frame-dragging asymmetry) this GLSL
//   translation relies on.
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uCameraPos;
  uniform sampler2D uBackgroundTexture;
  uniform float uMass;
  uniform float uSpin;
  uniform float uCharge;
  uniform float uHorizonRadius;
  uniform float uMaxRadius;
  varying vec3 vWorldPos;

  const int MAX_STEPS_SCHW = 220;
  const float D_PHI = 0.03;
  const int MAX_STEPS_KERR = 2200;
  const float D_TAU = 0.0007;
  const float PI = 3.14159265359;
  const vec3 SPIN_AXIS = vec3(0.0, 1.0, 0.0);

  vec2 equirectUv(vec3 dir) {
    float phi = atan(dir.z, dir.x);
    float theta = acos(clamp(dir.y, -1.0, 1.0));
    return vec2(phi / (2.0 * PI) + 0.5, theta / PI);
  }

  vec3 traceSchwarzschild(vec3 ro, vec3 rd, out bool captured) {
    float r0 = length(ro);
    vec3 e1 = ro / r0;
    vec3 tangential = rd - dot(rd, e1) * e1;
    float rdTangential = length(tangential);

    if (rdTangential < 1e-4) {
      captured = dot(rd, e1) < 0.0;
      return rd;
    }

    vec3 e2 = tangential / rdTangential;
    float rdRadial = dot(rd, e1);

    float u = 1.0 / r0;
    float v = -u * (rdRadial / rdTangential);
    float phi = 0.0;
    float uHorizon = 1.0 / uHorizonRadius;
    float uMin = 1.0 / uMaxRadius;
    bool escaped = false;

    for (int i = 0; i < MAX_STEPS_SCHW; i++) {
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

      if (u > uHorizon) { captured = true; return rd; }
      if (u < uMin) { escaped = true; break; }
    }

    if (!escaped) { captured = true; return rd; }

    captured = false;
    float cosPhi = cos(phi);
    float sinPhi = sin(phi);
    float e1Comp = -(v / u) * cosPhi - sinPhi;
    float e2Comp = -(v / u) * sinPhi + cosPhi;
    return normalize(e1Comp * e1 + e2Comp * e2);
  }

  // Θ(θ) and its derivative divide by sin²θ/sin³θ, which blow up as a ray's
  // θ approaches the poles (looking straight along the spin axis) — for a
  // genuine photon orbit with L≠0 this never actually happens (Θ would go
  // negative first, forcing a turning point well before the pole), but
  // floating-point roundoff right at that boundary can still send a stray
  // ray through the singularity, producing a visible bright line straight
  // up/down the spin axis. Clamping keeps every real trajectory unaffected
  // (they never get this close to sin θ = 0) while killing the artifact.
  float safeSin(float theta) {
    float s = sin(theta);
    return s >= 0.0 ? max(s, 1e-3) : min(s, -1e-3);
  }

  // Returns the equirectangular UV to sample directly from (theta, phi),
  // rather than reconstructing a Cartesian direction and re-deriving UV
  // from it via atan2/acos. That round trip is where the pole artifact
  // actually came from: for a ray whose bent path swings close to the spin
  // axis, sin(theta) shrinks toward zero, so its Cartesian x/z components
  // (built from sinTheta*cos(phi)/sinTheta*sin(phi)) become vanishingly
  // small — and re-extracting phi from atan2 of two near-zero floats is
  // exactly where floating-point noise blows up into a visible seam
  // (confirmed by feeding finalDir straight to the framebuffer as a color:
  // the seam showed up as a literal discontinuity in the direction vector
  // itself, not in capture/escape or in the texture lookup). Sampling
  // straight from the already-smooth, already-accumulated phi sidesteps
  // that reconstruction entirely — texture wrapping (RepeatWrapping on u)
  // handles phi being outside [-π, π] for free.
  vec2 traceKerr(vec3 ro, vec3 rd, out bool captured) {
    float M = uMass;
    float a = uSpin;
    float e2 = uCharge * uCharge;

    float r0 = length(ro);
    vec3 rHat = ro / r0;
    vec3 xRef = normalize(vec3(1.0, 0.0, 0.0) - SPIN_AXIS * dot(vec3(1.0, 0.0, 0.0), SPIN_AXIS));
    vec3 yRef = cross(SPIN_AXIS, xRef);

    float theta0 = acos(clamp(dot(rHat, SPIN_AXIS), -1.0, 1.0));
    float phi0 = atan(dot(rHat, yRef), dot(rHat, xRef));

    vec3 impactVec = cross(ro, rd);
    float L = dot(impactVec, SPIN_AXIS);
    float Q = max(0.0, dot(impactVec, impactVec) - L * L);

    vec3 thetaHat = normalize(rHat * dot(rHat, SPIN_AXIS) - SPIN_AXIS);
    float rdRadial = dot(rd, rHat);
    float rdTheta = dot(rd, thetaHat);

    float r = r0;
    float theta = theta0;
    float phi = phi0;

    // R(r0), Θ(θ0) evaluated directly (not the flat-space rdRadial/rdTheta
    // approximation) — see kerrLensing.ts's doc comment for why this exact
    // seeding matters (a tiny mismatch here is invisible far away but
    // catastrophic once R(r) itself shrinks near the photon sphere).
    float P0 = r0 * r0 + a * a - a * L;
    float Delta0 = r0 * r0 - 2.0 * M * r0 + a * a + e2;
    float R0 = P0 * P0 - Delta0 * ((L - a) * (L - a) + Q);
    float c0 = cos(theta0);
    float s0 = safeSin(theta0);
    float Th0 = Q + c0 * c0 * (a * a - L * L / (s0 * s0));

    float wr = sign(rdRadial) * sqrt(max(0.0, R0));
    float wth = (rdTheta == 0.0 ? 1.0 : sign(rdTheta)) * sqrt(max(0.0, Th0));

    bool escaped = false;

    for (int i = 0; i < MAX_STEPS_KERR; i++) {
      // derivatives(r, theta, wr, wth) -> (dr, dth, dphi, dwr, dwth), inlined
      // four times for the RK4 stages.
      float k1r = wr;
      float k1th = wth;
      float s1 = safeSin(theta); float s12 = s1 * s1; float c1 = cos(theta);
      float Delta1 = r * r - 2.0 * M * r + a * a + e2;
      float P1 = r * r + a * a - a * L;
      float RmL1 = (L - a) * (L - a) + Q;
      float k1dphi = -(a - L / s12) + (a / Delta1) * P1;
      float k1dwr = (4.0 * r * P1 - 2.0 * (r - M) * RmL1) / 2.0;
      float k1dwth = (2.0 * c1 * (L * L / (s1 * s1 * s1) - a * a * s1)) / 2.0;

      float r2 = r + (D_TAU * 0.5) * k1r;
      float th2 = theta + (D_TAU * 0.5) * k1th;
      float wr2 = wr + (D_TAU * 0.5) * k1dwr;
      float wth2 = wth + (D_TAU * 0.5) * k1dwth;
      float k2r = wr2;
      float k2th = wth2;
      float s2_ = safeSin(th2); float s22 = s2_ * s2_; float c2_ = cos(th2);
      float Delta2 = r2 * r2 - 2.0 * M * r2 + a * a + e2;
      float P2 = r2 * r2 + a * a - a * L;
      float RmL2 = (L - a) * (L - a) + Q;
      float k2dphi = -(a - L / s22) + (a / Delta2) * P2;
      float k2dwr = (4.0 * r2 * P2 - 2.0 * (r2 - M) * RmL2) / 2.0;
      float k2dwth = (2.0 * c2_ * (L * L / (s2_ * s2_ * s2_) - a * a * s2_)) / 2.0;

      float r3 = r + (D_TAU * 0.5) * k2r;
      float th3 = theta + (D_TAU * 0.5) * k2th;
      float wr3 = wr + (D_TAU * 0.5) * k2dwr;
      float wth3 = wth + (D_TAU * 0.5) * k2dwth;
      float k3r = wr3;
      float k3th = wth3;
      float s3_ = safeSin(th3); float s32 = s3_ * s3_; float c3_ = cos(th3);
      float Delta3 = r3 * r3 - 2.0 * M * r3 + a * a + e2;
      float P3 = r3 * r3 + a * a - a * L;
      float RmL3 = (L - a) * (L - a) + Q;
      float k3dphi = -(a - L / s32) + (a / Delta3) * P3;
      float k3dwr = (4.0 * r3 * P3 - 2.0 * (r3 - M) * RmL3) / 2.0;
      float k3dwth = (2.0 * c3_ * (L * L / (s3_ * s3_ * s3_) - a * a * s3_)) / 2.0;

      float r4 = r + D_TAU * k3r;
      float th4 = theta + D_TAU * k3th;
      float wr4 = wr + D_TAU * k3dwr;
      float wth4 = wth + D_TAU * k3dwth;
      float k4r = wr4;
      float k4th = wth4;
      float s4_ = safeSin(th4); float s42 = s4_ * s4_; float c4_ = cos(th4);
      float Delta4 = r4 * r4 - 2.0 * M * r4 + a * a + e2;
      float P4 = r4 * r4 + a * a - a * L;
      float RmL4 = (L - a) * (L - a) + Q;
      float k4dphi = -(a - L / s42) + (a / Delta4) * P4;
      float k4dwr = (4.0 * r4 * P4 - 2.0 * (r4 - M) * RmL4) / 2.0;
      float k4dwth = (2.0 * c4_ * (L * L / (s4_ * s4_ * s4_) - a * a * s4_)) / 2.0;

      r += (D_TAU / 6.0) * (k1r + 2.0 * k2r + 2.0 * k3r + k4r);
      theta += (D_TAU / 6.0) * (k1th + 2.0 * k2th + 2.0 * k3th + k4th);
      phi += (D_TAU / 6.0) * (k1dphi + 2.0 * k2dphi + 2.0 * k3dphi + k4dphi);
      wr += (D_TAU / 6.0) * (k1dwr + 2.0 * k2dwr + 2.0 * k3dwr + k4dwr);
      wth += (D_TAU / 6.0) * (k1dwth + 2.0 * k2dwth + 2.0 * k3dwth + k4dwth);

      // A real photon orbit with L≠0 turns around before ever reaching the
      // pole (Θ(θ) hits zero first) — but a single RK4 step can overshoot
      // past that turning point numerically near the singularity. Reflect
      // theta/wth like a wall there instead of letting the ray punch
      // through, which otherwise shows up as a bright seam along the spin
      // axis.
      const float POLE_GUARD = 0.02;
      if (theta < POLE_GUARD) { theta = 2.0 * POLE_GUARD - theta; wth = -wth; }
      if (theta > PI - POLE_GUARD) { theta = 2.0 * (PI - POLE_GUARD) - theta; wth = -wth; }

      if (r < uHorizonRadius || !(r == r)) { captured = true; return vec2(0.0); }
      if (r > uMaxRadius) { escaped = true; break; }
    }

    if (!escaped) { captured = true; return vec2(0.0); }

    captured = false;
    return vec2(phi / (2.0 * PI) + 0.5, clamp(theta, 0.0, PI) / PI);
  }

  void main() {
    vec3 rd = normalize(vWorldPos - uCameraPos);
    bool captured = false;

    if (uSpin < 1e-4 && uCharge < 1e-4) {
      vec3 finalDir = traceSchwarzschild(uCameraPos, rd, captured);
      if (captured) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
      gl_FragColor = texture2D(uBackgroundTexture, equirectUv(finalDir));
      return;
    }

    vec2 uv = traceKerr(uCameraPos, rd, captured);
    if (captured) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
    gl_FragColor = texture2D(uBackgroundTexture, uv);
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
      uSpin: { value: params.spin },
      uCharge: { value: params.charge },
      uHorizonRadius: { value: horizonRadius },
      uMaxRadius: { value: 300 * params.mass },
    }),
    [texture, params.mass, params.spin, params.charge, horizonRadius],
  )

  useFrame(() => {
    const material = materialRef.current
    if (!material) return
    material.uniforms.uCameraPos.value.copy(camera.position)
    material.uniforms.uMass.value = params.mass
    material.uniforms.uSpin.value = params.spin
    material.uniforms.uCharge.value = params.charge
    material.uniforms.uHorizonRadius.value = horizonRadius
    material.uniforms.uMaxRadius.value = 300 * params.mass
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
