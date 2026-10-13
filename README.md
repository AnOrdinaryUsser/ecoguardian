# EcoGuardian

[![Licencia: CC BY-NC-SA 4.0](https://img.shields.io/badge/Licencia-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.es)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/python-3.11-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=black)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white)
![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-00FFFF?logo=yolo&logoColor=black)
![PostGIS](https://img.shields.io/badge/PostgreSQL%2FPostGIS-16-336791?logo=postgresql&logoColor=white)
![Mapbox](https://img.shields.io/badge/Mapbox-satélite-000000?logo=mapbox&logoColor=white)
![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)
![Caddy](https://img.shields.io/badge/Caddy-HTTPS%20autom%C3%A1tico-1F88C0?logo=caddy&logoColor=white)
![Drones](https://img.shields.io/badge/DJI-Avata%202%20%7C%20Mini%205%20Pro-black)
![Estado](https://img.shields.io/badge/estado-en%20desarrollo-yellow)

> **Origen del proyecto.** EcoGuardian nace de [**Centinela**](https://github.com/AnOrdinaryUsser/centinela), la plataforma que detecta vertederos ilegales sobre imagen de satélite. Parte de esa base y la lleva al ámbito de los **drones**: planificación de rutas de vuelo, análisis del vídeo del vuelo y gestión de las incidencias detectadas, para toda España.

Proyecto PUMIDISD / NT74 (Plan TCUE) · Esalab · Universidad de Salamanca.

## Índice

- [¿Qué es EcoGuardian?](#qué-es-ecoguardian)
- [Cómo se ha construido](#cómo-se-ha-construido)
- [Arquitectura](#arquitectura)
- [Roles y permisos](#roles-y-permisos)
- [Puesta en marcha rápida (desarrollo local)](#puesta-en-marcha-rápida-desarrollo-local)
- [Funcionalidades en detalle](#funcionalidades-en-detalle)
- [Correo y acceso con Google/Apple](#correo-y-acceso-con-googleapple)
- [Despliegue en producción](#despliegue-en-producción)
- [Seguridad y acceso en red](#seguridad-y-acceso-en-red)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Licencia](#licencia)

## ¿Qué es EcoGuardian?

EcoGuardian es una plataforma web para **detectar y monitorizar vertederos ilegales** combinando inteligencia artificial, imagen de satélite y drones. Un técnico dibuja una zona sobre el mapa; el modelo la analiza y propone posibles vertederos; una persona los revisa; los confirmados se convierten en **incidencias** que se asignan, se notifican a la entidad responsable y se siguen hasta su limpieza. Para volver a mirar lo que cambia, las zonas se pueden dejar como **áreas monitorizadas** que se reanalizan solas, y para verlo de cerca, el piloto **planifica el vuelo** y sube después el vídeo para analizarlo.

Qué se puede hacer:

- **Análisis de satélite:** dibuja una zona y el modelo (YOLOv8s) detecta posibles vertederos sobre imagen de Mapbox. La legalidad se juzga contra el listado de vertederos del MITECO.
- **Drones:** sube el vídeo y el registro de vuelo (SRT, GPX, CSV o JSON); se extraen fotogramas, se analizan y las detecciones se ubican en el mapa.
- **Revisión:** confirma o descarta detecciones, con estimación de tamaño (m²) y exportación del dataset revisado en formato YOLO para reentrenar el modelo.
- **Incidencias:** prioridad por tamaño, responsable, fecha de limpieza, notas, historial e informe por correo a la entidad.
- **Alertas por correo** automáticas al confirmar un vertedero y cuando un área vigilada detecta algo nuevo.
- **Áreas monitorizadas** que se reanalizan cada N días sin duplicar detecciones.
- **Rutas de vuelo:** barrido sobre un polígono según dron, altura y solape, exportable a KMZ (DJI), CSV de Litchi, GPX y GeoJSON.
- **Cuatro roles** con inicio de sesión (JWT) y una interfaz en español e inglés (gallego, catalán y euskera, parcial).

## Cómo se ha construido

### El modelo de detección

El detector es un **YOLOv8s** (Ultralytics) que se sirve desde un microservicio FastAPI. Recibe una zona, descarga la imagen de satélite de Mapbox, la analiza por teselas y devuelve las cajas detectadas con su confianza, el recorte de cada una y los límites exactos de la imagen analizada, que permiten calcular el tamaño real en metros cuadrados.

### La plataforma alrededor del modelo

Un modelo solo no basta: hace falta un flujo de trabajo humano alrededor. El backend (Node/Express sobre PostgreSQL con PostGIS) guarda las detecciones, las compara con el listado legal del MITECO para marcarlas como legales o probablemente ilegales, y gobierna el ciclo de revisión, incidencias, alertas y áreas. La interfaz (React) cubre cada paso según el rol de quien la usa.

### Decisiones de diseño

- **Solo imagen de Mapbox** para el análisis de satélite.
- **Legalidad según el MITECO:** una detección cerca de un vertedero autorizado se marca como legal.
- **Una sola aplicación con cuatro roles** (`admin`, `monitor`, `gestor`, `piloto`) en vez de varias apps.
- **Un humano valida siempre:** ninguna detección se convierte en incidencia sin que alguien la confirme.
- **Sin duplicados:** las detecciones a menos de 40 m se fusionan, y en los vuelos los avistamientos cercanos del mismo vuelo cuentan como uno.
- **Tamaños orientativos:** en satélite, a partir de la caja sobre los límites analizados; en dron, a partir de la altura y el campo de visión de la cámara, suponiendo cámara cenital.
- **Dron solo RGB** por ahora (DJI Avata 2 y Mini 5 Pro).

## Arquitectura

| Carpeta | Tecnología | Responsabilidad |
|---|---|---|
| `frontend/` | React 18 · Vite · CoreUI · react-leaflet | Interfaz web, mapas, flujo por rol |
| `backend/` | Node · Express 4 · PostgreSQL/PostGIS · nodemailer | API REST, autenticación, incidencias, alertas, áreas, vuelos |
| `model-service/` | FastAPI · Ultralytics (YOLOv8s) | Descarga de imagen y detección |
| `database/` | SQL (PostGIS) | Esquema de la base de datos |
| `etl/` | Python | Scripts de carga de datos abiertos |
| `Caddyfile` · `docker-compose.prod.yml` · `deploy.sh` | Caddy · Docker Compose | Despliegue con HTTPS automático |

La documentación interactiva de la API (Swagger) está en `/api-docs` del backend.

## Roles y permisos

| Rol | Qué hace |
|---|---|
| `admin` | Todo, incluida la gestión de usuarios |
| `monitor` | Analiza zonas, revisa detecciones, gestiona áreas monitorizadas y exporta el dataset |
| `gestor` | Gestiona incidencias y elige quién recibe las alertas por correo |
| `piloto` | Planifica rutas de vuelo y sube vídeos y registros de vuelo |

Todos pueden consultar el mapa, las detecciones, las incidencias, las áreas y las estadísticas. Los permisos se comprueban en el servidor.

## Puesta en marcha rápida (desarrollo local)

**Requisitos:** Docker Desktop, Node 20 o superior, Python 3.11 (para `model-service`), un token de Mapbox y los pesos del modelo (`best.pt`).

1. Copia los ficheros de ejemplo: `cp .env.example .env` y los `.env.example` de `backend/`, `model-service/` y `frontend/` a su `.env`.
   - `model-service/.env`: `MAPBOX_ACCESS_TOKEN`
   - `frontend/.env`: `VITE_MAPBOX_TOKEN` (token público `pk.`)
   - `backend/.env`: `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
2. Copia el modelo a `model-service/weights/best.pt`.
3. Crea el entorno virtual de `model-service` (Python 3.11, ver su [README](model-service/README.md)).
4. En PowerShell: `.\start-lan.ps1 -OpenFirewall` (como Administrador la primera vez). Arranca la base de datos, el modelo, el backend y el frontend.
5. Carga los vertederos legales del MITECO: `cd etl; pip install -r requirements.txt; python scripts/load_legal_landfills.py`
6. Abre `http://localhost:5173` e inicia sesión con el administrador (si no pusiste contraseña, aparece en la consola del backend al primer arranque).

Los demás equipos de la red entran con `http://<IP-de-tu-PC>:5173`, y todas las rutas (`/incidencias`, `/areas`, `/rutas`…) funcionan al abrirlas directamente.

### Probar solo la base de datos

```powershell
docker compose up -d postgis          # la primera vez aplica database/schema/*.sql
docker compose exec postgis psql -U ecoguardian -d ecoguardian -c "\dt"
```

Para empezar de cero (borra los datos): `docker compose down -v` y de nuevo `up -d postgis`. El backend (`cd backend; npm install; npm run dev`) crea el usuario administrador al arrancar y actualiza el esquema solo.

## Funcionalidades en detalle

### Drones

Con el rol `piloto`, en **Drones** se sube el vídeo y el registro de vuelo (`.SRT` de DJI con "Video Caption" activado en DJI Fly, o GPX, CSV o JSON). Se extrae un fotograma cada N segundos con ffmpeg (incluido mediante `ffmpeg-static`, o `FFMPEG_PATH`), pasan por el modelo y las detecciones aparecen en **Revisión**. El detalle del vuelo muestra el recorrido sobre el mapa, coloreado por altura.

### Incidencias, alertas, áreas y rutas

- **Incidencias** (gestionan `gestor` y `admin`): confirmar una detección en Revisión crea una incidencia con prioridad según el tamaño (≥ 1000 m² alta, < 100 m² baja). Estado, responsable, fecha de limpieza, notas e informe por correo a la entidad.
- **Alertas** (`gestor`/`admin`): destinatarios de los avisos por correo y registro de envíos. Requiere SMTP configurado.
- **Áreas** (`monitor`/`admin`): polígonos que se reanalizan cada N días; no duplican detecciones a menos de 40 m y solo avisan de las nuevas no legales.
- **Dataset** (`monitor`/`admin`): en Revisión, descarga en formato YOLO (ZIP) con las confirmadas como positivas y las descartadas como negativas.
- **Rutas de vuelo** (`piloto`/`admin`): barrido sobre un polígono según dron, altura y solape. Exporta KMZ (DJI), CSV de Litchi, GPX y GeoJSON.

Las variables opcionales (planificador de áreas, distancia de duplicados, límites del dataset…) están en [`backend/.env.example`](backend/.env.example).

## Correo y acceso con Google/Apple

Todo se configura en `backend/.env` (ver `backend/.env.example`).

- **Correo (SMTP):** `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` y `APP_URL` (la dirección con la que los usuarios abren la web; se usa en los enlaces). Sin `SMTP_HOST` no se envía nada y el texto del correo aparece en la consola del backend.
  - Al crear un usuario se le envía su correo de acceso y su contraseña inicial (se puede desmarcar en el formulario).
  - «He olvidado mi contraseña» envía un enlace de un solo uso válido 60 minutos.
- **Google:** crea un ID de cliente OAuth «Aplicación web» en Google Cloud Console, añade el origen de la web y pon `GOOGLE_CLIENT_ID`. Google solo admite `localhost` o dominios, no IP.
- **Apple:** requiere cuenta Apple Developer, un Services ID y una URL de retorno HTTPS con dominio (`APPLE_CLIENT_ID`, `APPLE_REDIRECT_URI`).
- El acceso con Google/Apple solo admite correos de usuarios ya creados por un administrador.

## Despliegue en producción

Todo el stack (PostGIS, backend, model-service y frontend con Caddy) se levanta con Docker Compose en un servidor Ubuntu:

```bash
cp .env.docker.example .env      # y edita POSTGRES_PASSWORD, tokens de Mapbox, SMTP...
sudo ./deploy.sh
```

La misma aplicación responde por dominio y por IP:

| Entrada | Resultado |
|---|---|
| `https://ecoguardian.es/incidencias` | HTTPS con certificado Let's Encrypt, emitido y renovado solo por Caddy |
| `http://ecoguardian.es/incidencias` | Redirige a HTTPS |
| `http://<IP-del-servidor>/incidencias` | HTTP plano (una IP no puede tener certificado) |

Hace falta que el registro A del dominio apunte al servidor y que los puertos 80 y 443 estén abiertos. Guía completa en [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Seguridad y acceso en red

- Inicio de sesión con JWT y permisos por rol comprobados en el servidor en cada endpoint.
- Contraseñas con hash, límite de intentos de acceso por IP y límite de tamaño en las subidas.
- Las consultas a la base de datos usan parámetros, sin interpolar valores del usuario.
- En producción, solo Caddy (80/443) está expuesto: la base de datos y el servicio del modelo son accesibles únicamente desde la red interna de Docker.
- Los `.env`, los pesos del modelo y los datos de `etl/data` no están en el repositorio.
- Antes de abrirlo a Internet: define un `JWT_SECRET` largo (lo genera `deploy.sh`), cambia `POSTGRES_PASSWORD` y valora restringir la documentación `/api-docs`.

## Estructura del repositorio

```text
ecoguardian/
├── backend/                 API REST (Node/Express)
│   └── src/                 controllers · routes · services · middleware
├── frontend/                Interfaz web (React + Vite)
│   └── src/                 pages · components · services · i18n
├── model-service/           Servicio de detección (FastAPI + YOLOv8)
├── database/schema/         Esquema SQL de PostGIS
├── etl/                     Carga de datos abiertos
├── deploy/                  Servicios systemd (instalación sin Docker)
├── docs/                    Documentación (Docusaurus)
├── Caddyfile                Servidor web y proxy (HTTPS automático)
├── docker-compose.yml       Solo la base de datos (desarrollo)
├── docker-compose.prod.yml  Stack completo de producción
├── deploy.sh                Despliegue en un servidor Ubuntu
├── start-lan.ps1            Arranque local accesible desde la red
├── DEPLOYMENT.md            Guía de despliegue
└── PLAN_ECOGUARDIAN.md      Estado y plan del proyecto
```

## Limitaciones conocidas

- La importación del KMZ en DJI Fly no está confirmada. El Avata 2 se pilota a mano, así que su ruta sirve solo de guía (GPX/GeoJSON).
- El tamaño de los vertederos en dron es una estimación que supone cámara cenital.
- La capa de vertederos del MITECO es de 2018: los autorizados después aparecen como ilegales y requieren revisión.
- Las detecciones de dron se ubican en la posición del dron en ese fotograma, no se proyectan al suelo.
- Sin cámaras hiperespectrales ni integración en tiempo real con el dron.
- Las pantallas nuevas están traducidas al español y al inglés; gallego, catalán y euskera caen al español.

## Licencia

Este proyecto se publica bajo la licencia [Creative Commons Atribución-NoComercial-CompartirIgual 4.0 Internacional (CC BY-NC-SA 4.0)](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.es). Ver [`LICENSE`](LICENSE).

Parte de la base de [Centinela](https://github.com/AnOrdinaryUsser/centinela).
