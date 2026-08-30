import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BlackHoleParams } from '../../physics/metric'
import { INTEGRATOR_QUALITY, type QualityLevel } from '../../physics/renderQuality'

const SPHERE_RADIUS = 500
// The "ray has escaped" threshold for the lensing integrators. This has to
// stay comfortably larger than the camera's actual distance from the black
// hole (fixed by BlackHoleCanvas's hardcoded camera position, ~122 units —
// it does NOT scale with mass) and smaller than SPHERE_RADIUS. It used to
// scale with mass (300 * mass), which put it *below* the camera distance
// at low mass (e.g. 90 at mass=0.3) — every ray then satisfied "escaped"
// after essentially zero integration, at close to the same starting
// theta/phi for every pixel regardless of screen position, collapsing the
// entire lensed background to a single sampled texture color.
const MAX_RAY_RADIUS = 400
// 4096x2048 rather than 2048x1024: gravitational lensing magnifies solid
// angle without bound near the photon sphere (in the limit, a full ring of
// sky maps to a single point), so any raster texture's 8-bit gradient steps
// (the galaxy smudge's radial gradient, in particular) eventually become
// visible as concentric bands once magnified enough — found via visual QA
// as a set of thin arcs near the shadow. Doubling resolution pushes the
// radius at which that becomes visible outward; it doesn't eliminate the
// underlying limit (a finite-resolution texture under unbounded
// magnification), which is the kind of fidelity/performance trade-off
// roadmap item 7's quality controls are meant to make tunable.
const TEXTURE_WIDTH = 4096
const TEXTURE_HEIGHT = 2048
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
  // Integrator quality (roadmap item 7): step *count* and step *size* are
  // both uniforms, driven from src/physics/renderQuality.ts's presets,
  // rather than the fixed consts this used to be. GLSL ES 1.00 requires a
  // for-loop's bound to be a compile-time constant, so the loops below keep
  // a fixed hard cap (comfortably above the "high" preset) and break early
  // once the uniform step count is reached — the cap itself never changes,
  // only how many iterations actually run before the break.
  uniform int uSchwSteps;
  uniform float uSchwDPhi;
  uniform int uKerrSteps;
  uniform float uKerrDTau;
  varying vec3 vWorldPos;

  const int MAX_STEPS_SCHW_CAP = 400;
  const int MAX_STEPS_KERR_CAP = 4000;
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

    for (int i = 0; i < MAX_STEPS_SCHW_CAP; i++) {
      if (i >= uSchwSteps) break;
      float k1u = v;
      float k1v = -u + 3.0 * uMass * u * u;
      float u2 = u + (uSchwDPhi * 0.5) * k1u;
      float v2 = v + (uSchwDPhi * 0.5) * k1v;
      float k2u = v2;
      float k2v = -u2 + 3.0 * uMass * u2 * u2;
      float u3 = u + (uSchwDPhi * 0.5) * k2u;
      float v3 = v + (uSchwDPhi * 0.5) * k2v;
      float k3u = v3;
      float k3v = -u3 + 3.0 * uMass * u3 * u3;
      float u4 = u + uSchwDPhi * k3u;
      float v4 = v + uSchwDPhi * k3v;
      float k4u = v4;
      float k4v = -u4 + 3.0 * uMass * u4 * u4;

      u += (uSchwDPhi / 6.0) * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
      v += (uSchwDPhi / 6.0) * (k1v + 2.0 * k2v + 2.0 * k3v + k4v);
      phi += uSchwDPhi;

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

    // Whether this ray has a real Θ(θ) turning point near the pole (a true
    // bounce) or genuinely has none (L≈0, Θ = Q + a²cos²θ stays ≥ 0 all the
    // way to the axis, so the ray passes over the pole into the opposite
    // half of the sky, φ → φ + π) — see the matching comment in
    // kerrLensing.ts's traceKerrRay for the full derivation and the visual
    // artifact (a faint periodic chain of duplicate star images up the
    // spin axis) this distinction fixes. Ray-invariant, so computed once
    // outside the step loop.
    const float POLE_GUARD = 0.02;
    float sinGuard = sin(POLE_GUARD);
    float cosGuard = cos(POLE_GUARD);
    float thetaNearPole = Q + cosGuard * cosGuard * (a * a - L * L / (sinGuard * sinGuard));
    bool isPoleCrossing = thetaNearPole > 0.0;

    for (int i = 0; i < MAX_STEPS_KERR_CAP; i++) {
      if (i >= uKerrSteps) break;
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

      float r2 = r + (uKerrDTau * 0.5) * k1r;
      float th2 = theta + (uKerrDTau * 0.5) * k1th;
      float wr2 = wr + (uKerrDTau * 0.5) * k1dwr;
      float wth2 = wth + (uKerrDTau * 0.5) * k1dwth;
      float k2r = wr2;
      float k2th = wth2;
      float s2_ = safeSin(th2); float s22 = s2_ * s2_; float c2_ = cos(th2);
      float Delta2 = r2 * r2 - 2.0 * M * r2 + a * a + e2;
      float P2 = r2 * r2 + a * a - a * L;
      float RmL2 = (L - a) * (L - a) + Q;
      float k2dphi = -(a - L / s22) + (a / Delta2) * P2;
      float k2dwr = (4.0 * r2 * P2 - 2.0 * (r2 - M) * RmL2) / 2.0;
      float k2dwth = (2.0 * c2_ * (L * L / (s2_ * s2_ * s2_) - a * a * s2_)) / 2.0;

      float r3 = r + (uKerrDTau * 0.5) * k2r;
      float th3 = theta + (uKerrDTau * 0.5) * k2th;
      float wr3 = wr + (uKerrDTau * 0.5) * k2dwr;
      float wth3 = wth + (uKerrDTau * 0.5) * k2dwth;
      float k3r = wr3;
      float k3th = wth3;
      float s3_ = safeSin(th3); float s32 = s3_ * s3_; float c3_ = cos(th3);
      float Delta3 = r3 * r3 - 2.0 * M * r3 + a * a + e2;
      float P3 = r3 * r3 + a * a - a * L;
      float RmL3 = (L - a) * (L - a) + Q;
      float k3dphi = -(a - L / s32) + (a / Delta3) * P3;
      float k3dwr = (4.0 * r3 * P3 - 2.0 * (r3 - M) * RmL3) / 2.0;
      float k3dwth = (2.0 * c3_ * (L * L / (s3_ * s3_ * s3_) - a * a * s3_)) / 2.0;

      float r4 = r + uKerrDTau * k3r;
      float th4 = theta + uKerrDTau * k3th;
      float wr4 = wr + uKerrDTau * k3dwr;
      float wth4 = wth + uKerrDTau * k3dwth;
      float k4r = wr4;
      float k4th = wth4;
      float s4_ = safeSin(th4); float s42 = s4_ * s4_; float c4_ = cos(th4);
      float Delta4 = r4 * r4 - 2.0 * M * r4 + a * a + e2;
      float P4 = r4 * r4 + a * a - a * L;
      float RmL4 = (L - a) * (L - a) + Q;
      float k4dphi = -(a - L / s42) + (a / Delta4) * P4;
      float k4dwr = (4.0 * r4 * P4 - 2.0 * (r4 - M) * RmL4) / 2.0;
      float k4dwth = (2.0 * c4_ * (L * L / (s4_ * s4_ * s4_) - a * a * s4_)) / 2.0;

      r += (uKerrDTau / 6.0) * (k1r + 2.0 * k2r + 2.0 * k3r + k4r);
      theta += (uKerrDTau / 6.0) * (k1th + 2.0 * k2th + 2.0 * k3th + k4th);
      phi += (uKerrDTau / 6.0) * (k1dphi + 2.0 * k2dphi + 2.0 * k3dphi + k4dphi);
      wr += (uKerrDTau / 6.0) * (k1dwr + 2.0 * k2dwr + 2.0 * k3dwr + k4dwr);
      wth += (uKerrDTau / 6.0) * (k1dwth + 2.0 * k2dwth + 2.0 * k3dwth + k4dwth);

      // A real photon orbit with L≠0 turns around before ever reaching the
      // pole (Θ(θ) hits zero first) — but a single RK4 step can overshoot
      // past that turning point numerically near the singularity. Reflect
      // theta/wth like a wall there instead of letting the ray punch
      // through, which otherwise shows up as a bright seam along the spin
      // axis. When there's no real turning point nearby (isPoleCrossing,
      // computed once above), the ray is genuinely passing over the pole
      // into the opposite half of the sky, so φ picks up an extra π.
      if (theta < POLE_GUARD) {
        theta = 2.0 * POLE_GUARD - theta; wth = -wth;
        if (isPoleCrossing) phi += PI;
      }
      if (theta > PI - POLE_GUARD) {
        theta = 2.0 * (PI - POLE_GUARD) - theta; wth = -wth;
        if (isPoleCrossing) phi += PI;
      }

      if (r < uHorizonRadius || !(r == r)) { captured = true; return vec2(0.0); }
      if (r > uMaxRadius) { escaped = true; break; }
    }

    if (!escaped) { captured = true; return vec2(0.0); }

    captured = false;
    return vec2(phi / (2.0 * PI) + 0.5, clamp(theta, 0.0, PI) / PI);
  }

  // Samples the background for a ray handled by the pure-mass Schwarzschild
  // tracer — used only when there's no spin or charge at all (a > 0 or
  // e > 0 always goes through kerrColor below, everywhere on the sky,
  // including near the poles; see that function's comment for why).
  vec3 schwarzschildColor(vec3 ro, vec3 rd, out bool captured) {
    vec3 finalDir = traceSchwarzschild(ro, rd, captured);
    if (captured) return vec3(0.0);
    return texture2D(uBackgroundTexture, equirectUv(finalDir)).rgb;
  }

  // Samples the background for a ray handled by the full Kerr–Newman
  // tracer, including the poleFade treatment for the background texture's
  // own (unrelated) pole degeneracy below.
  //
  // An earlier version of this file routed rays whose trajectory swings
  // close to the spin axis to the Schwarzschild tracer instead, reasoning
  // that frame dragging vanishes on-axis so ignoring spin there is a safe
  // approximation, precisely where the Kerr integrator's Θ(θ) (with its
  // 1/sin³θ terms) was assumed least reliable. That fallback was itself the
  // bug, not the fix: the two tracers generally land on a *different* final
  // (θ,φ) for the same ray (frame dragging is small near the axis, but not
  // exactly zero off it, and the two integrators don't otherwise agree
  // pixel-for-pixel), so wherever the switch condition crossed there was a
  // visible seam between two differently-sampled patches of sky. Tried as a
  // hard switch, this showed up as a wedge spanning the whole frame (fixed
  // by also requiring a small impact parameter — see git history); tried
  // again as a smoothly-feathered blend confined close to the hole, it
  // still showed up as a pair of dark "hourglass cones" reaching out from
  // the poles, because the two tracers' predicted sky directions disagree
  // by tens of degrees right at the boundary, not by noise-level amounts —
  // no amount of feathering hides a disagreement that large. Verified (by
  // temporarily forcing every spinning/charged ray through this function
  // alone, no fallback at all) that the direct-UV-sampling fix and the
  // POLE_GUARD reflection inside traceKerr, on their own, are already
  // numerically stable enough near the axis — the fallback was solving a
  // problem that a previous fix had already solved, and only introducing a
  // new one.
  vec3 kerrColor(vec3 ro, vec3 rd, out bool captured) {
    vec2 uv = traceKerr(ro, rd, captured);
    if (captured) return vec3(0.0);

    // An equirectangular texture is mathematically degenerate exactly at
    // its poles (every u maps to the same physical point when v is 0 or 1),
    // and rays whose bent path swings close to the spin axis land right in
    // that degenerate strip — any leftover floating-point noise in exactly
    // which u they land on reads as a bright seam, and it's most visible
    // wherever it happens to cross a bright part of the texture (a star
    // field pixel doesn't show it; the lensed galaxy glow does). Rather
    // than chase that noise further inside the delicate RK4 integration,
    // fade the sample to black right at the poles — a sliver of solid
    // angle nobody would notice missing, in exchange for never showing the
    // seam at all.
    float sinThetaFinal = sin(uv.y * PI);
    float poleFade = smoothstep(0.0, 0.08, sinThetaFinal);
    return texture2D(uBackgroundTexture, uv).rgb * poleFade;
  }

  void main() {
    vec3 rd = normalize(vWorldPos - uCameraPos);

    if (uSpin < 1e-4 && uCharge < 1e-4) {
      bool captured = false;
      gl_FragColor = vec4(schwarzschildColor(uCameraPos, rd, captured), 1.0);
      return;
    }

    bool captured = false;
    gl_FragColor = vec4(kerrColor(uCameraPos, rd, captured), 1.0);
  }
`

export function LensedBackground({
  params,
  horizonRadius,
  quality,
}: {
  params: BlackHoleParams
  horizonRadius: number
  quality: QualityLevel
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
      uMaxRadius: { value: MAX_RAY_RADIUS },
      uSchwSteps: { value: INTEGRATOR_QUALITY[quality].schwSteps },
      uSchwDPhi: { value: INTEGRATOR_QUALITY[quality].schwDPhi },
      uKerrSteps: { value: INTEGRATOR_QUALITY[quality].kerrSteps },
      uKerrDTau: { value: INTEGRATOR_QUALITY[quality].kerrDTau },
    }),
    [texture, params.mass, params.spin, params.charge, horizonRadius, quality],
  )

  useFrame(() => {
    const material = materialRef.current
    if (!material) return
    material.uniforms.uCameraPos.value.copy(camera.position)
    material.uniforms.uMass.value = params.mass
    material.uniforms.uSpin.value = params.spin
    material.uniforms.uCharge.value = params.charge
    material.uniforms.uHorizonRadius.value = horizonRadius
    material.uniforms.uMaxRadius.value = MAX_RAY_RADIUS
    const preset = INTEGRATOR_QUALITY[quality]
    material.uniforms.uSchwSteps.value = preset.schwSteps
    material.uniforms.uSchwDPhi.value = preset.schwDPhi
    material.uniforms.uKerrSteps.value = preset.kerrSteps
    material.uniforms.uKerrDTau.value = preset.kerrDTau
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
        precision="highp"
      />
    </mesh>
  )
}
