# EcoGuardian

Detección y monitorización de **vertederos ilegales** con IA (YOLOv8), imágenes de satélite (Mapbox) y **drones**.

> **Origen del proyecto.** EcoGuardian nace de [**Centinela**](https://github.com/AnOrdinaryUsser/centinela), la plataforma que detecta vertederos ilegales sobre imagen de satélite. EcoGuardian parte de esa base y la lleva al ámbito de los **drones**: vuelos con DJI Avata 2 y Mini 5 Pro, planificación de rutas, análisis del vídeo del vuelo y gestión de las incidencias detectadas, para toda España.

Proyecto PUMIDISD / NT74 (Plan TCUE) · Esalab · Universidad de Salamanca.

## Qué hace

- **Análisis de satélite:** dibuja una zona en el mapa y el modelo (YOLOv8s) detecta posibles vertederos sobre imagen de Mapbox. La legalidad se juzga contra el listado de vertederos del MITECO.
- **Drones:** el piloto sube el vídeo y el registro de vuelo (SRT/GPX/CSV/JSON); se extraen fotogramas, se analizan y las detecciones se ubican en el mapa.
- **Revisión:** confirmar o descartar detecciones; estimación del tamaño (m²) y exportación del dataset revisado en formato YOLO para reentrenar.
- **Incidencias:** cada vertedero confirmado se convierte en una incidencia con prioridad por tamaño, responsable, fecha de limpieza, notas e informe por correo a la entidad.
- **Alertas por correo** automáticas al confirmar y cuando un área vigilada detecta algo nuevo.
- **Áreas monitorizadas** que se reanalizan solas cada N días sin duplicar detecciones.
- **Rutas de vuelo:** barrido sobre un polígono según dron, altura y solape; exporta KMZ (DJI), CSV de Litchi, GPX y GeoJSON.
- **Cuatro roles** con login (JWT): `admin`, `monitor`, `gestor`, `piloto`. Interfaz en español e inglés (gallego, catalán y euskera parciales).

## Arquitectura

| Parte | Tecnología |
|---|---|
| `frontend/` | React 18 + Vite + CoreUI + react-leaflet |
| `backend/` | Node 22 · Express 4 · PostgreSQL/PostGIS · nodemailer |
| `model-service/` | FastAPI + Ultralytics (YOLOv8s) |
| `database/` | Esquema SQL (PostGIS) |
| `etl/` | Scripts de carga de datos abiertos |
| `Caddyfile`, `docker-compose.prod.yml`, `deploy.sh` | Despliegue en producción con HTTPS automático |

Los pesos del modelo (`best.pt`), los `.env` y los datos de `etl/data` **no** están en el repositorio.

## Despliegue

Ver [`DEPLOYMENT.md`](DEPLOYMENT.md). En producción se sirve por dominio (HTTPS) y por IP (HTTP) con las mismas rutas.

## Licencia

CC BY-NC-SA 4.0, ver [`LICENSE`](LICENSE).

## Arranque en tu PC (accesible desde la red local)

1. `cp .env.example .env` y los `.env.example` de `backend/`, `model-service/` y `frontend/` a su `.env`.
   - `model-service/.env`: `MAPBOX_ACCESS_TOKEN`
   - `frontend/.env`: `VITE_MAPBOX_TOKEN` (token público `pk.`)
   - `backend/.env`: `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
2. Copia el modelo a `model-service/weights/best.pt`.
3. Crea el venv de `model-service` (Python 3.11, ver su README).
4. PowerShell: `.\start-lan.ps1 -OpenFirewall` (como Administrador la primera vez).
5. Carga los vertederos legales del MITECO: `cd etl; pip install -r requirements.txt; python scripts/load_legal_landfills.py`
6. Abre `http://localhost:5173` e inicia sesión con el admin (si no pusiste contraseña, sale en la consola del backend al primer arranque).

Los demás equipos entran con `http://<IP-de-tu-PC>:5173`.

## Probar la base de datos

```powershell
docker compose up -d postgis          # la primera vez aplica database/schema/*.sql
docker compose exec postgis psql -U ecoguardian -d ecoguardian -c "\dt"
```

Para reiniciar desde cero (borra los datos): `docker compose down -v` y de nuevo `up -d postgis`.
El backend (`cd backend; npm install; npm run dev`) crea el usuario admin al arrancar.

## Drones

Rol `piloto` en **Drones**: sube el vídeo y el registro de vuelo (`.SRT` de DJI con "Video Caption" activado en DJI Fly, o GPX/CSV/JSON).
Se extrae un fotograma cada N segundos con ffmpeg (incluido vía `ffmpeg-static`, o `FFMPEG_PATH`), pasan por el modelo y las detecciones
aparecen en **Revisión**. El detalle del vuelo muestra el recorrido sobre el mapa.

## Incidencias, alertas, áreas y rutas

Al actualizar, reinicia el backend (el esquema se actualiza solo al arrancar) y el servicio del modelo (ahora devuelve `analyzed_bounds`).

- **Incidencias** (`gestor`/`admin` gestionan): confirmar una detección en Revisión crea una incidencia con prioridad según el tamaño (≥1000 m² alta, <100 m² baja). Estado, responsable, fecha de limpieza, notas e informe por correo a la entidad.
- **Alertas** (`gestor`/`admin`): destinatarios de los avisos por correo y registro de envíos. Requiere SMTP configurado.
- **Áreas** (`monitor`/`admin`): polígonos que se reanalizan cada N días; no duplican detecciones a menos de 40 m y solo avisan de las nuevas no legales.
- **Dataset** (`monitor`/`admin`): en Revisión, descarga en formato YOLO (ZIP) de confirmadas (positivas) y descartadas (negativas).
- **Rutas de vuelo** (`piloto`/`admin`): barrido sobre un polígono según dron, altura y solape; exporta KMZ (DJI), CSV de Litchi, GPX y GeoJSON. La importación del KMZ en DJI Fly no está confirmada; el Avata 2 se vuela a mano.
- Variables opcionales en `backend/.env`: ver `.env.example`.

## Correo y acceso con Google/Apple

Todo se configura en `backend/.env` (ver `backend/.env.example`). Tras actualizar, ejecuta `npm install` en `backend` (nuevo paquete `nodemailer`) y reinicia el backend.

- **Correo (SMTP)**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` y `APP_URL` (la dirección con la que los usuarios abren la web, p. ej. `http://192.168.1.50:5173`; se usa en los enlaces). Sin `SMTP_HOST` no se envía nada y el texto del correo aparece en la consola del backend.
  - Al crear un usuario se le envía su correo de acceso y su contraseña inicial (se puede desmarcar en el formulario).
  - «He olvidado mi contraseña» envía un enlace de un solo uso válido 60 minutos (`/restablecer?token=...`).
- **Google**: crea un ID de cliente OAuth «Aplicación web» en Google Cloud Console, añade el origen de la web en «Orígenes autorizados de JavaScript» y pon `GOOGLE_CLIENT_ID`. Google solo admite `localhost` o dominios (no IP): en red local por IP no funcionará.
- **Apple**: requiere cuenta Apple Developer, un Services ID y una URL de retorno HTTPS con dominio (`APPLE_CLIENT_ID`, `APPLE_REDIRECT_URI`). No funciona por IP local.
- El acceso con Google/Apple solo admite correos de usuarios ya creados por un administrador.
