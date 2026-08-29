# Black Hole Simulator

Simulador interactivo de agujeros negros: un canvas 3D (react-three-fiber / three.js)
con un agujero negro parametrizado por **masa**, **spin** y **carga eléctrica**, su
disco de acreción, y lente gravitacional sobre una imagen de fondo (una galaxia) para
visualizar la deformación de la luz. Hermano de
[galaxy-simulator](https://github.com/felipefunes/galaxy-simulator), mismo stack y
convenciones de trabajo.

## Enfoque físico

No es relatividad general numérica desde cero en cada frame (integrar Einstein field
equations en tiempo real no es viable en un navegador). El enfoque es:

- **Geometría del agujero negro**: fórmulas cerradas de las métricas de Schwarzschild,
  Reissner–Nordström, Kerr y Kerr–Newman (radio de horizonte(s), ergosfera, ISCO, radio
  de la esfera de fotones) como funciones puras — ver `src/physics`. Unidades
  geometrizadas (G = c = 1): masa, spin y carga comparten unidad de longitud, y todos
  los radios se expresan en esa misma unidad.
  - Horizontes y ergosfera (ecuatorial) tienen forma cerrada general para
    Kerr–Newman, de la que Schwarzschild/Reissner–Nordström/Kerr son casos
    particulares (spin y/o carga en cero).
  - Esfera de fotones e ISCO tienen forma cerrada para Schwarzschild y Kerr (spin
    ≠ 0, carga = 0) y, para la esfera de fotones, también para Reissner–Nordström
    (carga ≠ 0, spin = 0). El caso Kerr–Newman general (spin y carga ambos ≠ 0)
    no tiene una forma cerrada simple para ninguna de las dos — requeriría resolver
    una cuártica numéricamente — así que `photonSphereRadius`/`iscoRadius` devuelven
    `null` ahí; queda pendiente si en algún momento hace falta.
- **Lente gravitacional**: no es post-procesado con una lente óptica aproximada, sino
  ray marching de geodésicas nulas en un fragment shader (WebGL/GLSL vía
  `shaderMaterial` de r3f) contra una textura equirectangular de fondo. Es paralelizable
  por píxel en GPU, así que corre en tiempo real; la precisión (pasos del integrador)
  es un trade-off de calidad vs. rendimiento que se expone como control en el sidebar.
  Esto llega en un PR posterior, una vez que el módulo de física tenga las fórmulas de
  la métrica.
- **Disco de acreción**: gradiente de temperatura (blackbody) + efectos relativistas
  (beaming Doppler por la velocidad orbital, corrimiento al rojo gravitacional) — en el
  pipeline, no bloqueante para los primeros PRs. Ver roadmap abajo.

### Las tres variables y su clasificación

Masa (M), spin (a) y carga eléctrica (Q) determinan completamente cuál caso clásico
aplica — no hace falta que el usuario elija "Kerr" o "Schwarzschild" a mano, el sidebar
puede derivar y mostrar la clasificación en vivo a partir de los sliders:

| a   | Q   | Caso                    |
| --- | --- | ----------------------- |
| 0   | 0   | Schwarzschild           |
| 0   | ≠0  | Reissner–Nordström      |
| ≠0  | 0   | Kerr                    |
| ≠0  | ≠0  | Kerr–Newman             |

Esta decisión (sliders continuos + etiqueta derivada, en vez de un selector de tipo
separado) se documenta acá para no perderla de vista cuando se implementen los
controles del sidebar.

## Stack

- Vite + React + TypeScript
- react-three-fiber + drei + three.js para el render 3D (shaders custom para la lente)
- zustand para el estado de los parámetros (masa, spin, carga, calidad del lente)
- vitest para tests (especialmente `physics/`, que debe testearse aislado del render)

## Comandos

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción (`tsc -b && vite build`) a `dist/`
- `npm run test` — corre la suite de vitest
- `npm run lint` — eslint

## Estructura

```
src/
  components/       componentes de UI (Sidebar, BlackHoleCanvas, ...)
  physics/          métricas y fórmulas puras, sin dependencias de React/three
  store/            estado global (zustand) de los parámetros de simulación (desde PR 3)
```

El módulo `physics/` debe mantenerse como funciones puras testeables sin DOM ni three.js,
para poder testear la matemática (radios de horizonte, ISCO, esfera de fotones,
clasificación del caso) de forma aislada del render.

## Roadmap de PRs

1. ✅ **Scaffold**: Vite + React + TS + r3f/drei, escena placeholder (horizonte
   de eventos, disco de partículas con caída Kepleriana aproximada, starfield de fondo
   como stand-in de la imagen galáctica real), sidebar shell, licencia MIT.
2. ✅ **Módulo `physics/`**: fórmulas de Schwarzschild/Reissner–Nordström/Kerr/Kerr–Newman
   (horizontes, ergosfera, ISCO, esfera de fotones) + tests de vitest. Ver la nota de
   alcance más arriba sobre el caso Kerr–Newman general en ISCO/esfera de fotones.
3. Sidebar funcional: sliders de masa/spin/carga conectados a zustand, con la
   clasificación derivada (tabla de arriba) mostrada en vivo.
4. Shader de lente gravitacional (ray marching de geodésicas nulas) contra una imagen
   de fondo equirectangular — caso Schwarzschild primero (deflexión radial pura).
5. Extender el shader a Kerr/Kerr–Newman (frame dragging, ergosfera) — aproximación
   numérica del término de spin en el integrador.
6. Disco de acreción con gradiente de temperatura físico + beaming Doppler y corrimiento
   al rojo gravitacional.
7. Controles de calidad (pasos del integrador / resolución del shader) para balancear
   fidelidad vs. rendimiento en GPUs modestas.

Este roadmap es una guía, no un contrato — el orden puede ajustarse PR a PR según lo que
se aprenda en el camino (igual que en galaxy-simulator).

## Deploy

Blueprint de Render.com como Static Site: ver `render.yaml` en la raíz. Build command
`npm ci && npm run build`, publish path `./dist`.

## Flujo de trabajo

Se trabaja por PR, una rama por feature (`pr-N-descripcion`). Cada PR debe incluir una
captura de pantalla del estado visual resultante en el body del PR — las imágenes se
suben a la rama huérfana `pr-assets` y se referencian vía
`raw.githubusercontent.com/felipefunes/bh-simulator/pr-assets/<archivo>`, igual que en
galaxy-simulator.
