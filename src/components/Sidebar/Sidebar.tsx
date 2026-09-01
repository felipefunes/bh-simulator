import { useState } from 'react'
import { classify, isNakedSingularity, type BlackHoleClass } from '../../physics/metric'
import type { QualityLevel } from '../../physics/renderQuality'
import { useBlackHoleParams, useBlackHoleStore } from '../../store/blackHoleStore'
import './Sidebar.css'

const CLASS_LABELS: Record<BlackHoleClass, string> = {
  schwarzschild: 'Schwarzschild',
  'reissner-nordstrom': 'Reissner–Nordström',
  kerr: 'Kerr',
  'kerr-newman': 'Kerr–Newman',
}

const QUALITY_LEVELS: { value: QualityLevel; label: string }[] = [
  { value: 'low', label: 'Baja' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
]

export function Sidebar() {
  const mass = useBlackHoleStore((state) => state.mass)
  const spinRatio = useBlackHoleStore((state) => state.spinRatio)
  const chargeRatio = useBlackHoleStore((state) => state.chargeRatio)
  const showDisk = useBlackHoleStore((state) => state.showDisk)
  const quality = useBlackHoleStore((state) => state.quality)
  const setMass = useBlackHoleStore((state) => state.setMass)
  const setSpinRatio = useBlackHoleStore((state) => state.setSpinRatio)
  const setChargeRatio = useBlackHoleStore((state) => state.setChargeRatio)
  const setShowDisk = useBlackHoleStore((state) => state.setShowDisk)
  const setQuality = useBlackHoleStore((state) => state.setQuality)

  const params = useBlackHoleParams()
  const naked = isNakedSingularity(params)
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="sidebar__mobile-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {isOpen ? 'Cerrar' : 'Controles'}
      </button>

      {isOpen && (
        <div className="sidebar__backdrop" onClick={() => setIsOpen(false)} aria-hidden="true" />
      )}

      <aside className={isOpen ? 'sidebar sidebar--open' : 'sidebar'}>
      <h1 className="sidebar__title">Black Hole Simulator</h1>
      <p className="sidebar__subtitle">
        Simulación interactiva de un agujero negro: masa, spin y carga eléctrica,
        disco de acreción y lente gravitacional sobre una imagen de fondo.
      </p>

      <div
        className={
          naked ? 'sidebar__classification sidebar__classification--warning' : 'sidebar__classification'
        }
      >
        {naked ? 'Singularidad desnuda (a² + Q² > M², sin horizonte)' : CLASS_LABELS[classify(params)]}
      </div>

      <label className="sidebar__control">
        <span className="sidebar__control-label">
          Masa (M) <span className="sidebar__control-value">{mass.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0.3}
          max={1.5}
          step={0.05}
          value={mass}
          onChange={(event) => setMass(Number(event.target.value))}
        />
      </label>

      <label className="sidebar__control">
        <span className="sidebar__control-label">
          Spin (a* = a/M) <span className="sidebar__control-value">{spinRatio.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={spinRatio}
          onChange={(event) => setSpinRatio(Number(event.target.value))}
        />
      </label>

      <label className="sidebar__control">
        <span className="sidebar__control-label">
          Carga (Q* = Q/M) <span className="sidebar__control-value">{chargeRatio.toFixed(2)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={chargeRatio}
          onChange={(event) => setChargeRatio(Number(event.target.value))}
        />
      </label>

      <label className="sidebar__control sidebar__control--checkbox">
        <input type="checkbox" checked={showDisk} onChange={(event) => setShowDisk(event.target.checked)} />
        <span className="sidebar__control-label">Mostrar disco de acreción</span>
      </label>

      <div className="sidebar__control">
        <span className="sidebar__control-label">Calidad</span>
        <div className="sidebar__quality-group" role="radiogroup" aria-label="Calidad">
          {QUALITY_LEVELS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={quality === value}
              className={
                quality === value ? 'sidebar__quality-button sidebar__quality-button--active' : 'sidebar__quality-button'
              }
              onClick={() => setQuality(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="sidebar__note">
        El disco se calcula analíticamente en el mismo shader que la lente (perfil de
        temperatura de Shakura–Sunyaev + beaming Doppler), no como partículas — por
        eso se deforma y aparece duplicado arriba/abajo de la sombra, en vez de
        superponerse sin curvarse con el resto de la imagen.
      </p>

      <p className="sidebar__note">
        "Calidad" ajusta los pasos del integrador de la lente (menos precisión pero
        más rendimiento en "Baja") y el pixel ratio del render — útil en GPUs
        modestas o si el navegador se siente forzado, especialmente con spin alto.
      </p>
      </aside>
    </>
  )
}
