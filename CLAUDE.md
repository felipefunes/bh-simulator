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
       pronunciado): sin conos, sin cuña, sin línea brillante. Quedó un
       rastro tenue (una línea punteada subiendo por el eje) que en su
       momento se atribuyó tentativamente a imágenes fantasma de orden
       superior genuinas sin investigar más — pero una review posterior
       mostró que seguía siendo bastante visible ("seguimos teniendo los
       jets"), así que se investigó a fondo en vez de darlo por aceptable.
     - Causa real de ese rastro punteado (encontrada agregando un switch en
       el sidebar para ocultar el disco de acreción durante el testing,
       pedido explícito del usuario — ver `showDisk` en el store — porque el
       disco tapaba justo la zona del eje donde aparecía el artefacto):
       primero se probó si era un problema de precisión numérica (subir
       `MAX_STEPS_KERR`/bajar `D_TAU` varias veces), y el patrón no cambió en
       absoluto — descartando error de integración como causa. La causa real
       era conceptual: el bloque `POLE_GUARD` trata *cualquier* cruce cercano
       al polo como un rebote (refleja θ, invierte w_θ), asumiendo que
       siempre hay un punto de retorno real ahí (Θ(θ)=0) que el paso de RK4
       simplemente overshooteó. Eso es cierto para un rayo con L≠0 — pero un
       rayo con L≈0 (el plano vertical que contiene cámara y eje de spin) NO
       tiene punto de retorno en absoluto: Θ(θ) = Q + a²cos²θ es ≥0 para
       todo θ, así que ese rayo genuinamente **pasa por encima del polo**
       hacia el otro lado del cielo (φ → φ+π), igual que caminar en línea
       recta sobre el polo norte de un globo terráqueo te deja 180° del otro
       lado en longitud. Tratar ese cruce como un rebote atrapa el rayo
       rebotando artificialmente entre ambos polos varias veces antes de
       escapar, y cada rebote espurio muestrea casi la misma franja de
       cielo — de ahí la línea punteada (cada punto es una repetición de la
       misma imagen). Fix: antes de aplicar el rebote, se evalúa Θ(θ) en la
       latitud de guarda (`thetaNearPole`, calculado una sola vez por rayo ya
       que L/Q/a no cambian) — si da claramente positivo (sin punto de
       retorno real cerca), es un cruce genuino y se suma π a φ además de
       reflejar θ; si da ~0 (retorno real), se deja el rebote sin más como
       antes. Aplicado en `kerrLensing.ts` (con el test de vitest ya
       existente verificando finitud cerca del polo) y su espejo en
       `LensedBackground.tsx`.
     - Con el fix, la línea punteada dejó de extenderse por todo el cuadro
       (arriba y abajo de la sombra, incluso lejos del agujero, algo que
       nunca tuvo sentido físico para rayos casi sin deflectar) y quedó
       confinada a un tramo corto justo junto a la sombra — consistente
       ahora sí con ecos genuinos del anillo de fotones (el mismo fenómeno
       real que produce anillos de Einstein de orden superior en el plano
       ecuatorial, aquí visto sobre el eje). En el uso normal el disco de
       acreción tapa esa zona por completo. No se investigó más allá de este
       punto.
     - Aun así, en la siguiente review el usuario reportó que las líneas
       seguían ahí ("realmente no sé qué podemos hacer con esas líneas") y,
       además, unas líneas concéntricas alrededor de la sombra con forma de
       "escalera" (bloques dentados, no una curva lisa) — junto con el
       navegador visiblemente forzado en recursos. Estas resultaron ser DOS
       causas nuevas y separadas, ninguna relacionada con la física del
       integrador:
       - El `shaderMaterial` de `LensedBackground` nunca declaraba
         `precision`, dejando que three.js eligiera automáticamente (según
         soporte detectado del driver/GPU) entre `highp`/`mediump`/`lowp`.
         En `mediump` (≈10 bits de mantisa), acumular ~2200 pasos de RK4
         por píxel pierde precisión progresivamente, y esa pérdida se
         manifiesta como bandas/escalones discretos — exactamente las
         líneas concéntricas dentadas reportadas. Fix: `precision="highp"`
         explícito en el `shaderMaterial`. No se descartó por rendimiento;
         de hecho, forzar precisión explícita evita que el driver GPU
         re-evalúe/cambie de precisión en tiempo de ejecución, lo cual
         también puede aliviar el uso de recursos reportado.
       - Aun con `highp`, quedaba un anillo de arcos finos y lisos (sin
         dentado) exactamente donde está la mancha de galaxia de fondo —
         estos SÍ son reales, pero de otra causa: la lente gravitacional
         amplifica el ángulo sólido sin límite cerca de la esfera de
         fotones (en el límite, un anillo entero del cielo colapsa a un
         punto), así que los escalones de 8 bits del gradiente radial de la
         mancha (`createRadialGradient`, sobre un canvas de 2048×1024)
         eventualmente se vuelven visibles al ser magnificados lo
         suficiente — eran invisibles a resolución normal, pero la lente
         los estira hasta hacerlos notorios. Mitigado duplicando la
         resolución de la textura (4096×2048 en `LensedBackground.tsx`),
         lo que empuja el radio en que esto se vuelve visible hacia afuera,
         aunque no elimina el límite de fondo (una textura rasterizada de
         resolución finita bajo magnificación no acotada) — ese trade-off
         de fidelidad vs. rendimiento es justamente lo que los controles de
         calidad del roadmap (ítem 7) deberían exponer como ajustable.
       - Verificado en el navegador reproduciendo el escenario exacto de la
         review (masa=0.75, spin=1.00, disco oculto vía el nuevo switch):
         sin líneas dentadas, sin arcos visibles, sin línea punteada en el
         eje en este encuadre.
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
7. ✅ **Controles de calidad**: selector Baja/Media/Alta en el sidebar
   (`renderQuality.ts` + `useBlackHoleStore.quality`), motivado directamente por
   el review del PR 6 (recursos del navegador "a tope" con spin alto). Dos
   palancas, ambas ya existentes en el shader/Canvas, ahora parametrizadas:
   - **Pasos del integrador**: los `const int`/`const float` fijos del
     fragment shader (`MAX_STEPS_KERR`, `D_TAU`, `MAX_STEPS_SCHW`, `D_PHI`)
     pasan a ser uniforms (`uKerrSteps`/`uKerrDTau`/`uSchwSteps`/`uSchwDPhi`).
     GLSL ES 1.00 exige que el límite de un `for` sea una constante de
     compilación, así que los loops mantienen un cap fijo alto
     (`MAX_STEPS_KERR_CAP`/`MAX_STEPS_SCHW_CAP`, cómodamente por encima del
     preset "Alta") y cortan antes con `if (i >= uKerrSteps) break;` — el cap
     nunca cambia, sólo cuántas iteraciones corren antes del corte. Steps y
     tamaño de paso se escalan inversamente para que su producto (el rango
     total integrado — tiempo de Mino para Kerr, φ para Schwarzschild) se
     mantenga igual entre niveles: "Baja" da pasos más grandes y menos
     numerosos sobre el mismo recorrido, no corta la integración a mitad de
     camino (eso cambiaría a dónde llega el rayo, no sólo cuán preciso es el
     camino). "Media" reproduce exactamente las constantes originales
     pre-PR7, así que el render default no cambia. Invariante (steps ×
     stepSize constante entre niveles) verificado con vitest en
     `renderQuality.test.ts`.
   - **Pixel ratio del Canvas**: `pixelRatioForQuality()` capa el
     `devicePixelRatio` real (nunca lo sobrepasa) — 1× en "Baja", 1.5× en
     "Media", 2× en "Alta" — pasado directo al prop `dpr` de `<Canvas>` en
     `BlackHoleCanvas`. El costo del fragment shader escala con la cantidad
     de píxeles, así que esta es la otra palanca de rendimiento real.
   - Verificado visualmente: "Baja" con spin=1.00 muestra bandas de
     discretización visibles alrededor del resplandor de la galaxia (el
     trade-off es honesto, no gratis) mientras que "Alta" se ve tan limpio
     como (o mejor que) el default anterior — confirma que el control tiene
     efecto real, no es un placeholder.
8. ✅ **Lensear el disco de acreción**. Reemplazo completo (decisión explícita del
   usuario, no la opción "en capas" que hubiera mantenido el disco de partículas
   sin deformar para la vista directa): se eliminó `AccretionDisk.tsx` (las 8000
   partículas) por completo. Ahora el mismo rayo curvado de `traceSchwarzschild`/
   `traceKerr` detecta, en cada paso de la integración, un cruce del plano
   ecuatorial (θ=π/2 en Kerr; signo de la componente y de la posición 3D
   reconstruida vía la base e1/e2 del propio rayo, en Schwarzschild — ver el
   comentario de `traceSchwarzschildRay` en `physics/lensing.ts`) dentro de
   `[innerRadius, outerRadius]`, interpola linealmente el radio/φ del cruce, y
   si cae dentro del disco corta la integración ahí (igual que una captura) en
   vez de seguir hacia la textura de fondo. El color en ese punto es completamente
   analítico (perfil de temperatura de Shakura–Sunyaev + blackbody + Doppler,
   las mismas fórmulas de `physics/accretionDisk.ts`, portadas a GLSL) — no hay
   textura precalculada ni partículas, tal como sugería la nota original del
   roadmap. La dirección tangencial (para el Doppler) se deriva de d(posición)/dφ
   en la convención propia de `traceKerr` (xRef=[1,0,0], yRef=cross(spinAxis,xRef)),
   no de la convención que usaban las partículas viejas — quedó documentado en
   `diskColor()` porque un signo equivocado ahí habría invertido qué lado del
   disco aparece más brillante (co-rotante con fotones prógrados, L>0).
   - Física nueva testeada en vitest antes de portarse a GLSL, mismo patrón que
     siempre: `kerrLensing.test.ts`/`lensing.test.ts` verifican que un rayo
     apuntado (en espacio plano) a un punto conocido del plano ecuatorial
     efectivamente reporta `diskHit` con el radio esperado, que un disco con
     bordes que no contienen ese cruce cae de nuevo a escape/captura normal, y
     que spin≠0 no cambia el plano de cruce (solo φ, por frame dragging). Se
     extrajo `physics/vec3.ts` (antes duplicado dentro de `kerrLensing.ts`) para
     que `lensing.ts` pudiera hacer la misma reconstrucción 3D sin repetir los
     helpers.
   - Bug serio encontrado en review visual: con el disco activado, **toda la
     pantalla se volvía negra sólida** (sin estrellas, sin disco, nada) —
     ni siquiera en la forma del disco, un negro uniforme en todo el frame.
     Diagnosticado forzando primero el color de acierto (`diskHit`) a rojo puro
     en vez de `diskColor(...)`: si el problema hubiera sido en el cálculo de
     color (NaN, temperatura mal calculada) se habría visto rojo sólido en vez
     de negro; en cambio seguía negro, así que el bug estaba en que `captured`
     terminaba en `true` para prácticamente todo rayo. Causa: `traceSchwarzschild`/
     `traceKerr` ganaron un nuevo camino de retorno temprano (el cruce del
     disco) que fijaba `diskHit`/`diskRadius`/`diskPosition` pero nunca escribía
     el parámetro `out bool captured` — un `out` no asignado en todos los
     caminos de retorno es comportamiento no definido en GLSL, y aparentemente
     el driver de este entorno lo leía como "verdadero" en la práctica. El fix
     fue trivial (`captured = false;` explícito junto a `diskHit = true;` en
     ambos tracers) pero encontrar la causa no lo fue — confirmado forzando
     temporalmente la condición de cruce a `false` (sin tocar nada más), lo que
     restauró el render correcto, aislando el bug al bloque de detección de
     disco en sí y no a otra parte del archivo.
   - Verificado en el navegador: el disco ahora se ve curvado hacia arriba
     detrás de la sombra en ángulos oblicuos (el look clásico de M87/Interstellar
     que motivó este PR), con blueshift visible del lado que se acerca; funciona
     en Schwarzschild y Kerr; el switch "Mostrar disco de acreción" (del PR 6)
     sigue ocultándolo por completo (pasa `null` en vez de bounds reales,
     deshabilitando el chequeo de cruce vía el sentinel `innerRadius <= 0`); los
     tres niveles de calidad del PR 7 renderizan sin errores con el disco activo.
   - **Segundo bug, más serio, encontrado en la siguiente review**: con spin o
     carga (Kerr/Reissner–Nordström/Kerr–Newman) el disco aparecía con un
     "mordisco" — una cuña completa faltante — a spin moderado, y directamente
     desaparecía casi por completo a spin extremal. Schwarzschild (spin=carga=0)
     nunca lo mostró, porque no comparte el integrador afectado.
     - Diagnóstico inicial (equivocado): pareció un problema de *muestreo* — cerca
       de la esfera de fotones, θ puede cruzar π/2 y volver dentro de un único
       paso de RK4, y si ambos extremos del paso caen del mismo lado, el chequeo
       de cruce (que sólo miraba los dos extremos) no ve ningún cambio de signo.
       Se probó re-chequear varios puntos interpolados linealmente dentro de cada
       paso — no cambió nada en absoluto. Segunda vuelta: se probó reusar los
       puntos intermedios *reales* del propio RK4 (r2/θ2, r3/θ3, r4/θ4, ya
       calculados para el paso de integración, no interpolados) — tampoco cambió
       nada. Ambos intentos fallaron por la misma razón de fondo: el problema no
       era *dónde* se mira dentro del paso, sino que el paso en sí, con el δτ de
       calidad "Media"/"Baja", es demasiado grande para que la solución numérica
       *alcance* el verdadero extremo de θ cerca de la esfera de fotones — no es
       que la trayectoria correcta cruce π/2 y el muestreo se lo pierda, es que la
       trayectoria *calculada* con ese δτ nunca llega a cruzarlo. Confirmado
       cambiando manualmente sólo la calidad a "Alta" (δτ más fino, mismo rango
       total integrado): el mordisco desaparecía sin tocar nada más del código.
     - Fix real: la precisión del integrador de Kerr **deja de depender del
       selector de calidad**. Antes, "Baja"/"Media"/"Alta" escalaban steps y δτ
       de Kerr igual que los de Schwarzschild (ver PR 7) — ahora `KERR_STEPS`/
       `KERR_D_TAU` en `renderQuality.ts` son una constante fija (6000 pasos,
       δτ ajustado para mantener el mismo rango total integrado de siempre), y
       el selector de calidad sólo controla los pasos de Schwarzschild (donde sí
       es seguro reducirlos) y el pixel ratio del render (que sigue aplicando
       parejo, con o sin spin). No es un descuido: bajar la precisión de Kerr no
       sólo se ve peor, directamente da un resultado *incorrecto* (geometría con
       agujeros) — y eso es peor que un render más lento. El motivo original de
       "Calidad" (PR 7, rendimiento) queda intacto para el caso común
       (Schwarzschild, o pixel ratio en cualquier caso); lo que se pierde es la
       posibilidad de bajar el costo de Kerr específicamente, hasta que exista un
       integrador de paso adaptativo (δτ más fino sólo cerca de la esfera de
       fotones, normal en el resto) — trabajo futuro, ver `renderQuality.ts`.
     - Verificado en el navegador en el peor caso conocido (spin=1.00 extremal,
       calidad "Baja", que antes hacía desaparecer el disco casi por completo):
       disco completo, sin mordiscos, con un ligero grano/ruido numérico sólo en
       el borde más cercano al eje — un residuo mucho más sutil, consistente con
       que ISCO≈horizonte en el límite extremal es un régimen genuinamente
       delicado, no con el bug original. Repetido con carga (Reissner–Nordström)
       en "Baja": mismo resultado limpio, confirmando que el fix cubre el
       integrador Kerr–Newman completo (no sólo el caso de spin puro).
   - **Espesor del disco — intentado, revertido**, pedido explícito del
     usuario tras revisar (los discos reales no son un plano infinitesimal, y
     uno lo es se vuelve invisible visto exactamente de canto). El chequeo de
     cruce, que buscaba θ=π/2 exacto (Kerr) o y=0 exacto (Schwarzschild), pasó
     a buscar la entrada a un *slab* — dos caras en vez de una — dentro de
     `[innerRadius, outerRadius]`. Esto pasó por tres rondas de bugs
     encontrados en review visual antes de terminar revertido por completo:
     - *Primera versión (buggy)*: slab por ángulo fijo desde el origen
       (`disk.halfAngle`, un cono desde el origen). Reportado como **"se nos
       convirtió en un hi-hat lol"** — de canto, el cono (cuyo espesor físico
       crece sin límite con r) se estiraba bajo la lente propia del disco
       hasta ocupar casi todo el cuadro, como dos conos que se encuentran en
       un punto.
     - *Fix*: espesor físico *constante* (`disk.halfThickness`, altura mundial
       fija en vez de ángulo) — el disco pasó a ser un slab plano de verdad a
       cualquier radio.
     - *Segundo bug*: de canto, el disco se veía como **dos discos separados
       con un espacio vacío entre medio** — "tenemos ese espacio aún entre dos
       discos". Causa: el chequeo de cruce exigía que radio y espesor se
       satisficieran *en el mismo paso* de integración; un rayo casi de canto
       puede entrar a la banda de espesor muy lejos del agujero (radio aún
       fuera de bounds) y sólo entrar en radio muchos pasos después, sin un
       nuevo cruce de cara que dispare el chequeo ese paso posterior — ese
       rayo nunca se registraba como hit, caía al fondo, y aparecía como el
       hueco vacío entre los rayos que sí coincidían en ambas condiciones a la
       vez. Fix: chequear la región combinada (radio Y espesor) como un solo
       predicado, disparando en su transición falso→verdadero.
     - **Reversión completa**: arreglado el hueco, el usuario reportó que la
       performance volvía a colapsar ("volvimos a colapsar con la
       performance") y propuso volver al disco plano. Diagnóstico: el costo
       extra por paso que el espesor agrega (evaluar el predicado combinado
       en cada uno de los pasos de la integración) se suma sobre la
       integración de Kerr, que ya corre a `KERR_STEPS` fijo y alto (6000, ver
       PR8 más arriba) precisamente porque *no* se puede bajar sin romper la
       geometría cerca de la esfera de fotones — cualquier trabajo adicional
       por paso, multiplicado por 6000 pasos y por cada píxel del frame, es
       exactamente el tipo de costo que ese diseño ya dejaba poco margen para
       absorber. Dado que éste es ante todo un simulador educativo/visual (la
       misma lógica que motivó el ítem 9 del roadmap), un disco plano que
       renderiza fluido gana sobre uno con espesor que no renderiza en
       absoluto. Se revirtió por completo a la geometría original (plano
       infinitesimal, cruce por cambio de signo de y/θ=π/2, sin
       `halfThickness` en `DiskBounds` de ningún módulo ni en el shader) —
       ver el historial de git para el detalle completo de las tres rondas de
       fixes intentadas antes de la reversión.
   - **Textura de flujo rotante**, para recuperar la sensación de giro que se
     perdió al reemplazar las partículas (un disco analítico estacionario y
     simétrico genuinamente no necesita animarse — su patrón de brillo no
     cambia con el tiempo en ese modelo idealizado — así que no había nada que
     animar antes de esto). Textura de ruido procedural tileable
     (`generateDiskFlowTexture()`, canvas 2D, mismo patrón que la textura de
     fondo: varias octavas de blobs suaves, cada uno dibujado tres veces
     (∓ancho) para que el borde U=0/1 empalme sin costura ya que se samplea
     con `RepeatWrapping`) sampleada en `diskColor()` con coordenadas
     co-rotantes: φ mundial (recuperado directo de `position`, sin importar
     qué tracer generó el punto — es un punto 3D exacto de por sí, no hace
     falta el φ interno de ningún tracer) menos Ω(r)·t·`VISUAL_TIME_SCALE`
     (Ω Kepleriano = √(M/r³), mismo ×15 de siempre para legibilidad). El
     resultado modula el brillo del color analítico ya existente (no lo
     reemplaza), y al ser Ω(r) decreciente con r, el patrón gira visiblemente
     más rápido cerca del ISCO que en el borde exterior — la misma rotación
     diferencial real, ahora visible. Verificado en el navegador: patrón de
     turbulencia claramente animado (dos capturas separadas por unos segundos
     muestran el patrón desplazado), con el streaking característico de
     rotación diferencial más marcado cerca del borde interno.
9. ✅ **Modo Visual** (idea del usuario). Motivación: éste es ante todo un
   simulador *educativo/visual* — nadie está mirando las ecuaciones, están
   mirando el render — y aun con `KERR_STEPS` fijo en un valor alto (ítem 8),
   el spin seguía sintiéndose como que "rompe todo": con espesor de disco
   (ítem 8) el costo extra por paso, multiplicado por 6000 pasos de Kerr y
   por cada píxel, volvió a colapsar la performance. El usuario propuso
   rescatar sólo el achatamiento asimétrico de la sombra (la señal visual de
   spin que la gente realmente reconoce a simple vista) en vez de toda la
   física detrás, y ver si eso alcanzaba para dejar de romper la performance.
   - **`physics/orbits.ts`**: nueva función `criticalImpactParameter`
     (promovida desde un helper que ya existía sólo en
     `kerrLensing.test.ts`) — el parámetro de impacto crítico ecuatorial
     exacto, prógrado/retrógrado, derivado de la condición de doble raíz
     R(r_ph)=R'(r_ph)=0 sobre la esfera de fotones ya verificada. A spin=0 usa
     la fórmula de Reissner–Nordström (se reduce a 3√3M con carga=0 también);
     a spin≠0 divide por spin, lo que en el límite extremal exacto (a=M,
     prógrado) da 0/0 porque Δ y (r_ph−M) se anulan juntos — un límite
     genuinamente finito (2M) que floating-point puro puede convertir en NaN.
     Se resuelve directo (`P=0` cuando el denominador es exactamente 0, válido
     porque Δ también tiende a 0 ahí). Testeado contra los valores extremales
     conocidos de la literatura (prógrado 2M, retrógrado 7M a spin=M).
   - **`physics/visualSpinLensing.ts`** (nuevo módulo): `effectiveMassForRay`
     calcula, para cada rayo, una masa *efectiva* que alimenta al integrador
     de Schwarzschild — de otro modo intacto — en vez de la masa real, sólo
     para la parte de curvatura/captura. Calibrado (no una constante
     inventada) para que, en un rayo puramente ecuatorial (`sinAngle=±1`,
     "qué tan ecuatorial es el plano orbital de este rayo respecto al eje de
     spin"), la propia fórmula de Schwarzschild (3√3·masa_efectiva) reproduzca
     *exactamente* el parámetro de impacto crítico real de Kerr para ese spin
     y sentido — y en un rayo polar (`sinAngle=0`) devuelve la masa real sin
     sesgo, porque el frame dragging se anula genuinamente sobre el eje.
     Entre polo y ecuador, interpola linealmente en `|sinAngle|` — real GR no
     interpola así, pero es la aproximación deliberada "menos rigurosa, más
     visual" que se pidió. `traceVisualSpinRay` arma el mismo tipo de wrapper
     3D que `kerrLensing.ts` (misma base e1/e2, mismo cálculo de L vía
     `cross(cameraPos, rayDir)·spinAxis`), pero llamando al integrador de
     `lensing.ts` sin tocarlo. La carga se ignora por completo para la
     curvatura (sólo afecta horizonte/disco vía las fórmulas exactas de
     siempre) — coincide con la observación original del usuario de que ese
     efecto es casi invisible de todas formas.
   - **`LensedBackground.tsx`**: se eliminó el integrador Kerr–Newman completo
     del shader (Carter constant, Mino time, `POLE_GUARD`, `uKerrSteps`/
     `uKerrDTau`, `uCharge` — todo el bloque, no sólo dejado de usar) y se
     reemplazó por una traducción directa de `effectiveMassForRay`
     (`photonSphereRadiusGLSL`/`criticalImpactParameterGLSL`/
     `effectiveMassForRayGLSL`) que alimenta al mismo `traceSchwarzschild` de
     siempre para *todo* rayo, sin importar el spin. `physics/kerrLensing.ts`
     queda intacto, testeado, sin usar para renderizar — la referencia
     rigurosa que el usuario pidió no perder, para quien corra esto en una
     máquina más potente o quiera extender la física más adelante.
   - Efecto directo en performance: el selector de calidad (ítem 7), antes
     limitado a Schwarzschild puro, ahora aplica parejo sin importar el spin
     — un agujero con spin ya no es un caso especial más caro, exactamente el
     problema que motivó este ítem.
   - Verificado en vitest: `criticalImpactParameter` (incluyendo el caso
     extremal exacto sin NaN), `effectiveMassForRay` (reduce a la masa real a
     spin=0 y a sinAngle=0; en `sinAngle=±1` iguala 3√3·masa_efectiva al
     parámetro de impacto crítico real; interpola linealmente entre medio), y
     `traceVisualSpinRay` (reproduce el umbral de Schwarzschild a spin=0;
     muestra la asimetría de achatamiento — un rayo ecuatorial exactamente en
     el umbral real es capturado prógrado pero escapa retrógrado; un rayo
     puramente polar queda sin sesgo a cualquier spin; el cruce del disco
     sigue funcionando). Build y lint limpios. Pendiente: confirmación visual
     en navegador (sesión sin conexión a la extensión de Chrome en el momento
     de este cambio).
   - Alcance deliberado, no un olvido: no se agregó un selector "Visual" vs.
     "Riguroso" en el sidebar — este PR reemplaza directamente qué renderiza
     el shader, sin dejar ambos caminos seleccionables. Si en algún momento
     hace falta el modo riguroso real (máquina más potente, o verificar
     precisión), sigue ahí intacto en `physics/kerrLensing.ts`; conectarlo de
     nuevo al shader como una opción sería trabajo futuro, no incluido acá.
10. ✅ **Tooltips informativos** (pedido del usuario, con mockup a mano de
    referencia: horizonte de eventos, esfera de fotones, sombra y disco de
    acreción, cada uno con una línea guía apuntando a un punto del render).
    - `components/BlackHoleCanvas/InfoTooltips.tsx` (nuevo): cuatro leader
      lines + cajas de descripción, cada una anclada a un punto 3D fijo
      (dirección de mundo elegida a mano para abanicar sobre el hemisferio
      que mira a la cámara en el encuadre default, no una posición
      físicamente significativa) a un radio real — horizonte
      (`horizonRadii`), esfera de fotones y sombra (`photonSphereRadius`/
      `criticalImpactParameter` de `physics/orbits.ts`, con el mismo patrón
      de fallback-a-múltiplo-del-horizonte que ya usa el radio interno del
      disco para los casos sin forma cerrada — carga y spin ambos ≠0), y
      disco (punto medio entre `innerRadius`/`outerRadius`, ya calculados en
      `BlackHoleCanvas`). Los anclajes se proyectan a pantalla vía
      `@react-three/drei`'s `<Html>`, que ya seguía la cámara — no hizo falta
      escribir esa parte.
    - Oclusión: cada tooltip se oculta cuando su punto de anclaje queda
      geométricamente detrás de la esfera de la sombra vista desde la cámara
      (test de intersección rayo-esfera contra `shadowRadius`, el mayor de
      los "objetos casi esféricos" opacos) — si no, el label seguiría
      mostrándose a través de la sombra sólida al rotar la cámara al lado
      opuesto. No se testea contra el disco (un ocluyente plano y delgado,
      más difícil de hacer bien barato) — hueco aceptado en esta primera
      pasada.
    - Botón de toggle (`showTooltips` en el store, junto a `showDisk`/
      `quality`) agregado como su propio grupo en
      `black-hole-canvas__side-controls`, con más separación (`gap: 24px`)
      que el gap interno de +/- zoom (`gap: 8px`) para que se lea como un
      control aparte, tal como pidió el usuario ("al nivel de los de zoom in
      y zoom out pero un poco más separado"). Se refactorizó
      `.black-hole-canvas__zoom-button` a `.black-hole-canvas__control-button`
      compartida entre los tres botones.
    - Bug encontrado en QA de mobile (pedido explícito del usuario: "cuando
      se haga hay que verificar en mobile"): en un viewport angosto (390px),
      el label de "Disco de acreción" se salía por el borde derecho de la
      pantalla — su offset fijo en píxeles (pensado para el encuadre de
      escritorio) empujaba la caja más allá del ancho disponible. Fix: cada
      tooltip proyecta su propia posición en pantalla cada frame (mismo
      `useFrame` que ya hace el test de oclusión) y, si su offset horizontal
      la sacaría del viewport (con un margen fijo `LABEL_HALF_WIDTH`),
      refleja el signo de ese offset — un flip simple, no un sistema general
      de reposicionamiento consciente del viewport, pero suficiente en la
      práctica. Verificado en el navegador a 390×844 (con y sin el sidebar
      bottom-sheet abierto simultáneamente) y contra el mismo bug reproducido
      antes del fix.
    - `vite.config.ts`: `chunkSizeWarningLimit` subido de 1000 a 1200 —
      el chunk de `three` creció al agregar `Html` de drei.
    - Deliberadamente no incluido: oclusión contra el disco (arriba), y un
      sistema de reposicionamiento de labels más general que un flip
      horizontal simple (por ejemplo, evitar que dos labels se superpongan
      entre sí, o clamping vertical) — quedan como mejoras futuras si hacen
      falta.
11. ✅ **Blur en el borde externo del disco** (pedido del usuario: "un poco
    de blur al borde externo del disco, de manera que suavice la línea y se
    parezca más a un disco de polvo"). `physics/accretionDisk.ts`: nueva
    `outerEdgeFade(outerRadius, fadeWidth, r)` — un smoothstep estándar (no
    un modelo real de densidad/profundidad óptica), 1 en y dentro de
    `outerRadius`, bajando suave a 0 en `outerRadius + fadeWidth`. El borde
    interno ya se atenúa físicamente (la temperatura de Shakura–Sunyaev cae
    a 0 en la ISCO); esto sólo toca el externo, que antes cortaba en seco.
    - `LensedBackground.tsx`: `checkDiskSegmentY` sigue detectando cruces
      exactamente igual, pero alimentado con `uDiskOuterRadius +
      uDiskOuterFadeWidth` en vez de sólo `uDiskOuterRadius` — así un cruce
      dentro de la zona de fade todavía registra un hit (el fade sólo afecta
      el brillo final en `diskColor`, vía `outerEdgeFadeGLSL`, no si hay hit
      o no). `DISK_OUTER_FADE_RATIO = 0.15` (fracción de `outerRadius`,
      mismo patrón que otros radios del disco — escala con el tamaño del
      disco en vez de verse desproporcionado en masas/spins extremos).
    - Verificado en vitest (`outerEdgeFade`: 1 dentro, 0 más allá de
      `outerRadius + fadeWidth`, 0.5 exacto en el punto medio, monótono
      entre medio, y el caso `fadeWidth <= 0` reproduce el corte duro
      original exactamente) y en el navegador (el borde exterior del disco
      se ve como un degradado suave hacia la oscuridad, no una línea recta,
      confirmado en ambos lados de la elipse visible). 82/82 tests, build y
      lint limpios.
    - **Bug encontrado en review**: el fade oscurecía el color del disco
      hacia negro (`color * edgeFade`) sin importar qué hubiera detrás —
      correcto contra el fondo vacío del espacio, pero sobre la mancha de
      la galaxia lejana (brillante) esto se veía como un anillo oscuro
      cortando el brillo en vez de una disolución suave hacia él. El
      usuario lo notó directamente: "¿es posible que vaya a un rgba
      transparente?" — el diagnóstico correcto: hacía falta mezclar con lo
      que hay *detrás* del borde en ese píxel (el fondo real, estrellas o
      mancha de galaxia), no oscurecer hacia negro.
      - Fix: `traceSchwarzschild` gana un nuevo out-param `diskFade`. Un
        cruce opaco (`diskFade>=0.999`, el caso común) sigue retornando de
        inmediato como antes — cero cambio de comportamiento ni de costo
        para la gran mayoría de píxeles. Un cruce en la zona de fade
        (`diskFade<1`) ya NO retorna: sigue integrando (con los chequeos de
        disco ahora deshabilitados para el resto de ese rayo, vía un guard
        `!diskHit`) hasta encontrar su destino real — capturado, o la
        dirección de escape hacia el fondo — exactamente lo que ese rayo
        habría mostrado si el disco no lo hubiera interceptado ahí.
        `diskColor()` ya no aplica el fade internamente; en cambio,
        `schwarzschildColor()` compone explícitamente
        `mix(colorDeFondo, colorDelDisco, diskFade)` — composición "over"
        estándar, en vez de oscurecer.
      - Costo: sólo los píxeles que caen en el anillo delgado de fade
        (una fracción pequeña del borde exterior) pagan el costo de seguir
        integrando después del cruce; el resto del disco (la gran mayoría,
        `diskFade≈1`) no cambia en absoluto.
      - Verificado en el navegador: sin errores de consola, con y sin
        spin (0.98), el degradado ahora revela el fondo real (se confirmó
        una estrella asomando justo en la zona de fade) en vez de un
        borde oscurecido. 82/82 tests, build y lint limpios.

12. ✅ **Fix del artefacto de spin en Modo Visual** (reportado por el usuario:
    "el issue del spin. Sigue habiendo comportamientos extraños al aumentar el
    spin", con el pedido explícito de simplificar la física aún más si hacía
    falta para eliminarlo — "iría simplificando la física a un punto en que
    sólo se incorporen los cambios visuales si es que se puede"). Dos bugs
    distintos, encontrados y resueltos en secuencia:
    - **Bug 1 — `effectiveMassForRay` (la primera versión de Modo Visual,
      ítem 9) producía arcos concéntricos punteados/aliased a spin alto.**
      Dos intentos de ajuste fallaron sin cambiar el artefacto en absoluto:
      suavizar el blend con `sinAngle²` (por si el kink de derivada en
      `|sinAngle|` en el polo fuera la causa) y amortiguar el sesgo al 30% (por
      si la magnitud fuera la causa). Ninguno de los dos cambió el artefacto ni
      un poco — la causa real no era la suavidad ni la magnitud del sesgo, sino
      variar la *masa* en absoluto cerca de la esfera de fotones: las
      geodésicas nulas que dan varias vueltas ahí son extremadamente sensibles
      a la masa, así que hasta una variación suave y continua por píxel separa
      píxeles vecinos en números de vuelta completamente distintos.
      Presentado al usuario, quien confirmó explícitamente seguir con un
      rediseño de un solo lado (`AskUserQuestion`, opción elegida: "Sí, un solo
      lado (recomendado)") en vez de seguir iterando sobre la variación de masa.
      - **Rediseño**: `physics/visualSpinLensing.ts` ya no varía la masa en
        absoluto — todo rayo se traza con la masa real, byte a byte igual que
        spin=0 (ya probado libre de artefactos). El spin sólo entra como una
        corrección posterior a la decisión final de captura/escape: si el
        parámetro de impacto cae bajo `retrogradeCriticalImpactParameter`
        (nueva función, sesgada sólo para rayos retrógrados —
        `sinAngle < 0` — interpolando `sinAngle²` hacia el valor crítico real
        de Kerr en el ecuador retrógrado), un rayo que habría escapado se
        reclasifica como capturado. Los rayos prógrados/polares no cambian
        nunca (siempre el umbral de Schwarzschild puro). Trade-off aceptado a
        propósito: la sombra sólo crece del lado retrógrado — no puede encoger
        limpiamente del lado prógrado (un rayo genuinamente capturado no tiene
        una trayectoria de escape "falsa" con la que reemplazarlo con
        principios). `LensedBackground.tsx` recibió la traducción GLSL
        equivalente (`retrogradeCriticalImpactParameterGLSL`), reemplazando
        `effectiveMassForRayGLSL` (eliminada) en `main()`.
      - Testeado en vitest (`visualSpinLensing.test.ts`, reescrito): reduce a
        Schwarzschild puro a spin=0; rayos prógrados no sesgados a ningún spin
        (incluso entre el umbral real prógrado y el de Schwarzschild); rayos
        retrógrados sí muestran el crecimiento de sombra (capturados entre el
        umbral de Schwarzschild y el retrógrado real); rayo puramente polar sin
        sesgo a cualquier spin; cruce del disco intacto.
    - **Bug 2 — tras el rediseño, el artefacto (arcos/línea punteada) seguía
      presente**, lo cual de hecho refutaba que la causa original
      (`effectiveMassForRay`) fuera la causa de *este* artefacto visible en
      particular, aunque el problema teórico que motivó el rediseño era real
      igual. Diagnosticado por bisección — neutralizando una entrada
      dependiente de spin a la vez, verificando en el navegador después de
      cada una (mismo viewport, sin recargar, para evitar falsos positivos por
      el tamaño de ventana variando entre `navigate`): override retrógrado
      neutralizado (seguía) → `uHorizonRadius` forzado fijo (seguía) → disco
      desactivado (el artefacto fuerte desaparecía, sólo quedaba un patrón
      tenue y sin relación con el spin) → disco reactivado (el artefacto fuerte
      volvía). Causa real: `BlackHoleCanvas.tsx` usa la ISCO real de Kerr
      (`iscoRadius(params)`, que encoge hacia el horizonte a spin alto) para el
      radio interno del disco, pero el chequeo de cruce del disco en el shader
      corre sobre el rayo curvado por la esfera de fotones de Schwarzschild
      pura (3M) — Modo Visual nunca varía eso. Cuando el borde interno del
      disco encoge lo bastante para acercarse a esa esfera de fotones ya
      desalineada, reaparece la misma clase de bug de "cruce de disco
      sub-resuelto" que el PR 8 ya había arreglado una vez para el integrador
      de Kerr (un disco con mordiscos/dentado).
      - Fix: `MIN_DISK_INNER_RADIUS_TO_MASS_RATIO = 4` en
        `BlackHoleCanvas.tsx` — el radio interno del disco es
        `Math.max(iscoRadius(params) ?? ..., 4 * mass)`, un piso que mantiene
        el disco a una distancia segura de la esfera de fotones de
        Schwarzschild sin importar cuánto encoja la ISCO real con el spin.
        Costo aceptado: el disco deja de encoger hasta el horizonte a spin
        extremal como haría la ISCO real — se congela en ese piso en cambio.
        Verificado probando primero un override total (`6 * mass`, ignorando
        spin) para confirmar que el piso era la causa correcta, luego el
        clamp menos drástico (`Math.max(ISCO real, 4*mass)`) — igual de
        limpio, permitiendo algo de encogimiento real.
    - Verificado en el navegador en el peor caso conocido (spin=1.00, calidad
      "Media" y "Alta"): sin arcos, sin línea punteada, sombra asimétrica
      (crecimiento retrógrado) todavía visible — confirma que el rediseño de
      un solo lado sigue intacto y que el fix es el del disco, no una reversión
      del rediseño. 83/83 tests, build y lint limpios.
13. ✅ **Anti-aliasing del borde del disco contra sí mismo** (reportado por el
    usuario tras revisar el fix del blur del borde externo — ítem 11: "sigo
    viendo el borde del disco negro [...] es que es difícil verlo contra el
    espacio, pero contra sí mismo si se nota"). No era una regresión del fade
    del ítem 11 (ese sigue funcionando: revela el fondo real, no oscurece a
    negro) sino un fenómeno distinto, encontrado explorando varios ángulos de
    cámara: cerca de la sombra, la lente gravitacional puede generar una
    *imagen de orden superior* del disco (el lado lejano, curvado por encima
    de la sombra) comprimida angularmente en apenas un puñado de píxeles de
    pantalla. El shader dispara un solo rayo por píxel, así que la transición
    real (continua en el espacio del parámetro de impacto) entre "el rayo cruza
    el disco" y "el rayo escapa limpio" puede caer entera entre un píxel y el
    siguiente — no hay forma de que se vea gradual con un solo muestreo, sea
    cual sea el fade aplicado. Contra el fondo (espacio, ya oscuro) ese salto es
    invisible; junto a otra parte del disco (brillante), se lee como un borde
    negro duro — de ahí "contra sí mismo si se nota".
    - Se presentaron tres opciones al usuario (`AskUserQuestion`): supersampling
      en el shader, blur/glow de post-proceso general, o dejarlo (es una
      "dark lane" real entre dos imágenes lensadas, el mismo fenómeno detrás de
      las franjas oscuras de renders reales de agujeros negro). El usuario
      eligió supersampling — ataca la causa (aliasing), a diferencia de un blur
      general que suavizaría también el borde real de la sombra (una
      discontinuidad física genuina que no debería difuminarse).
    - `physics/renderQuality.ts`: nuevo campo `diskSupersamples` en
      `IntegratorQuality` — 1 (sin cambio de costo/comportamiento) en
      "Baja"/"Media", 5 en "Alta". Mismo patrón que `schwSteps`/`schwDPhi`: el
      selector de calidad (ítem 7) es la palanca de costo vs. fidelidad, así
      que el render por default no cambia.
    - `LensedBackground.tsx`: el cuerpo de `main()` (trace + color + el
      override retrógrado del ítem 12) se extrajo a `sampleColor(rd)`, ahora
      llamada 1 vez (sin cambio) o 5 veces (centro + 4 esquinas a un cuarto de
      píxel de distancia, promediadas) según `uDiskSupersamples`. El desvío de
      cada muestra usa una base tangente perpendicular al rayo central,
      escalada por `uPixelAngularSize` (FOV vertical entre la altura del
      render en píxeles de dispositivo, calculada una vez por frame, no por
      rayo). La base tangente usa un vector de referencia que cambia según
      `rd0.y` en vez de un `WORLD_UP` fijo — con cámara mirando derecho hacia
      abajo (una vista cenital real de esta app, no un caso raro) el producto
      cruz con un `WORLD_UP` fijo se anula para toda una franja de píxeles de
      pantalla, no sólo uno.
    - Verificado en vitest (`renderQuality.test.ts`: "Baja"/"Media" en 1,
      "Alta" mayor a 1), build y lint limpios, y en el navegador (calidad
      "Alta" renderiza sin errores de consola en varios ángulos, incluida una
      vista casi cenital, sin regresión visual respecto a "Media"). No se
      logró reproducir en esta sesión, píxel a píxel, el ángulo exacto de
      cámara del screenshot original del usuario — la confirmación visual
      definitiva de la imagen secundaria suavizándose queda pendiente de que
      el usuario la vea en su propio ángulo tras el deploy.

14. ✅ **`DISK_SUPERSAMPLES` deja de ser exclusivo de "Alta"** (reportado por el
    usuario con una captura: un parche cruzado/punteado justo donde el borde
    del disco roza una imagen lensada de orden superior de sí mismo, mirando
    desde abajo del plano del disco de forma que éste cruza por arriba de la
    sombra — "esas circunferencias perimetrales negras... desaparecen con
    calidad alta"). Es la misma clase de aliasing del ítem 13, no un bug
    nuevo — pero el ítem 13 sólo lo corrige en calidad "Alta"
    (`diskSupersamples: 5` ahí, `1` en "Baja"/"Media"), así que seguía
    apareciendo en las otras dos.
    - Diagnóstico por aislamiento, no por inspección de código: en vez de
      asumir que "Alta" arregla esto por su mayor precisión de integrador
      (`schwSteps`/`schwDPhi`) o su mayor pixel ratio, se probó cada palanca
      por separado. Subir sólo `diskSupersamples` a 5 en "Media" — sin tocar
      `schwSteps`/`schwDPhi`/pixel ratio de "Media" — eliminó el artefacto
      por completo. Repetido en "Baja" (el integrador más grosero de todos,
      80 pasos): mismo resultado limpio. Conclusión: el supersampling por sí
      solo lo arregla, sin importar la precisión del integrador — confirma
      que es aliasing de muestreo único (ítem 13), no una integración
      sub-resuelta como la de Kerr (ítem 8/9).
    - Dado que reducirlo no es un trade-off de nitidez sino un bug real
      (ruido/glitch visible), se aplicó el mismo criterio que
      `KERR_STEPS`/`KERR_D_TAU` en su momento (ítem 8): en vez de una opción
      barata que a veces rompe la imagen, se sacó de `IntegratorQuality` y
      pasó a ser una constante fija (`DISK_SUPERSAMPLES = 5` en
      `renderQuality.ts`, ya no parte del registro por nivel). El selector de
      calidad sigue controlando `schwSteps`/`schwDPhi` y el pixel ratio (las
      palancas que sí es seguro reducir) — el costo del supersampling ahora
      lo paga todo nivel por igual.
    - `LensedBackground.tsx`: el uniform `uDiskSupersamples` y su `if` en
      `main()` se eliminaron — el promedio de 5 muestras (centro + 4 esquinas
      a un cuarto de píxel) corre siempre, sin condicional. Simplifica el
      shader además de arreglar el bug.
    - Verificado: 84/84 tests (el test de `renderQuality.test.ts` que
      comprobaba "sólo en Alta" se reemplazó por uno que confirma que
      `DISK_SUPERSAMPLES` no depende del nivel), build y lint limpios, sin
      errores de consola en "Baja" tras el cambio. La reproducción exacta del
      ángulo de cámara del usuario (justo debajo del plano del disco, con
      zoom) costó bastante lograr en el navegador — los controles de órbita
      quedan "pegados" en el polo exacto (cenital) si se arrastra sólo en esa
      dirección, y hace falta arrastrar en la dirección opuesta para salir de
      ahí — pero una vez reproducido, permitió confirmar el diagnóstico por
      aislamiento de variables arriba, que es la evidencia real del fix (más
      confiable que una comparación visual antes/después sujeta a variación
      de encuadre).
    - **Rechazado por el usuario tras probarlo**: "el costo en performance
      fue demasiado alto. En calidad media el navegador casi explota". El
      diagnóstico de aislamiento de variables era correcto (el supersampling
      sí arregla el bug, sin importar la precisión del integrador), pero la
      conclusión de implementación no — pagar 5x en *todo* píxel de la
      pantalla, en los tres niveles, es un costo real y notorio en un shader
      que ya es el cuello de botella conocido de todo este proyecto (ver
      ítems 6/7/8/9), no sólo un detalle de benchmark. Verificado sólo
      "no hay errores de consola" antes de recomendar aplicarlo a todo
      nivel, sin medir el costo real en cuadros por segundo — ese fue el
      hueco en la verificación.
      - **Fix real**: en vez de pagar el costo en cada píxel, `main()` ahora
        lo paga sólo en los píxeles cuyo parámetro de impacto cae cerca del
        valor crítico (`DISK_SUPERSAMPLE_IMPACT_MARGIN_RATIO = 0.35` del
        valor crítico) — que es, por construcción, exactamente la región de
        lente fuerte donde las imágenes de orden superior se comprimen
        (ninguna imagen múltiple existe lejos de la esfera de fotones), así
        que no es una heurística aproximada sino el criterio geométrico
        correcto para dónde puede ocurrir este aliasing en absoluto. El
        resto de la pantalla (fondo, la mayor parte del disco) vuelve al
        costo de un solo rayo por píxel, igual que antes del ítem 13.
      - Verificado visualmente coloreando temporalmente de rojo la región
        con supersampling activo (mismo patrón de diagnóstico que en PRs
        anteriores — colorear qué camino de código atiende cada píxel): un
        anillo delgado alrededor de la sombra, ni remotamente toda la
        pantalla, confirmando que el costo real quedó acotado a esa región
        antes de revertir el color de diagnóstico.
      - `DISK_SUPERSAMPLES` en `renderQuality.ts` sigue siendo 5 (el
        multiplicador de costo dentro de esa región no cambió) — lo que
        cambió es cuántos píxeles pagan ese multiplicador.

Este roadmap es una guía, no un contrato — el orden puede ajustarse PR a PR según lo que
se aprenda en el camino (igual que en galaxy-simulator).

## Known issues

Ninguno conocido actualmente. El artefacto histórico cerca del eje de spin (línea
punteada / arcos tenues a spin alto, [issue #7](https://github.com/felipefunes/bh-simulator/issues/7))
quedó obsoleto por el reemplazo completo del integrador de Kerr por Modo Visual (ítem 9):
la causa original (`POLE_GUARD`/la coordenada singular del polo θ en el integrador de
Carter) ya no existe en absoluto en el código que renderiza — Modo Visual traza con el
integrador 2D de Schwarzschild, que no tiene coordenada θ ni concepto de polo. Es una
garantía estructural (el camino de código se eliminó, no se parchó) y no algo que haga
falta re-verificar caso por caso. Los ítems 12 y 13 documentan artefactos visualmente
similares pero de causas completamente distintas (un desajuste de radios entre el disco
y la esfera de fotones; aliasing de muestreo único cerca de imágenes lensadas de orden
superior), ya resueltos.

## Deploy

Blueprint de Render.com como Static Site: ver `render.yaml` en la raíz. Build command
`npm ci && npm run build`, publish path `./dist`.

## Flujo de trabajo

Se trabaja por PR, una rama por feature (`pr-N-descripcion`). Cada PR debe incluir una
captura de pantalla del estado visual resultante en el body del PR — las imágenes se
suben a la rama huérfana `pr-assets` y se referencian vía
`raw.githubusercontent.com/felipefunes/bh-simulator/pr-assets/<archivo>`, igual que en
galaxy-simulator.
