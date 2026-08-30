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
  store/            estado global (zustand) de los parámetros de simulación
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
3. ✅ **Sidebar funcional**: sliders de masa/spin/carga (`spinRatio`/`chargeRatio`
   normalizados como a/M y Q/M, independientes de la masa) conectados a zustand, con
   la clasificación derivada (tabla de arriba) mostrada en vivo — o el aviso de
   singularidad desnuda cuando a² + Q² > M². `BlackHoleCanvas` ya lee el store: el
   horizonte de eventos usa el radio real (`horizonRadii`, no se renderiza si no hay
   horizonte) y el radio interno del disco usa la ISCO real cuando existe forma
   cerrada (Schwarzschild/Kerr), con el múltiplo aproximado del horizonte como
   fallback para los casos con carga.
4. ✅ **Shader de lente gravitacional**: `LensedBackground` reemplaza el placeholder
   `Stars` por una esfera enorme (radio 500) con un fragment shader custom, con una
   textura equirectangular procedural (canvas 2D: starfield + una mancha de galaxia
   lejana, generada una vez, sin assets externos) como fondo. El shader integra por
   RK4 la ecuación de geodésica nula de Schwarzschild d²u/dφ² + u = 3Mu² (u = 1/r) por
   píxel, reconstruyendo el rayo desde la posición mundial del fragmento en la esfera
   menos la posición de la cámara — no hace falta matriz de proyección inversa porque
   la esfera ya está transformada por las matrices normales de three.js. La misma
   integración vive primero en `src/physics/lensing.ts` (`traceSchwarzschildRay`),
   testeada con vitest (incluye el chequeo contra la fórmula de campo débil δφ ≈ 4M/b
   y el radio crítico de captura 3√3 M) antes de portarse a GLSL — el shader es una
   traducción fiel de esa función ya verificada. El disco de acreción sigue siendo
   geometría de partículas normal (no lensed) por ahora; lensear el disco en sí queda
   para cuando se trabaje el PR 6.
5. ✅ **Kerr–Newman en el shader**: se optó por el tratamiento riguroso (geodésicas
   exactas vía la constante de Carter), no una aproximación — ver `src/physics/kerrLensing.ts`
   (`traceKerrRay`). En Kerr, las órbitas no son planas en general (frame dragging saca
   al fotón del plano inicial), así que hace falta el sistema completo (r, θ, φ) con la
   separación de Hamilton-Jacobi de Carter, integrado en "tiempo de Mino" (dτ = dλ/Σ,
   Mino 2003) sobre (r, θ, φ, w_r ≡ Σṙ, w_θ ≡ Σθ̇) — este truco de trackear w_r/w_θ en
   vez de r/θ directamente evita el signo ± que normalmente hay que flippear en cada
   punto de retorno, algo incómodo para RK4. La carga eléctrica solo modifica Δ (que
   pasa a ser r² − 2Mr + a² + e²) y no su derivada, así que extender de Kerr a
   Kerr–Newman fue un cambio mínimo sobre el mismo integrador.
   - Verificado contra: el caso a=0 reproduciendo `traceSchwarzschildRay` (fuera del
     parámetro de impacto crítico), el parámetro de impacto crítico exacto (prógrado,
     retrógado, y Reissner–Nordström) derivado de `photonSphereRadius` ya testeada, y
     la asimetría de frame dragging (mismo |b|, resultado distinto prógrado vs. retrógrado).
   - Durante el desarrollo, la condición inicial `w_r(0)` aproximada (con la fórmula de
     campo plano) causaba que un rayo se "rebotara" en el radio equivocado — el error
     era invisible lejos del agujero pero catastrófico cerca de la esfera de fotones.
     El fix fue sembrar `w_r(0)`/`w_θ(0)` exactos desde R(r₀)/Θ(θ₀), no la aproximación.
   - Costo conocido: la integración completa necesita muchos más pasos que el caso
     Schwarzschild (miles vs. cientos), así que el shader usa una rama barata
     (Schwarzschild puro) cuando spin y carga son ~0, y solo paga el costo completo
     cuando alguno de los dos es no nulo. El ajuste fino de performance (pasos/paso de
     integración) queda para el PR 7.
   - Pendiente, no bloqueante: visualizar la ergosfera (la fórmula general con
     dependencia en θ ya se puede derivar de `ergosphereEquatorialRadius`, pero no se
     implementó en este PR — el foco fue el shader).
6. ✅ **Disco de acreción físico**: `src/physics/accretionDisk.ts` — perfil de
   temperatura de Shakura–Sunyaev (T⁴ ∝ r⁻³(1−√(r_in/r)), pico en r=49/36 r_in),
   color de cuerpo negro (aproximación polinómica, tipo Tanner Helland), velocidad
   orbital local v(r)=√(M/(r−2M)) (da exactamente c en la esfera de fotones y 0.5c
   en la ISCO — dos checkpoints conocidos) y el factor combinado de corrimiento
   Doppler + gravitacional 1+z = γ(1−β·n̂)/√(1−2M/r) (Luminet 1979). Todo testeado
   en vitest antes de portarse a GLSL, mismo patrón que PRs anteriores.
   `AccretionDisk` ahora usa un `shaderMaterial` propio (no el `pointsMaterial` de
   antes): cada partícula lleva su temperatura base y su dirección de velocidad
   tangencial como atributos, y el vertex shader recalcula color y brillo cada
   frame según la posición actual de la cámara — el beaming es visible como una
   asimetría de brillo entre el lado que se acerca y el que se aleja. Aproximación
   documentada: las fórmulas usan solo masa (Schwarzschild), igual que el shader de
   lente antes del PR 5 — extender a Kerr/Kerr–Newman queda como trabajo futuro.
   El disco se ensanchó de 3.5× a 10× el radio interno (y la cámara se alejó a
   juego) porque con el radio anterior toda la temperatura visible quedaba en el
   mismo extremo caliente/azul de la curva de cuerpo negro, sin espacio para
   enfriarse hacia el naranja.
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
