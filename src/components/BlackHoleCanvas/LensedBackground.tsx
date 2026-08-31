import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { BlackHoleParams } from '../../physics/metric'
import { INTEGRATOR_QUALITY, KERR_D_TAU, KERR_STEPS, type QualityLevel } from '../../physics/renderQuality'

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
// Disk half-thickness (roadmap: "un poco de espesor" — real accretion disks
// aren't infinitesimally thin, and a real plane is invisible when viewed
// exactly edge-on, which looked wrong), as a constant *fraction of
// innerRadius* rather than a fixed length — so it scales with the disk's
// own size across different mass/spin combinations, the same way
// innerRadius/outerRadius already do.
//
// A first version used a fixed *angle* from the equator (so the slab's
// physical thickness grew proportionally with r, i.e. a literal cone from
// the origin) instead of a constant height. Visual QA at a near-edge-on
// camera angle showed why that was wrong: under the disk's own strong
// lensing near the shadow, that flaring cone turned into a dramatic
// hourglass/"hi-hat" shape spanning most of the frame, not a subtly-thick
// disk. A constant physical half-thickness (this version, computed from
// innerRadius where params.disk is turned into a uniform, below) keeps the
// disk a real flat slab at every radius instead of flaring open.
const DISK_HALF_THICKNESS_RATIO = 0.15
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

const FLOW_TEXTURE_WIDTH = 1024
const FLOW_TEXTURE_HEIGHT = 256

// Procedural turbulence for the disk's "flow" look (roadmap: bring back the
// sense of rotation lost when the particle disk was replaced by a static
// analytic surface). U maps to φ around the disk — sampled through
// RepeatWrapping, so it must tile seamlessly at the U=0/1 seam — and each
// blob is drawn three times (shifted by ∓width) to guarantee that; V maps
// to normalized radius, and doesn't need to tile. Several octaves of soft
// blobs at different scales, layered on a neutral-gray base so diskColor's
// sampled value reads as "brightness relative to 1", not an absolute one.
function generateDiskFlowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = FLOW_TEXTURE_WIDTH
  canvas.height = FLOW_TEXTURE_HEIGHT
  const ctx = canvas.getContext('2d')!

  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const octaves = [
    { count: 40, radius: 90, alpha: 0.22 },
    { count: 90, radius: 40, alpha: 0.18 },
    { count: 180, radius: 16, alpha: 0.14 },
  ]

  for (const { count, radius, alpha } of octaves) {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * canvas.width
      const y = Math.random() * canvas.height
      const lighter = Math.random() > 0.5
      const shade = lighter ? 255 : 0
      for (const dx of [-canvas.width, 0, canvas.width]) {
        const gradient = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, radius)
        gradient.addColorStop(0, `rgba(${shade}, ${shade}, ${shade}, ${alpha})`)
        gradient.addColorStop(1, `rgba(${shade}, ${shade}, ${shade}, 0)`)
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.arc(x + dx, y, radius, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
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
  // Disk bounds (roadmap item 8) — the ray tracers below check for a
  // crossing of the equatorial plane within these radii and, if found,
  // terminate early with the disk's analytic color instead of the
  // background. innerRadius <= 0.0 (the showDisk-off sentinel from
  // BlackHoleCanvas) disables the check entirely, since a real disk always
  // has 0 < innerRadius < outerRadius.
  uniform float uDiskInnerRadius;
  uniform float uDiskOuterRadius;
  // Constant half-thickness (same length units as mass/radius) of the disk
  // slab around the equatorial plane — see physics/kerrLensing.ts's
  // DiskBounds for the rationale.
  uniform float uDiskHalfThickness;
  // Elapsed time (seconds) and a tileable procedural noise texture, for the
  // disk's rotating "flow" look — see diskColor's use of these below.
  uniform float uTime;
  uniform sampler2D uDiskFlowTexture;
  varying vec3 vWorldPos;

  const int MAX_STEPS_SCHW_CAP = 400;
  const int MAX_STEPS_KERR_CAP = 6000;
  const float PI = 3.14159265359;
  const vec3 SPIN_AXIS = vec3(0.0, 1.0, 0.0);
  const float PEAK_TEMPERATURE_KELVIN = 14000.0;
  // Real Keplerian angular speeds are minutes-per-orbit even at the inner
  // edge — matches AccretionDisk.tsx's old VISUAL_TIME_SCALE, kept for the
  // same reason (legibility), not physical accuracy.
  const float VISUAL_TIME_SCALE = 15.0;

  // Mirrors src/physics/accretionDisk.ts exactly (Shakura & Sunyaev 1973
  // profile) — see that module for the derivation and vitest coverage.
  float diskTemperatureGLSL(float innerRadius, float r) {
    if (r <= innerRadius) return 0.0;
    float peakRadius = innerRadius * (49.0 / 36.0);
    float shapeR = pow(r, -3.0) * (1.0 - sqrt(innerRadius / r));
    float shapePeak = pow(peakRadius, -3.0) * (1.0 - sqrt(innerRadius / peakRadius));
    return PEAK_TEMPERATURE_KELVIN * pow(max(0.0, shapeR) / shapePeak, 0.25);
  }

  // Mirrors src/physics/accretionDisk.ts's orbitalSpeed/combinedRedshiftFactor
  // (mass-only Schwarzschild approximation — extending to Kerr/Kerr-Newman
  // frame dragging is future work, same caveat that module's doc comments
  // already carry).
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

  // Analytic disk color at a crossing point — replaces the old opaque
  // particle geometry (roadmap item 8) so the disk is properly lensed
  // (deformed, and duplicated above/below the shadow) rather than drawn as
  // flat, unlensed geometry on top of the raytraced background. The
  // line-of-sight direction uses the straight line from the crossing point
  // to the camera as a proxy for the local photon direction, the same
  // approximation the old particle shader used (dot(velocityDir,
  // towardCamera)) — a fully rigorous treatment would project the photon's
  // actual local tetrad-frame direction instead, which is future work, same
  // as the mass-only (Schwarzschild) temperature/speed formulas above.
  vec3 diskColor(vec3 position, float radius) {
    vec3 radial = position / radius;
    // Unit tangential (orbital-motion) direction, derived from d(position)/dφ
    // in traceKerr's own (xRef, yRef) convention — see the comment at this
    // function's call sites for the derivation. Using this rather than the
    // old particle shader's convention keeps the disk co-rotating with
    // prograde photons (L > 0), the standard physical configuration.
    vec3 tangential = vec3(radial.z, 0.0, -radial.x);
    vec3 towardCamera = normalize(uCameraPos - position);
    float betaLineOfSight = orbitalSpeedGLSL(uMass, radius) * dot(tangential, towardCamera);
    float doppler = dopplerFactorGLSL(uMass, radius, betaLineOfSight);
    float baseTemperature = diskTemperatureGLSL(uDiskInnerRadius, radius);
    vec3 color = blackbodyColorGLSL(baseTemperature * doppler) * pow(doppler, 3.0);

    // Flow texture (roadmap: bring back the sense of rotation the old
    // particle disk showed, lost when it became a static analytic surface —
    // a symmetric steady-state disk's brightness *pattern* genuinely
    // doesn't change over time, so nothing here needed to animate before
    // this). world-frame φ (this convention, not any particular tracer's
    // own — position is already an exact world-space point regardless of
    // which tracer produced it) minus the local Keplerian Ω(r)·t puts the
    // noise texture in a frame co-rotating with the gas at that radius, so
    // it visibly advects around the disk — faster near the ISCO than at
    // the outer edge, same real differential rotation as physics/orbits.ts,
    // just VISUAL_TIME_SCALE-sped-up for the same reason the old particle
    // disk was (real Keplerian speeds here are minutes-per-orbit).
    float worldPhi = atan(-position.z, position.x);
    float omega = sqrt(uMass / (radius * radius * radius));
    float flowPhi = worldPhi - omega * uTime * VISUAL_TIME_SCALE;
    float flowU = flowPhi / (2.0 * PI) + 0.5;
    float flowV = clamp((radius - uDiskInnerRadius) / max(1e-6, uDiskOuterRadius - uDiskInnerRadius), 0.0, 1.0);
    float flow = texture2D(uDiskFlowTexture, vec2(flowU, flowV)).r;
    return color * (0.7 + 0.6 * flow);
  }

  vec2 equirectUv(vec3 dir) {
    float phi = atan(dir.z, dir.x);
    float theta = acos(clamp(dir.y, -1.0, 1.0));
    return vec2(phi / (2.0 * PI) + 0.5, theta / PI);
  }

  // Checks one segment of a Schwarzschild ray's step for a crossing of one
  // face of the disk's slab (world-space y = faceSign · halfThickness — a
  // *constant* height, the same everywhere along the disk, not one that
  // grows with r — the disk's two faces, or exactly y=0 for a
  // zero-thickness disk) — see traceSchwarzschild's use of this (four
  // segments × two faces per step, across its RK4 stage points, mirroring
  // checkDiskSegment for Kerr's θ) for why a single per-step endpoint check
  // isn't enough.
  //
  // A first version made the threshold r·sin(halfAngle) — a fixed *angle*
  // from the equator (a cone from the origin) rather than a fixed height.
  // Visual QA at a near-edge-on camera angle showed why that was wrong: a
  // cone's half-thickness grows without bound with r, and under the disk's
  // own strong lensing near the shadow that turned into a dramatic
  // hourglass/"hi-hat" shape spanning most of the frame, not a subtly-thick
  // disk. A constant physical thickness (this version) avoids that — the
  // disk stays a real flat slab at every radius instead of flaring open.
  bool checkDiskSegmentY(
    float aR, float aPhi, float bR, float bPhi,
    float e1y, float e2y, float faceSign, float halfThickness,
    float innerRadius, float outerRadius,
    out float hitRadius, out float hitPhi
  ) {
    float ay = aR * (cos(aPhi) * e1y + sin(aPhi) * e2y) - faceSign * halfThickness;
    float by = bR * (cos(bPhi) * e1y + sin(bPhi) * e2y) - faceSign * halfThickness;
    if (ay * by >= 0.0) return false;
    float fraction = ay / (ay - by);
    float r = aR + fraction * (bR - aR);
    if (r < innerRadius || r > outerRadius) return false;
    hitRadius = r;
    hitPhi = aPhi + fraction * (bPhi - aPhi);
    return true;
  }

  vec3 traceSchwarzschild(vec3 ro, vec3 rd, out bool captured, out bool diskHit, out vec3 diskPosition, out float diskRadius) {
    diskHit = false;
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
      float prevU = u;
      float prevPhi = phi;

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

      // Disk plane (world-space y=0) crossing — see traceSchwarzschildRay's
      // doc comment in physics/lensing.ts for the full derivation (e1/e2 are
      // this ray's own world-space orbital-plane basis, so their y
      // components are all that's needed to reconstruct the position's
      // y-coordinate without a full 3D reconstruction) and for why this
      // checks the RK4 stage points rather than just this step's two
      // endpoints. φ is the independent variable here (not integrated), so
      // stages 2 and 3 both land at exactly prevPhi + dPhi/2 and stage 4 at
      // exactly prevPhi + dPhi — no interpolation needed for φ, only r
      // (=1/u2, 1/u3, 1/u4) differs between them.
      if (uDiskInnerRadius > 0.0) {
        float prevR = 1.0 / prevU;
        float r2 = 1.0 / u2;
        float r3 = 1.0 / u3;
        float r4 = 1.0 / u4;
        float phiMid = prevPhi + uSchwDPhi * 0.5;
        float phiEnd = prevPhi + uSchwDPhi;
        float newR = 1.0 / u;

        float hitR;
        float hitPhi;
        if (
          checkDiskSegmentY(prevR, prevPhi, r2, phiMid, e1.y, e2.y, 1.0, uDiskHalfThickness, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPhi) ||
          checkDiskSegmentY(prevR, prevPhi, r2, phiMid, e1.y, e2.y, -1.0, uDiskHalfThickness, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPhi) ||
          checkDiskSegmentY(r2, phiMid, r3, phiMid, e1.y, e2.y, 1.0, uDiskHalfThickness, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPhi) ||
          checkDiskSegmentY(r2, phiMid, r3, phiMid, e1.y, e2.y, -1.0, uDiskHalfThickness, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPhi) ||
          checkDiskSegmentY(r3, phiMid, r4, phiEnd, e1.y, e2.y, 1.0, uDiskHalfThickness, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPhi) ||
          checkDiskSegmentY(r3, phiMid, r4, phiEnd, e1.y, e2.y, -1.0, uDiskHalfThickness, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPhi) ||
          checkDiskSegmentY(r4, phiEnd, newR, phiEnd, e1.y, e2.y, 1.0, uDiskHalfThickness, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPhi) ||
          checkDiskSegmentY(r4, phiEnd, newR, phiEnd, e1.y, e2.y, -1.0, uDiskHalfThickness, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPhi)
        ) {
          diskHit = true;
          diskRadius = hitR;
          diskPosition = hitR * cos(hitPhi) * e1 + hitR * sin(hitPhi) * e2;
          captured = false;
          return rd;
        }
      }

      if (u > uHorizon) { captured = true; return rd; }
      if (u < uMin) { escaped = true; break; }
    }

    if (!escaped) { captured = true; return rd; }

    captured = false;
    float cosPhiFinal = cos(phi);
    float sinPhiFinal = sin(phi);
    float e1Comp = -(v / u) * cosPhiFinal - sinPhiFinal;
    float e2Comp = -(v / u) * sinPhiFinal + cosPhiFinal;
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
  // Checks one segment of a Kerr ray's step for a crossing of one face of
  // the disk's slab (world-space y = faceSign · halfThickness — a constant
  // height, the disk's two faces, or exactly y=0 for a zero-thickness disk;
  // y = r·cosθ since the spin axis is world Y) — see traceKerr's use of
  // this (four segments × two faces per step, across its RK4 stage points)
  // for why a single per-step endpoint check isn't enough. Takes explicit
  // points rather than an array to stay clear of GLSL ES 1.00's
  // restrictions on dynamically-indexed arrays.
  //
  // A first version made the threshold a fixed *angle* from the equator
  // (θ = π/2 ∓ halfAngle, a cone from the origin) rather than a fixed
  // height. Visual QA at a near-edge-on camera angle showed why that was
  // wrong: a cone's half-thickness grows without bound with r, and under
  // the disk's own strong lensing near the shadow that turned into a
  // dramatic hourglass/"hi-hat" shape spanning most of the frame, not a
  // subtly-thick disk. A constant physical thickness (this version) avoids
  // that — the disk stays a real flat slab at every radius instead of
  // flaring open. The hit position is reconstructed from (r, y, φ) directly
  // — ρ = √(r²−y²) is the in-plane (xRef/yRef) distance from the spin axis
  // — rather than via θ, since only y (the exact face height) and r
  // (interpolated) are known at the crossing, not θ itself.
  bool checkDiskSegment(
    float aR, float aTheta, float aPhi,
    float bR, float bTheta, float bPhi,
    float faceSign, float halfThickness,
    vec3 xRef, vec3 yRef, float innerRadius, float outerRadius,
    out float hitRadius, out vec3 hitPosition
  ) {
    float ay = aR * cos(aTheta) - faceSign * halfThickness;
    float by = bR * cos(bTheta) - faceSign * halfThickness;
    if (ay * by >= 0.0) return false;
    float fraction = ay / (ay - by);
    float r = aR + fraction * (bR - aR);
    if (r < innerRadius || r > outerRadius) return false;
    float phi = aPhi + fraction * (bPhi - aPhi);
    float y = faceSign * halfThickness;
    float rho = sqrt(max(0.0, r * r - y * y));
    hitRadius = r;
    hitPosition = rho * cos(phi) * xRef + rho * sin(phi) * yRef + y * SPIN_AXIS;
    return true;
  }

  vec2 traceKerr(vec3 ro, vec3 rd, out bool captured, out bool diskHit, out vec3 diskPosition, out float diskRadius) {
    diskHit = false;
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
      float prevR = r;
      float prevTheta = theta;
      float prevPhi = phi;

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

      // Disk plane (θ=π/2) crossing — see traceKerrRay's doc comment in
      // physics/kerrLensing.ts for the full derivation, and in particular
      // for why this checks the RK4 stage points (start → stage 2 → stage 3
      // → stage 4 → end) rather than just this step's two endpoints or a
      // linear subdivision of them. A same-step crossing near the photon
      // sphere can otherwise alias away (found via visual QA as a literal
      // notch bitten out of the lensed disk at moderate-to-high spin) —
      // and linear interpolation between two same-side endpoints
      // *cannot* reveal it no matter how finely subdivided, since it's
      // monotonic between them by construction (confirmed empirically: an
      // 8-point subdivision left the notch completely unchanged). The
      // stage points r2/th2, r3/th3, r4/th4 above are already real
      // derivative evaluations through the step (not interpolation), so a
      // same-step dip that reaches one does show up; phi2/phi3/phi4 here
      // cost only three extra multiply-adds since k1dphi/k2dphi/k3dphi are
      // already computed above. Checked before the POLE_GUARD block below,
      // which only ever adjusts theta near the poles (far from π/2) and is
      // irrelevant either way.
      if (uDiskInnerRadius > 0.0) {
        float phi2 = phi + (uKerrDTau * 0.5) * k1dphi;
        float phi3 = phi + (uKerrDTau * 0.5) * k2dphi;
        float phi4 = phi + uKerrDTau * k3dphi;

        float hitR;
        vec3 hitPos;
        if (
          checkDiskSegment(prevR, prevTheta, prevPhi, r2, th2, phi2, 1.0, uDiskHalfThickness, xRef, yRef, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPos) ||
          checkDiskSegment(prevR, prevTheta, prevPhi, r2, th2, phi2, -1.0, uDiskHalfThickness, xRef, yRef, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPos) ||
          checkDiskSegment(r2, th2, phi2, r3, th3, phi3, 1.0, uDiskHalfThickness, xRef, yRef, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPos) ||
          checkDiskSegment(r2, th2, phi2, r3, th3, phi3, -1.0, uDiskHalfThickness, xRef, yRef, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPos) ||
          checkDiskSegment(r3, th3, phi3, r4, th4, phi4, 1.0, uDiskHalfThickness, xRef, yRef, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPos) ||
          checkDiskSegment(r3, th3, phi3, r4, th4, phi4, -1.0, uDiskHalfThickness, xRef, yRef, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPos) ||
          checkDiskSegment(r4, th4, phi4, r, theta, phi, 1.0, uDiskHalfThickness, xRef, yRef, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPos) ||
          checkDiskSegment(r4, th4, phi4, r, theta, phi, -1.0, uDiskHalfThickness, xRef, yRef, uDiskInnerRadius, uDiskOuterRadius, hitR, hitPos)
        ) {
          diskHit = true;
          diskRadius = hitR;
          diskPosition = hitPos;
          captured = false;
          return vec2(0.0);
        }
      }

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
    bool diskHit;
    vec3 diskPosition;
    float diskRadius;
    vec3 finalDir = traceSchwarzschild(ro, rd, captured, diskHit, diskPosition, diskRadius);
    if (diskHit) return diskColor(diskPosition, diskRadius);
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
    bool diskHit;
    vec3 diskPosition;
    float diskRadius;
    vec2 uv = traceKerr(ro, rd, captured, diskHit, diskPosition, diskRadius);
    if (diskHit) return diskColor(diskPosition, diskRadius);
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
  disk,
}: {
  params: BlackHoleParams
  horizonRadius: number
  quality: QualityLevel
  /** Disk radii in the same units as mass/horizonRadius, or null to disable the disk entirely (the showDisk sidebar toggle). */
  disk: { innerRadius: number; outerRadius: number } | null
}) {
  const { camera } = useThree()
  const materialRef = useRef<THREE.ShaderMaterial>(null)
  const texture = useMemo(() => generateGalaxyBackgroundTexture(), [])
  const flowTexture = useMemo(() => generateDiskFlowTexture(), [])

  useEffect(() => () => texture.dispose(), [texture])
  useEffect(() => () => flowTexture.dispose(), [flowTexture])

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
      // Not quality-dependent — see renderQuality.ts's doc comment on KERR_STEPS.
      uKerrSteps: { value: KERR_STEPS },
      uKerrDTau: { value: KERR_D_TAU },
      uDiskInnerRadius: { value: disk?.innerRadius ?? 0 },
      uDiskOuterRadius: { value: disk?.outerRadius ?? 0 },
      uDiskHalfThickness: { value: disk ? DISK_HALF_THICKNESS_RATIO * disk.innerRadius : 0 },
      uTime: { value: 0 },
      uDiskFlowTexture: { value: flowTexture },
    }),
    [texture, flowTexture, params.mass, params.spin, params.charge, horizonRadius, quality, disk],
  )

  useFrame((state) => {
    const material = materialRef.current
    if (!material) return
    material.uniforms.uCameraPos.value.copy(camera.position)
    material.uniforms.uMass.value = params.mass
    material.uniforms.uSpin.value = params.spin
    material.uniforms.uCharge.value = params.charge
    material.uniforms.uHorizonRadius.value = horizonRadius
    material.uniforms.uMaxRadius.value = MAX_RAY_RADIUS
    material.uniforms.uTime.value = state.clock.elapsedTime
    const preset = INTEGRATOR_QUALITY[quality]
    material.uniforms.uSchwSteps.value = preset.schwSteps
    material.uniforms.uSchwDPhi.value = preset.schwDPhi
    material.uniforms.uKerrSteps.value = KERR_STEPS
    material.uniforms.uKerrDTau.value = KERR_D_TAU
    material.uniforms.uDiskInnerRadius.value = disk?.innerRadius ?? 0
    material.uniforms.uDiskOuterRadius.value = disk?.outerRadius ?? 0
    material.uniforms.uDiskHalfThickness.value = disk ? DISK_HALF_THICKNESS_RATIO * disk.innerRadius : 0
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
