# EnRuta

PWA inicial para solicitar viajes, preparada para publicarse en GitHub Pages y compilar un APK de Android con GitHub Actions.

Esta primera versión es un prototipo: el mapa es ilustrativo, las tarifas son de ejemplo y todavía no incluye geocodificación, asignación de conductores ni seguimiento en tiempo real.

## Desarrollo

Requiere Node.js 20 o superior.

```sh
npm ci
npm run dev
```

## Supabase

En el SQL Editor del proyecto Supabase, ejecuta [`supabase/schema.sql`](./supabase/schema.sql) para crear la tabla de solicitudes y sus políticas de inserción. La URL y la clave publishable del proyecto están configuradas en la app; la clave publishable es pública y no sustituye políticas RLS.

## Publicación y APK

- Al hacer push a `main`, `pages.yml` construye la app para GitHub Pages. En la configuración del repositorio, selecciona **Settings → Pages → GitHub Actions**.
- `android.yml` genera un APK de depuración y lo publica como artefacto de la ejecución. También se puede iniciar manualmente desde **Actions → Build Android APK → Run workflow**.
- El APK generado es de prueba; para distribuirlo por Google Play se debe configurar firma y credenciales de release.
