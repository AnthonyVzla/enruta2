# EnRuta2

PWA de movilidad preparada para GitHub Pages y APK Android. Incluye acceso con Supabase para clientes, conductores, soporte y administración; cálculo de rutas con Mapbox; perfiles de conductores de carro o moto; modalidades Express y Económica; y presencia de conductores con GPS mientras estén conectados.

## Desarrollo

Requiere Node.js 20 o superior.

```sh
npm ci
npm run dev
npm test
```

## Supabase

Ejecuta [`supabase/schema.sql`](./supabase/schema.sql) en el SQL Editor del proyecto. Crea los roles `client`, `driver`, `support` y `admin`, los perfiles asociados al alta de Auth y las categorías de conductor `carro` y `moto`. En el alta pública solo se puede escoger cliente o conductor; soporte y administración se asignan manualmente desde SQL, por ejemplo:

```sql
update public.profiles
set role = 'admin', vehicle_category = null
where id = (select id from auth.users where email = 'correo@ejemplo.com');
```

La app usa la URL y la clave publishable del proyecto. La clave publishable es pública; RLS limita la lectura del perfil a su propietario y evita que una cuenta cambie su rol. Configura en Supabase las URL de redirección de tu sitio de GitHub Pages para la confirmación de correo. El esquema SQL instala funciones seguras para buscar conductores elegibles, asignar solicitudes y avanzar los estados de viaje.

## Mapbox y tarifas

La app obtiene sugerencias de direcciones, rutas por carretera y ETA de conductores con Mapbox. Crea un token público `pk.` restringido al dominio de GitHub Pages y a la app:

- Para desarrollo local, copia `.env.example` a `.env.local` y define `VITE_MAPBOX_ACCESS_TOKEN`.
- En GitHub, agrega el secreto `MAPBOX_ACCESS_TOKEN` al repositorio para compilar Pages y Android.

El token se incluye en el JavaScript de la PWA y en el APK, por lo que no es secreto en tiempo de ejecución. Nunca uses un token secreto `sk.` en el cliente. Si ya compartiste uno, revócalo y crea uno público restringido.

Las tarifas se calculan sobre la distancia en kilómetros por carretera entre A y B:

| Modalidad | Carro | Moto |
| --- | ---: | ---: |
| Express | $0.90/km | $0.40/km |
| Económica | $0.80/km | $0.35/km |

Express requiere un conductor conectado en estado disponible. Económica solo se habilita cuando hay un conductor conectado que está terminando un servicio y ha seleccionado su destino. Su ETA suma las rutas por carretera desde el GPS del conductor hasta ese destino y desde allí hasta el cliente. La ubicación se comparte mientras el conductor está conectado y la app está abierta; si no se actualiza durante 45 segundos, deja de ofrecerse.

## Publicación y APK

- Al hacer push a `main`, `pages.yml` construye la app para GitHub Pages. En la configuración del repositorio, selecciona **Settings → Pages → GitHub Actions**.
- `.github/workflows/android-apk.yml` genera un APK de depuración y lo publica como artefacto de la ejecución. También se puede iniciar desde **Actions → Build EnRuta2 Android APK → Run workflow**.
- El APK es de prueba; para distribuirlo por Google Play se debe configurar firma y credenciales de release.
