import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import * as THREE from 'three'

interface TooltipSpec {
  key: string
  /** World-space direction (not necessarily unit length — normalized below) the label's anchor sits along, at `radius` from the origin. */
  direction: [number, number, number]
  radius: number
  name: string
  description: string
  /** Pixel offset (from the anchor's projected screen position) where the label box and its leader line end up. */
  offset: [number, number]
}

// Label box width from BlackHoleCanvas.css (.info-tooltip__label), halved
// since the label is centered on its offset point — needed to know how much
// clearance the edge-flip check below needs on each side. Doesn't need to
// track the mobile media query's narrower width exactly: this is a
// deliberately generous estimate (flipping a bit early costs nothing).
const LABEL_HALF_WIDTH = 85
const EDGE_MARGIN = 12

/**
 * One labeled leader line + description box, anchored to a 3D point (a
 * position on the notionally spherical horizon/photon-sphere/shadow, or a
 * point on the disk) that drei's Html keeps projected to screen space as the
 * camera orbits.
 *
 * Occlusion: hidden when its anchor is geometrically behind the shadow
 * sphere as seen from the camera (a ray/sphere test against shadowRadius,
 * the largest of the roughly-spherical opaque structures) — otherwise a
 * label would show through the solid shadow when the camera orbits to the
 * far side. Doesn't test against the disk (a flat, thin occluder, harder to
 * get right cheaply) — an accepted gap for this first pass.
 *
 * Edge flip: the fixed pixel offsets in InfoTooltips below are tuned for
 * BlackHoleCanvas's default desktop framing — on a narrow mobile viewport
 * (or after the user's own zoom/pan), an anchor near the left/right edge can
 * push its label off-screen. Rather than a full viewport-aware repositioning
 * system, mirror just the horizontal offset when the label would overflow —
 * cheap, and enough to keep every label readable in practice (found via
 * mobile-viewport QA: "Disco de acreción"'s label ran off the right edge at
 * 390px wide before this).
 */
function Tooltip({ info, shadowRadius }: { info: TooltipSpec; shadowRadius: number }) {
  const position = useMemo(
    () => new THREE.Vector3(...info.direction).normalize().multiplyScalar(info.radius),
    [info.direction, info.radius],
  )
  const { camera, size } = useThree()
  const [occluded, setOccluded] = useState(false)
  const [flipX, setFlipX] = useState(false)

  useFrame(() => {
    const toAnchor = position.clone().sub(camera.position)
    const denom = toAnchor.lengthSq()
    const t = denom > 1e-9 ? Math.max(0, Math.min(1, -camera.position.dot(toAnchor) / denom)) : 0
    const closest = camera.position.clone().addScaledVector(toAnchor, t)
    setOccluded(t < 0.999 && closest.lengthSq() < shadowRadius * shadowRadius)

    const ndcX = position.clone().project(camera).x
    const screenX = (ndcX * 0.5 + 0.5) * size.width
    const dx = info.offset[0]
    const labelEdge = screenX + dx + Math.sign(dx || 1) * LABEL_HALF_WIDTH
    setFlipX(dx >= 0 ? labelEdge > size.width - EDGE_MARGIN : labelEdge < EDGE_MARGIN)
  })

  if (occluded) return null

  const dx = flipX ? -info.offset[0] : info.offset[0]
  const dy = info.offset[1]
  const lineLength = Math.hypot(dx, dy)
  const lineAngle = (Math.atan2(dy, dx) * 180) / Math.PI

  return (
    <Html position={position} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className="info-tooltip__dot" />
      <div className="info-tooltip__line" style={{ width: `${lineLength}px`, transform: `rotate(${lineAngle}deg)` }} />
      <div className="info-tooltip__label" style={{ transform: `translate(${dx}px, ${dy}px) translate(-50%, -50%)` }}>
        <strong>{info.name}</strong>
        <p>{info.description}</p>
      </div>
    </Html>
  )
}

export function InfoTooltips({
  shadowRadius,
  diskMidRadius,
}: {
  shadowRadius: number
  diskMidRadius: number
}) {
  // Directions chosen to fan out across the camera-facing hemisphere for
  // BlackHoleCanvas's default camera position (roughly +Y, +Z), so all four
  // are visible without overlapping at the default framing — not physically
  // meaningful positions, just readable diagram anchor points.
  //
  // horizonRadius (2M) and photonSphereRadius (3M) are both *smaller* than
  // shadowRadius (3√3M ≈ 5.2M) — and the shadow is the only one of the three
  // that's actually a visible edge in the render (same as a real black hole
  // photo: you see one dark region, not separate rings for the horizon and
  // the photon sphere — neither is independently visible, ever, on any
  // image). Their anchor points necessarily land inside the shadow's solid
  // silhouette either way, not on a boundary of their own — but at their
  // *true* radii (2M and 3M, both tiny next to the ~122-unit camera
  // distance), they also land within a couple of pixels of each other and
  // of the shadow's own center, no matter how far apart their directions
  // are: the absolute radius is what sets the screen-space scale here, and
  // it's too small either way to visually separate. Found via user feedback
  // on PR 10's screenshot ("los círculos no apuntan a donde corresponde") —
  // first tried spreading only the *directions* (top/left/bottom instead of
  // clustered on one side), which helped the leader lines read as distinct
  // but left the dots themselves still nearly touching.
  //
  // Fix: horizonRadius/photonSphereRadius below are schematic fractions of
  // shadowRadius (0.25/0.85) instead of their true values — since neither is
  // independently visible anyway, there's no real boundary being
  // misrepresented, and this reproduces the mockup's intent (three visually
  // distinct, increasingly-large nested zones) instead of three points stacked
  // on top of each other at a physically-real but illegibly small scale.
  // shadowRadius and diskMidRadius (both real, visible edges) are unchanged.
  //
  // Two earlier attempts (0.35/0.65, then 0.15/0.55) barely moved the visual
  // result: with two anchors ~90° apart in direction, their 3D separation is
  // dominated by sqrt(r1² + r2²) — the *larger* of the two radii — so
  // shrinking only the smaller one (horizon) did almost nothing, and 0.35/
  // 0.65 happened to be close enough to Schwarzschild's own true ratios
  // (2M/5.2M≈0.38, 3M/5.2M≈0.58) to look like the same bug again. Pushing
  // the larger radius (photon sphere) much closer to shadowRadius — not the
  // smaller one — is what actually buys separation.
  const schematicHorizonRadius = shadowRadius * 0.25
  const schematicPhotonSphereRadius = shadowRadius * 0.85

  const tooltips: TooltipSpec[] = [
    {
      key: 'horizon',
      direction: [0.05, 0.95, 0.3],
      radius: schematicHorizonRadius,
      name: 'Horizonte de sucesos',
      description: 'El límite de no retorno — ni la luz puede escapar desde adentro. No es visible por separado: queda oculto dentro de la sombra.',
      offset: [-30, -100],
    },
    {
      key: 'photon-sphere',
      direction: [-0.9, 0.15, 0.4],
      radius: schematicPhotonSphereRadius,
      name: 'Esfera de fotones',
      description: 'El radio donde la luz puede orbitar el agujero negro, en círculos inestables. Tampoco se ve por separado — está dentro de la sombra.',
      offset: [-150, -10],
    },
    {
      key: 'shadow',
      direction: [0.15, -0.85, 0.45],
      radius: shadowRadius,
      name: 'Sombra',
      description: 'La región oscura que realmente vemos — más grande que el horizonte, es donde cae toda la luz capturada.',
      offset: [-30, 100],
    },
    {
      key: 'disk',
      direction: [0.8, 0, 0.6],
      radius: diskMidRadius,
      name: 'Disco de acreción',
      description: 'Gas y polvo en órbita, calentado por fricción hasta brillar.',
      offset: [120, 30],
    },
  ]

  return (
    <>
      {tooltips.map((info) => (
        <Tooltip key={info.key} info={info} shadowRadius={shadowRadius} />
      ))}
    </>
  )
}
