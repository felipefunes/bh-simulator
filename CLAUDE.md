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
   - Ajustes post-review: partículas del disco con sprite circular difuminado
     (antes eran cuadrados duros — `gl_PointCoord` + `smoothstep` en el fragment
     shader) y velocidad angular multiplicada ×15 solo para legibilidad visual
     (`VISUAL_TIME_SCALE` en `AccretionDisk.tsx`) — la velocidad Keplariana real
     a esta escala es de minutos por vuelta incluso en el borde interno.
   - Bug encontrado en review visual: a spin alto aparecía una línea brillante
     recorriendo toda la pantalla exactamente sobre el eje de spin (parecía un
     "jet", pero no lo es — no hay jets relativistas modelados, eso es un
     fenómeno electromagnético/MHD, no puramente gravitacional). Causa real:
     el shader de Kerr reconstruía la dirección final como un vector cartesiano
     (`sinθ·cosφ, sinθ·senφ, cosθ`) y volvía a extraer φ de ese vector con
     `atan2` para muestrear la textura equirectangular — ese viaje de ida y
     vuelta es exactamente donde una textura equirect tiene su singularidad de
     polo: cuando sinθ→0, las componentes x/z son casi cero y `atan2` de dos
     números casi-cero es numéricamente inestable. El fix fue samplear la
     textura directamente desde θ/φ ya acumulados en la integración (nunca
     pasar por la reconstrucción cartesiana) — ver el comment en
     `traceKerr()`/`LensedBackground.tsx`. Diagnosticado pasando `finalDir`
     directo al framebuffer como color: la discontinuidad era visible ahí
     mismo, antes incluso de tocar la textura.
     - Ese fix redujo el problema pero no lo eliminó: en ángulos de cámara
       donde muchos rayos pasan cerca del eje, seguía apareciendo (ahora
       como una cadena periódica de imágenes fantasma de la mancha de
       galaxia, tipo "cuentas de un collar" subiendo por el eje, en vez de
       una sola línea). Un primer parche (reflejar θ/w_θ como una pared
       artificial al acercarse al polo, más un fade a negro en las
       muestras cercanas al polo) mejoraba pero no resolvía esto — la
       cadena aparecía en un rango de θ mucho más ancho que el que ese
       fade cubría razonablemente.
     - Fix definitivo: en vez de seguir parchando la integración (r,θ,φ)
       justo donde es numéricamente frágil, la esquivamos. Se estima
       sin(θ_min) ≈ |L|/√(L²+Q) (de la expansión de Θ(θ) a ángulo chico) —
       la latitud más cercana al polo que la trayectoria alcanzaría. Si esa
       estimación da por debajo de un umbral, el rayo se traza con
       `traceSchwarzschild` (solo masa) en vez de `traceKerr`. No es solo
       un atajo cómodo: el frame dragging es más fuerte en el plano
       ecuatorial y se anula exactamente sobre el eje de spin, así que
       ignorar el spin ahí es también la aproximación *más precisa*
       disponible justo donde el integrador completo es menos confiable.
       Verificado en el navegador con spin extremal (1.0) y masa mínima
       (0.3) combinados, en varios ángulos de cámara incluyendo vista
       casi-polar — sin línea, sin cadena de imágenes, sin errores.
     - Ese mismo fix, sin embargo, introdujo un bug propio (reportado como
       "¿esto son jets?" en review — no lo son, no hay jets relativistas
       modelados, eso es MHD/electromagnético): sin(θ_min) por sí solo no
       distingue *dirección* de *distancia*. Todo rayo en el plano vertical
       que contiene la cámara y el eje de spin tiene L=0 exacto, sin
       importar qué tan lejos del agujero apunte — sin un chequeo de
       distancia, ese plano entero (una cuña gigante atravesando toda la
       pantalla en perspectiva) se enviaba al fallback de Schwarzschild.
       Diagnosticado coloreando qué tracer atendió cada píxel (rojo =
       capturado, azul = fallback, verde = Kerr completo): la cuña oscura
       que parecía un jet no era sombra en absoluto — era la región del
       fallback muestreando una parte del cielo distinta (y coincidentemente
       más oscura) que la que el Kerr real hubiera mostrado ahí. Fix: exigir
       además que el parámetro de impacto total (L²+Q) sea chico (rayo
       realmente apuntando cerca del agujero, `< (20M)²`) antes de activar
       el fallback — así se confina al entorno real de la sombra, donde la
       aproximación tiene sentido, en vez de a cualquier rayo en ese plano
       sin importar qué tan lejos pase.
     - Ese fix (más acotado) trajo un tercer bug, reportado en review como
       "conos con forma de reloj de arena" saliendo de los polos (además de
       los "jets" que seguían viéndose): la región del fallback, ahora
       confinada cerca del agujero, seguía siendo un cambio *duro* de un
       tracer a otro — y el borde de ese cambio, donde antes había sido una
       cuña del tamaño de toda la pantalla, ahora era un doble cono visible
       alrededor de la sombra, con la misma causa raíz (Schwarzschild y Kerr
       no coinciden píxel a píxel en qué parte del cielo debería verse).
       Primer intento de fix: en vez de un salto duro, difuminar (mezclar
       colores) entre ambos tracers en una banda alrededor del umbral de
       cambio. Diagnosticado con más color-coding (esta vez comparando el
       ángulo θ final de cada tracer directamente, no solo el color): en el
       borde de esa banda ambos tracers predicen θ finales que difieren en
       decenas de grados, no en ruido de punto flotante — ninguna cantidad de
       difuminado de color puede ocultar un desacuerdo de esa magnitud, solo
       lo vuelve menos abrupto visualmente.
     - Fix definitivo: se eliminó el fallback por completo. Se verificó
       (forzando temporalmente todo rayo con spin/carga a pasar solo por
       `traceKerr`, sin ningún fallback) que el integrador completo, con el
       sampleo directo de UV desde (θ,φ) y el reflejo `POLE_GUARD` ya
       existentes, es números lo bastante estable cerca del eje por sí solo
       — el fallback estaba resolviendo un problema (la inestabilidad cerca
       del polo) que un fix anterior ya había resuelto, y solo introducía uno
       nuevo. Verificado en el navegador reproduciendo exactamente el
       escenario reportado (masa=0.75, spin=1.00, cámara en ángulo
       pronunciado): sin conos, sin cuña, sin línea brillante. Queda un
       rastro extremadamente tenue (una fila de puntos casi imperceptibles
       subiendo por el eje, visible solo con zoom fuerte) que es consistente
       con imágenes fantasma de orden superior genuinas — el análogo, sobre
       el eje de spin, de los anillos de Einstein de orden superior en el
       plano ecuatorial — más que con un bug; no se investigó más a fondo
       dado lo sutil que es comparado con los artefactos anteriores.
   - Segundo bug, más serio, encontrado en review: con masa baja (slider cerca
     del mínimo) y spin alto, el fondo entero colapsaba a un solo color sólido.
     Causa: `uMaxRadius` (el umbral de "el rayo escapó" del integrador) se
     calculaba como `300 * mass`, pero la cámara está a una distancia FIJA
     (~122 unidades, hardcodeada en `BlackHoleCanvas` y no reactiva a la masa)
     — a masa=0.3, `uMaxRadius=90 < 122`. La cámara arrancaba entonces más allá
     del propio umbral de escape del integrador: cada rayo cumplía "escapé"
     casi en el primer paso, con θ/φ prácticamente sin cambios respecto al
     valor inicial (que es el mismo para todos los píxeles, ya que solo
     depende de la posición de la cámara) — es decir, toda la pantalla
     terminaba sampleando el mismo píxel de la textura. Fix: `uMaxRadius` es
     ahora una constante fija (`MAX_RAY_RADIUS = 400` en `LensedBackground.tsx`),
     desacoplada de la masa, siempre mayor a la distancia real de cámara.
7. Controles de calidad (pasos del integrador / resolución del shader) para balancear
   fidelidad vs. rendimiento en GPUs modestas.
8. Lensear el disco de acreción. Hoy el disco es geometría de partículas opaca,
   separada del shader de lente — no pasa por el raytracer, así que no se deforma
   ni aparece duplicado arriba/abajo del agujero (el look clásico de la foto de
   M87/Sgr A*, o de Interstellar). Para lograrlo hace falta que el mismo rayo
   curvado del shader detecte cuándo cruza el plano del disco (z=0 en coordenadas
   del disco, entre `innerRadius` y `outerRadius`) durante la integración, y
   samplee el color/temperatura del disco ahí en vez de (o además de) la textura
   de fondo — probablemente usando un mapa de temperatura precalculado en vez de
   volver a generar 8000 partículas dentro del shader. Pedido explícito del
   usuario tras revisar el PR 6 (el disco "queda mediocre" al no deformarse con
   el resto de la imagen).

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
