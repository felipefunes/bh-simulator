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
  horizonRadius,
  photonSphereRadius,
  shadowRadius,
  diskMidRadius,
}: {
  horizonRadius: number
  photonSphereRadius: number
  shadowRadius: number
  diskMidRadius: number
}) {
  // Directions chosen to fan out across the camera-facing hemisphere for
  // BlackHoleCanvas's default camera position (roughly +Y, +Z), so all four
  // are visible without overlapping at the default framing — not physically
  // meaningful positions, just readable diagram anchor points.
  const tooltips: TooltipSpec[] = [
    {
      key: 'horizon',
      direction: [0.3, 0.6, 0.74],
      radius: horizonRadius,
      name: 'Horizonte de sucesos',
      description: 'El límite de no retorno — ni la luz puede escapar desde adentro.',
      offset: [-90, -70],
    },
    {
      key: 'photon-sphere',
      direction: [0.6, 0.35, 0.7],
      radius: photonSphereRadius,
      name: 'Esfera de fotones',
      description: 'El radio donde la luz puede orbitar el agujero negro, en círculos inestables.',
      offset: [100, -60],
    },
    {
      key: 'shadow',
      direction: [-0.4, -0.5, 0.77],
      radius: shadowRadius,
      name: 'Sombra',
      description: 'La región oscura que realmente vemos — más grande que el horizonte, es donde cae toda la luz capturada.',
      offset: [-110, 70],
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
