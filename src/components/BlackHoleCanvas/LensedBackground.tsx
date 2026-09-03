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
// Outer-edge dust fade (roadmap: "un poco de blur al borde externo del
// disco, de manera que se parezca más a un disco de polvo") — a fraction of
// outerRadius rather than a fixed length, same reasoning as the disk's own
// innerRadius/outerRadius ratio: scales with the disk's size across
// different mass/spin combinations instead of looking too thin or too wide
// at extreme values. See accretionDisk.ts's outerEdgeFade for the actual
// falloff shape (a smoothstep, not a real density/optical-depth model).
const DISK_OUTER_FADE_RATIO = 0.15
// The disk briefly had physical thickness (roadmap: "un poco de espesor")
// via a constant half-thickness fraction of innerRadius — see git history
// (removed after it turned out to be the tipping point for GPU cost at high
// spin/near-edge-on views, back when this shader still ran a full Kerr
// integrator for every spinning ray — see checkDiskSegmentY's doc comment
// below). Reverted to the original infinitesimally-thin plane.
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

// One ray tracer (mirrors physics/lensing.ts's traceSchwarzschildRay — the
// ray stays in a fixed 2D plane, integrated in φ), used for every ray
// regardless of spin. Frame dragging isn't actually integrated: instead, per
// physics/visualSpinLensing.ts's effectiveMassForRay, each ray's *mass* for
// the bending integration alone is nudged up or down based on how aligned
// its orbital plane is with the spin axis — calibrated so a fully-equatorial
// ray reproduces the exact real Kerr critical impact parameter for that
// spin and rotational sense, and a polar ray gets zero bias (frame dragging
// genuinely vanishes on the axis). This is "Modo Visual" from the roadmap:
// it reproduces the one visual signature of spin people actually recognize
// — the shadow's asymmetric flattening — without ever running the full
// Carter-constant Kerr–Newman integrator that used to live here (still
// intact, exact, and tested at physics/kerrLensing.ts — just not what
// renders the picture anymore, since its per-pixel cost was the real
// ceiling on performance at high spin). Charge is ignored for bending
// (visually negligible either way, per the roadmap's own reasoning) — it
// still affects the shadow/disk *sizes* correctly, via the exact metric
// formulas that already feed uHorizonRadius/uDiskInnerRadius/uDiskOuterRadius.
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uCameraPos;
  uniform sampler2D uBackgroundTexture;
  uniform float uMass;
  uniform float uSpin;
  uniform float uHorizonRadius;
  uniform float uMaxRadius;
  // Integrator quality (roadmap item 7): step *count* and step *size* are
  // both uniforms, driven from src/physics/renderQuality.ts's presets,
  // rather than the fixed consts this used to be. GLSL ES 1.00 requires a
  // for-loop's bound to be a compile-time constant, so the loop below keeps
  // a fixed hard cap (comfortably above the "high" preset) and breaks early
  // once the uniform step count is reached — the cap itself never changes,
  // only how many iterations actually run before the break. Applies
  // uniformly regardless of spin now — see the file-level comment above.
  uniform int uSchwSteps;
  uniform float uSchwDPhi;
  // Disk bounds (roadmap item 8) — the ray tracers below check for a
  // crossing of the equatorial plane within these radii and, if found,
  // terminate early with the disk's analytic color instead of the
  // background. innerRadius <= 0.0 (the showDisk-off sentinel from
  // BlackHoleCanvas) disables the check entirely, since a real disk always
  // has 0 < innerRadius < outerRadius.
  uniform float uDiskInnerRadius;
  uniform float uDiskOuterRadius;
  // Width of the smooth brightness falloff just beyond uDiskOuterRadius —
  // see accretionDisk.ts's outerEdgeFade and diskColor's use of it below.
  // The disk-crossing check (checkDiskSegmentY) is fed uDiskOuterRadius +
  // this width, so a hit can still register inside the fade zone; the fade
  // itself only affects brightness, not detection.
  uniform float uDiskOuterFadeWidth;
  // Elapsed time (seconds) and a tileable procedural noise texture, for the
  // disk's rotating "flow" look — see diskColor's use of these below.
  uniform float uTime;
  uniform sampler2D uDiskFlowTexture;
  varying vec3 vWorldPos;

  const int MAX_STEPS_SCHW_CAP = 400;
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

  // Mirrors src/physics/accretionDisk.ts's outerEdgeFade exactly — GLSL's
  // built-in smoothstep does the same cubic (3t²-2t³) as the manual version
  // there, so this just wires it up with the same fadeWidth<=0 hard-edge
  // fallback (uDiskOuterFadeWidth is always > 0 in practice here, but this
  // keeps the two implementations behaviorally identical, not just visually).
  float outerEdgeFadeGLSL(float outerRadius, float fadeWidth, float r) {
    if (fadeWidth <= 0.0) return r <= outerRadius ? 1.0 : 0.0;
    return 1.0 - smoothstep(outerRadius, outerRadius + fadeWidth, r);
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
    // in the world-space (x, z) convention traceSchwarzschild's own e1/e2
    // basis reconstructs positions in. Using this rather than the old
    // particle shader's convention keeps the disk co-rotating with prograde
    // photons (L > 0), the standard physical configuration.
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
    float edgeFade = outerEdgeFadeGLSL(uDiskOuterRadius, uDiskOuterFadeWidth, radius);
    return color * (0.7 + 0.6 * flow) * edgeFade;
  }

  vec2 equirectUv(vec3 dir) {
    float phi = atan(dir.z, dir.x);
    float theta = acos(clamp(dir.y, -1.0, 1.0));
    return vec2(phi / (2.0 * PI) + 0.5, theta / PI);
  }

  // Checks one segment of a Schwarzschild ray's step for a crossing of the
  // disk's plane (world-space y=0) within [innerRadius, outerRadius] — see
  // traceSchwarzschild's use of this (four segments per step, across its RK4
  // stage points) for why a single per-step endpoint check isn't enough.
  //
  // The disk briefly had physical thickness (two faces, a filled slab
  // instead of an infinitesimal plane) — reverted after it turned out to be
  // the tipping point for GPU cost at high spin/near-edge-on views, back
  // when this shader still ran a full Carter-constant Kerr integrator for
  // every spinning ray (see the file-level comment above — that integrator
  // is gone from rendering now, but the thickness feature was never
  // revisited). Given this is fundamentally an educational/visual simulator,
  // a flat disk that renders smoothly beats a thick one that doesn't render
  // at all.
  bool checkDiskSegmentY(
    float aR, float aPhi, float bR, float bPhi,
    float e1y, float e2y,
    float innerRadius, float outerRadius,
    out float hitRadius, out float hitPhi
  ) {
    float ay = aR * (cos(aPhi) * e1y + sin(aPhi) * e2y);
    float by = bR * (cos(bPhi) * e1y + sin(bPhi) * e2y);
    if (ay * by >= 0.0) return false;
    float fraction = ay / (ay - by);
    float r = aR + fraction * (bR - aR);
    if (r < innerRadius || r > outerRadius) return false;
    hitRadius = r;
    hitPhi = aPhi + fraction * (bPhi - aPhi);
    return true;
  }

  // mass is a per-ray *effective* mass (see effectiveMassForRayGLSL below),
  // not always uMass — only the bending integration uses it; disk/background
  // color still use the real uMass (see diskColor, called by schwarzschildColor).
  vec3 traceSchwarzschild(vec3 ro, vec3 rd, float mass, out bool captured, out bool diskHit, out vec3 diskPosition, out float diskRadius) {
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
      float k1v = -u + 3.0 * mass * u * u;
      float u2 = u + (uSchwDPhi * 0.5) * k1u;
      float v2 = v + (uSchwDPhi * 0.5) * k1v;
      float k2u = v2;
      float k2v = -u2 + 3.0 * mass * u2 * u2;
      float u3 = u + (uSchwDPhi * 0.5) * k2u;
      float v3 = v + (uSchwDPhi * 0.5) * k2v;
      float k3u = v3;
      float k3v = -u3 + 3.0 * mass * u3 * u3;
      float u4 = u + uSchwDPhi * k3u;
      float v4 = v + uSchwDPhi * k3v;
      float k4u = v4;
      float k4v = -u4 + 3.0 * mass * u4 * u4;

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

        // Fed outerRadius + fade width so a hit still registers inside the
        // fade zone — diskColor's own outerEdgeFadeGLSL call is what
        // actually dims it toward zero brightness, not this bound.
        float outerBoundWithFade = uDiskOuterRadius + uDiskOuterFadeWidth;
        float hitR;
        float hitPhi;
        if (
          checkDiskSegmentY(prevR, prevPhi, r2, phiMid, e1.y, e2.y, uDiskInnerRadius, outerBoundWithFade, hitR, hitPhi) ||
          checkDiskSegmentY(r2, phiMid, r3, phiMid, e1.y, e2.y, uDiskInnerRadius, outerBoundWithFade, hitR, hitPhi) ||
          checkDiskSegmentY(r3, phiMid, r4, phiEnd, e1.y, e2.y, uDiskInnerRadius, outerBoundWithFade, hitR, hitPhi) ||
          checkDiskSegmentY(r4, phiEnd, newR, phiEnd, e1.y, e2.y, uDiskInnerRadius, outerBoundWithFade, hitR, hitPhi)
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

  vec3 schwarzschildColor(vec3 ro, vec3 rd, float mass, out bool captured) {
    bool diskHit;
    vec3 diskPosition;
    float diskRadius;
    vec3 finalDir = traceSchwarzschild(ro, rd, mass, captured, diskHit, diskPosition, diskRadius);
    if (diskHit) return diskColor(diskPosition, diskRadius);
    if (captured) return vec3(0.0);
    return texture2D(uBackgroundTexture, equirectUv(finalDir)).rgb;
  }

  // Kerr's photon sphere radius at charge = 0 (Bardeen 1972) — mirrors
  // physics/orbits.ts's photonSphereRadius, charge-zero branch only (Modo
  // Visual ignores charge's effect on bending entirely — see the file-level
  // comment above). directionSign is -1 for prograde, +1 for retrograde,
  // matching that module's own convention exactly. Named directionSign
  // rather than "sign" to avoid shadowing GLSL's built-in sign() function.
  float photonSphereRadiusGLSL(float mass, float spin, float directionSign) {
    float aRatio = spin / mass;
    return 2.0 * mass * (1.0 + cos((2.0 / 3.0) * acos(directionSign * aRatio)));
  }

  // Exact equatorial critical impact parameter for a spinning hole — mirrors
  // physics/orbits.ts's criticalImpactParameter, spin > 0 branch (charge = 0
  // here always). See that function's doc comment for the derivation and
  // for why exact extremal spin (a = mass) needs the denom guard below: Δ
  // and (r_ph − mass) both vanish together there for the prograde direction,
  // a genuine removable singularity (the true limit is finite) that plain
  // division would turn into 0/0.
  float criticalImpactParameterGLSL(float mass, float spin, float directionSign) {
    float rph = photonSphereRadiusGLSL(mass, spin, directionSign);
    float denom = rph - mass;
    float delta = rph * rph - 2.0 * mass * rph + spin * spin;
    float p = abs(denom) < 1e-9 ? 0.0 : (2.0 * rph * delta) / denom;
    return (rph * rph + spin * spin - p) / spin;
  }

  // Effective mass for this ray's bending integration alone — mirrors
  // physics/visualSpinLensing.ts's effectiveMassForRay exactly (see that
  // module's doc comment for the full calibration rationale: exact at the
  // pole, exact at the equator, linearly interpolated in |sinAngle| between
  // them). sinAngle = 0 collapses the (equatorialMass - mass) term to zero
  // via the final multiply, so no separate branch is needed for the polar
  // case the way the TS version has (that one exists for clean, exact-value
  // test assertions, not because the math needs it here).
  float effectiveMassForRayGLSL(float mass, float spin, float sinAngle) {
    if (spin <= 0.0) return mass;
    float directionSign = sinAngle > 0.0 ? -1.0 : 1.0;
    float bCritReal = abs(criticalImpactParameterGLSL(mass, spin, directionSign));
    float equatorialMass = (bCritReal / (3.0 * sqrt(3.0))) * mass;
    return mass + (equatorialMass - mass) * abs(sinAngle);
  }

  void main() {
    vec3 rd = normalize(vWorldPos - uCameraPos);

    // How "equatorial" this specific ray's orbital plane is relative to the
    // spin axis — see effectiveMassForRayGLSL / the file-level comment above
    // for what this drives (the shadow's asymmetric flattening, standing in
    // for a real Kerr integration).
    vec3 impactVec = cross(uCameraPos, rd);
    float bLen = length(impactVec);
    float sinAngle = bLen > 1e-9 ? dot(impactVec, SPIN_AXIS) / bLen : 0.0;
    float effectiveMass = effectiveMassForRayGLSL(uMass, uSpin, sinAngle);

    bool captured = false;
    gl_FragColor = vec4(schwarzschildColor(uCameraPos, rd, effectiveMass, captured), 1.0);
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
      uHorizonRadius: { value: horizonRadius },
      uMaxRadius: { value: MAX_RAY_RADIUS },
      uSchwSteps: { value: INTEGRATOR_QUALITY[quality].schwSteps },
      uSchwDPhi: { value: INTEGRATOR_QUALITY[quality].schwDPhi },
      uDiskInnerRadius: { value: disk?.innerRadius ?? 0 },
      uDiskOuterRadius: { value: disk?.outerRadius ?? 0 },
      uDiskOuterFadeWidth: { value: disk ? disk.outerRadius * DISK_OUTER_FADE_RATIO : 0 },
      uTime: { value: 0 },
      uDiskFlowTexture: { value: flowTexture },
    }),
    [texture, flowTexture, params.mass, params.spin, horizonRadius, quality, disk],
  )

  useFrame((state) => {
    const material = materialRef.current
    if (!material) return
    material.uniforms.uCameraPos.value.copy(camera.position)
    material.uniforms.uMass.value = params.mass
    material.uniforms.uSpin.value = params.spin
    material.uniforms.uHorizonRadius.value = horizonRadius
    material.uniforms.uMaxRadius.value = MAX_RAY_RADIUS
    material.uniforms.uTime.value = state.clock.elapsedTime
    const preset = INTEGRATOR_QUALITY[quality]
    material.uniforms.uSchwSteps.value = preset.schwSteps
    material.uniforms.uSchwDPhi.value = preset.schwDPhi
    material.uniforms.uDiskInnerRadius.value = disk?.innerRadius ?? 0
    material.uniforms.uDiskOuterRadius.value = disk?.outerRadius ?? 0
    material.uniforms.uDiskOuterFadeWidth.value = disk ? disk.outerRadius * DISK_OUTER_FADE_RATIO : 0
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
