import { classify, isNakedSingularity, type BlackHoleClass } from '../../physics/metric'
import { useBlackHoleParams, useBlackHoleStore } from '../../store/blackHoleStore'
import './Sidebar.css'

const CLASS_LABELS: Record<BlackHoleClass, string> = {
  schwarzschild: 'Schwarzschild',
  'reissner-nordstrom': 'Reissner–Nordström',
  kerr: 'Kerr',
  'kerr-newman': 'Kerr–Newman',
}

export function Sidebar() {
  const mass = useBlackHoleStore((state) => state.mass)
  const spinRatio = useBlackHoleStore((state) => state.spinRatio)
  const chargeRatio = useBlackHoleStore((state) => state.chargeRatio)
  const setMass = useBlackHoleStore((state) => state.setMass)
  const setSpinRatio = useBlackHoleStore((state) => state.setSpinRatio)
  const setChargeRatio = useBlackHoleStore((state) => state.setChargeRatio)

  const params = useBlackHoleParams()
  const naked = isNakedSingularity(params)

  return (
    <aside className="sidebar">
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

      <p className="sidebar__note">
        Controles de calidad (balance entre fidelidad del shader y rendimiento en
        GPUs modestas) se agregan en un próximo PR.
      </p>
    </aside>
  )
}
