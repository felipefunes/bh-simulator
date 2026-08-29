# Black Hole Simulator

Simulador interactivo de agujeros negros: un canvas 3D con un agujero negro
(Schwarzschild o Kerr) parametrizado por masa, spin y carga eléctrica, su disco
de acreción, y lente gravitacional sobre una imagen de fondo (una galaxia)
para visualizar la deformación de la luz.

## Desarrollo

```bash
npm install
npm run dev
```

## Scripts

- `npm run dev` — servidor de desarrollo
- `npm run build` — build de producción a `dist/`
- `npm run test` — suite de vitest
- `npm run lint` — eslint

## Deploy

Este repo se despliega en [Render](https://render.com) como Static Site vía blueprint
(`render.yaml`).

Ver [`CLAUDE.md`](./CLAUDE.md) para el detalle de arquitectura, el modelo físico usado y
el roadmap de PRs.

## Licencia

Open source bajo licencia [MIT](./LICENSE). Contribuciones bienvenidas.
