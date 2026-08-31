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
   - **Espesor del disco**, pedido explícito del usuario tras revisar (los discos
     reales no son un plano infinitesimal, y uno lo es se vuelve invisible visto
     exactamente de canto). El chequeo de cruce, que antes buscaba θ=π/2 exacto
     (Kerr) o y=0 exacto (Schwarzschild), ahora busca la entrada a un *slab* —
     dos caras en vez de una — dentro de `[innerRadius, outerRadius]`.
     - Primera versión (buggy): el slab se definía por ángulo fijo desde el
       origen (`disk.halfAngle`, caras en π/2∓halfAngle en Kerr, ±r·sin(halfAngle)
       en el y de Schwarzschild). Reportado por el usuario como **"se nos
       convirtió en un hi-hat lol"**, con captura mostrando el disco, visto casi
       exactamente de canto, como dos conos que se encuentran en un punto — un
       reloj de arena, no un disco delgado. Causa: un umbral angular es
       literalmente un cono cuyo espesor físico (r·sin(halfAngle)) crece sin
       límite con r; bajo la lente gravitacional propia del disco cerca de la
       sombra, visto casi de canto, ese cono se estira hasta ocupar casi todo el
       cuadro en vez de verse como un borde sutil.
     - Fix: el slab pasó a definirse por espesor físico *constante*
       (`disk.halfThickness`, en `DiskBounds` de ambos módulos — 0 reproduce el
       plano original), no por ángulo — dos caras a altura mundial
       ±halfThickness (comparado contra r·cosθ en Kerr, contra y en Schwarzschild
       ya que ese tracer ya trabaja en y del mundo) en vez de ±r·sin(halfAngle).
       Así el disco es un slab plano de verdad a cualquier radio, en vez de un
       cono que se abre. La reconstrucción de posición en Kerr, al ya no conocer
       θ en el punto de cruce (sólo y exacto y r interpolado), pasa por
       ρ=√(r²−y²) (distancia al eje de spin en el plano) en vez de sinθ/cosθ;
       en Schwarzschild no hizo falta cambiar nada — `r·cosφ·e1 + r·senφ·e2` ya
       reconstruye el punto 3D exacto para cualquier y. `DISK_HALF_THICKNESS_RATIO
       = 0.15` en `LensedBackground.tsx`, aplicado como fracción de
       `innerRadius` (espesor físico fijo por sesión, no un ángulo) — un valor
       fijo, no expuesto en el sidebar por ahora. Testeado en vitest (ambos
       módulos, casos de espesor 0 y >0) antes de portar a GLSL, mismo patrón de
       siempre. Verificado en el navegador reproduciendo ángulos cercanos a de
       canto (incluyendo el mismo tipo de encuadre del reporte original): borde
       del disco visible como una franja delgada consistente, sin forma de
       reloj de arena/hi-hat a ningún ángulo probado.
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
9. **Modo Visual vs. Riguroso** (idea del usuario, pendiente de implementar).
   Motivación: éste es ante todo un simulador *educativo/visual* — nadie está
   mirando las ecuaciones, están mirando el render — y aun con `KERR_STEPS`
   fijo en un valor alto (ítem 8), el usuario sigue sintiendo que spin/carga
   "no mejoran" tanto como Schwarzschild. Dado que (a) el frame dragging no es
   algo que el usuario vaya a medir a simple vista, sólo notar cualitativamente,
   y (b) el efecto visual de la carga eléctrica es casi imperceptible (y ni
   siquiera está claro que agujeros negros cargados existan en la realidad),
   tiene sentido simplificar la física para el caso común sin tirar el trabajo
   riguroso ya hecho.
   Propuesta (mía, aceptada en principio por el usuario, sin diseñar en
   detalle todavía): agregar un modo "Riguroso" (el integrador Kerr–Newman
   actual, geodésicas exactas vía constante de Carter, intacto tal cual está)
   y un modo "Visual" (nuevo, probablemente default) que:
   - Calcula horizonte/ergosfera/ISCO/esfera de fotones con las fórmulas
     cerradas exactas que ya existen en `physics/metric.ts`/`physics/orbits.ts`
     (instantáneas, no iterativas) — el tamaño de la sombra y del disco siguen
     siendo Kerr–Newman correctos.
   - Traza los rayos con el integrador Schwarzschild-2D ya robusto (el mismo
     que nunca tuvo los problemas de precisión cerca de la esfera de fotones
     que motivaron el ítem 8), sumándole un sesgo simple de frame dragging
     (asimetría prógrado/retrógrado aproximada, sin resolver Carter) en vez de
     integrar la ecuación completa en 4D.
   - Ignora el efecto de la carga sobre la trayectoria del rayo por completo
     en modo Visual (sólo afecta el tamaño del horizonte, vía las fórmulas
     exactas) — coincide con la observación del usuario de que ese efecto es
     casi invisible de todas formas.
   Trade-off explícito: se pierde precisión pixel-perfect muy cerca de la
   esfera de fotones a cambio de robustez total y velocidad — pero nada del
   trabajo riguroso se pierde, queda intacto y seleccionable. PR propia, no
   parte de otro ítem — todavía no se diseñó la fórmula exacta del sesgo de
   frame dragging ni el nombre/UI del selector.

Este roadmap es una guía, no un contrato — el orden puede ajustarse PR a PR según lo que
se aprenda en el camino (igual que en galaxy-simulator).

## Known issues

- **Artefacto residual cerca del eje de spin** (línea punteada / arcos tenues, spin
  alto + cámara en ángulo pronunciado): sobrevivió a cinco rondas de fixes reales
  durante el PR 6 (cada una documentada arriba, en la sección de ese PR) y se aceptó
  como limitación conocida en vez de seguir iterando indefinidamente. Detalle completo,
  hipótesis pendientes y cómo reproducir en
  [issue #7](https://github.com/felipefunes/bh-simulator/issues/7). Probablemente se
  retome junto con el ítem 7 del roadmap (controles de calidad) o con una
  reformulación del integrador de Kerr que evite la coordenada singular del polo
  (sustitución μ=cosθ) en vez de parchar `POLE_GUARD` caso por caso.

## Deploy

Blueprint de Render.com como Static Site: ver `render.yaml` en la raíz. Build command
`npm ci && npm run build`, publish path `./dist`.

## Flujo de trabajo

Se trabaja por PR, una rama por feature (`pr-N-descripcion`). Cada PR debe incluir una
captura de pantalla del estado visual resultante en el body del PR — las imágenes se
suben a la rama huérfana `pr-assets` y se referencian vía
`raw.githubusercontent.com/felipefunes/bh-simulator/pr-assets/<archivo>`, igual que en
galaxy-simulator.
