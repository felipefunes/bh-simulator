import './Sidebar.css'

export function Sidebar() {
  return (
    <aside className="sidebar">
      <h1 className="sidebar__title">Black Hole Simulator</h1>
      <p className="sidebar__subtitle">
        Simulación interactiva de un agujero negro: masa, spin y carga eléctrica,
        disco de acreción y lente gravitacional sobre una imagen de fondo.
      </p>
      <p className="sidebar__note">
        Los controles de tipo de agujero negro (Schwarzschild / Kerr), masa, spin y
        carga se agregan en un próximo PR.
      </p>
    </aside>
  )
}
