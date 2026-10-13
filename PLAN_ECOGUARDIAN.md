# EcoGuardian — plan y estado

Proyecto PUMIDISD (NT74, Plan TCUE). Base: CENTINELA. Entorno: red local, sin dominio.
Copia del código original en `.backups/`; lo que dependía de datos abiertos de la Junta está en `_legacy_centinela_jcyl/`.

## Decisiones tomadas

- **Imagen**: Mapbox es la fuente con la que se entrenó el modelo (zoom 18, ~0.6 m/px, imágenes 640x640; test también a zoom 19; artículo IEEE Access 2025). PNOA queda como alternativa seleccionable.
- **Legalidad**: solo la lista de vertederos legales del MITECO ("Vertederos de Residuos", shapefile nacional). Todo lo detectado que no coincida con uno se marca como ilegal probable. Sin capas de la Junta.
- **Usuarios**: una web, 4 roles (admin, monitor, gestor, piloto), JWT.
- **Drones comprados**: DJI Avata 2 (FPV, manual, sin waypoints) y DJI Mini 5 Pro (waypoints en DJI Fly). Sin cámaras espectrales por ahora (todo RGB).
- **Módulo de drones** (como en el artículo, Fig. 18-19): el piloto sube vídeo + registro de vuelo con GPS, se extraen fotogramas, pasan por el modelo y las detecciones se ubican en el mapa.

## Estado

| Fase | Estado |
|---|---|
| 0. Backup, renombrado, retirada de datos de la Junta | Hecho |
| 1. Usuarios y roles (login, usuarios, menú por rol, permisos en API) | Hecho y probado con PostgreSQL real |
| 2. Mapbox (mapa base + imagen del modelo + selector de fuente) | Hecho, **sin probar contra Mapbox** |
| Legalidad MITECO (tabla + script de carga + clasificación legal/ilegal) | Hecho, falta cargarlo con datos reales |
| 3. Monitoreo: revisión manual (pendientes / confirmadas / descartadas, filtros, recorte de cada detección) | Hecho y probado (API); UI compila |
| 4. Gestión de incidencias (al confirmar una detección se crea la incidencia con prioridad por tamaño; estado, responsable, fecha de limpieza, notas, informe por correo a la entidad) | Hecho y probado (API + UI) |
| 4b. Alertas por correo automáticas (destinatarios, registro de envíos; al confirmar y al detectar algo nuevo en un área) | Hecho y probado con SMTP local |
| 4c. Áreas monitorizadas persistentes con reanálisis programado y deduplicación (40 m) | Hecho y probado |
| 4d. Estimación de tamaño (m², clase) en satélite y dron | Hecho (orientativo; dron asume cámara cenital) |
| 4e. Exportar dataset de revisadas (YOLO, ZIP) para reentrenar | Hecho y probado |
| 4f. Rutas de vuelo (barrido por polígono; KMZ DJI, Litchi CSV, GPX, GeoJSON; planes guardados) | Hecho y probado; KMZ sin verificar en DJI Fly |
| 5. Drones: subida de vídeo + registro (SRT/GPX/CSV/JSON), ffmpeg, modelo, fusión de avistamientos, mapa del recorrido coloreado por altitud con reproductor | Hecho y probado con vídeo sintético (modelo simulado) |
| 6. Red local (script de arranque, firewall) | Hecho (`start-lan.ps1`) |
| 7. Documentación (Docusaurus) | Pendiente: aún describe CENTINELA/PNOA |

## Pendiente de confirmar

- Zoom/tamaño exacto de las celdas: la rejilla usa tiles XYZ (zoom 17 por defecto) y pide a Mapbox 640 px (@2x). Hay que calibrarlo comparando con imágenes de entrenamiento (`model-service/scripts/check_mapbox_tile.py`).
- La capa del MITECO es de 2018: los vertederos autorizados después saldrán como ilegales. Revisar si hay una fuente más reciente.
- Términos de uso de Mapbox para análisis automático de teselas.
- Rutas de vuelo: el Avata 2 se pilota a mano (no admite waypoints); su ruta solo sirve de guía (GPX/GeoJSON). Hiperespectral y tiempo real quedan fuera de alcance.
- Misiones KMZ/WPML en el Mini 5 Pro: DJI Fly permite waypoints, pero no está confirmado que importe KMZ externo.
- Dominio distinto: el modelo se entrenó con imagen satélite cenital; el vídeo de dron (sobre todo el Avata 2, FPV) puede dar peores resultados. Recomendado: ~100-120 m de altura, cámara hacia abajo. Validar con vuelos reales y, si hace falta, reentrenar con las detecciones confirmadas.
- La posición de una detección de dron es la del dron en ese fotograma (aproximada); no se proyecta la imagen al suelo.
- Roles: monitor/admin revisan, gestionan áreas y exportan el dataset; gestor/admin gestionan incidencias y alertas; piloto/admin planifican rutas; piloto sube y borra sus vuelos.
