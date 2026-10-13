"""Fuentes de imagen para el analisis: Mapbox (por defecto, la misma fuente con
la que se entreno el modelo) y PNOA (WMS del IGN, alternativa).

El modelo se entreno con imagenes de Mapbox de 640x640 a zoom 18 (~0.6 m/px) y se
probo tambien a zoom 19 (articulo IEEE Access 2025). Aqui se pide a Mapbox la
imagen que cubre exactamente la celda (bounds) y se devuelve junto con su tamano.
"""

import io
import os

from dotenv import load_dotenv

# Antes de leer las variables de entorno de este modulo (si no, el .env llega tarde).
load_dotenv()

import requests
from PIL import Image

from app.pnoa_client import fetch_tile_image as fetch_pnoa_tile
from app.schemas import Bounds

MAPBOX_ACCESS_TOKEN = os.getenv("MAPBOX_ACCESS_TOKEN", "")
MAPBOX_STYLE = os.getenv("MAPBOX_STYLE", "mapbox/satellite-v9")
# Tamano logico (px) pedido a la Static Images API (max 1280). Con RETINA=true
# se recibe una imagen del doble (1280x1280 para 640), como la imagen de prueba.
MAPBOX_IMAGE_SIZE = int(os.getenv("MAPBOX_IMAGE_SIZE", "640"))
MAPBOX_RETINA = os.getenv("MAPBOX_RETINA", "true").lower() in ("1", "true", "yes")
# Fraccion inferior de la imagen que se recorta para eliminar el logo y la
# atribucion de Mapbox (esquinas inferiores) antes de la inferencia, de modo que
# el modelo no los confunda con un vertedero. Los limites geograficos se ajustan.
MAPBOX_CROP_BOTTOM = float(os.getenv("MAPBOX_CROP_BOTTOM", "0.07"))
PNOA_TILE_SIZE = int(os.getenv("MODEL_TILE_SIZE", "960"))

SOURCES = ("mapbox", "pnoa")
DEFAULT_SOURCE = os.getenv("DEFAULT_IMAGE_SOURCE", "mapbox")


class ImageryError(RuntimeError):
    pass


def fetch_mapbox_tile(bounds: Bounds) -> Image.Image:
    """Static Images API en modo bbox: [oeste,sur,este,norte]/ANCHOxALTO[@2x]."""
    if not MAPBOX_ACCESS_TOKEN:
        raise ImageryError("MAPBOX_ACCESS_TOKEN no esta definido en model-service/.env")

    bbox = f"[{bounds.west},{bounds.south},{bounds.east},{bounds.north}]"
    suffix = "@2x" if MAPBOX_RETINA else ""
    url = (
        f"https://api.mapbox.com/styles/v1/{MAPBOX_STYLE}/static/"
        f"{bbox}/{MAPBOX_IMAGE_SIZE}x{MAPBOX_IMAGE_SIZE}{suffix}"
    )
    # logo/attribution=false: se pide la imagen sin marca; ademas se recorta la
    # franja inferior (trim_watermark) por si Mapbox la superpone igualmente.
    # La atribucion de Mapbox/OSM se mantiene visible en el mapa de la aplicacion.
    response = requests.get(
        url,
        params={"access_token": MAPBOX_ACCESS_TOKEN, "logo": "false", "attribution": "false"},
        timeout=30,
    )
    if response.status_code != 200:
        raise ImageryError(f"Mapbox devolvio {response.status_code}: {response.text[:200]}")
    return Image.open(io.BytesIO(response.content)).convert("RGB")


def fetch_tile(bounds: Bounds, source: str | None) -> Image.Image:
    source = source if source in SOURCES else DEFAULT_SOURCE
    if source == "mapbox":
        return fetch_mapbox_tile(bounds)
    return fetch_pnoa_tile(bounds, width=PNOA_TILE_SIZE, height=PNOA_TILE_SIZE)


def trim_watermark(image: Image.Image, bounds: Bounds, source: str | None) -> tuple[Image.Image, Bounds]:
    """Recorta la franja inferior de las imagenes de Mapbox (logo + atribucion) y
    devuelve la imagen junto con los limites geograficos que realmente cubre."""
    source = source if source in SOURCES else DEFAULT_SOURCE
    if source != "mapbox" or MAPBOX_CROP_BOTTOM <= 0:
        return image, bounds
    crop_px = int(round(image.height * MAPBOX_CROP_BOTTOM))
    if crop_px <= 0 or crop_px >= image.height // 2:
        return image, bounds
    trimmed = image.crop((0, 0, image.width, image.height - crop_px))
    # El recorte es de unos pocos metros: la interpolacion lineal en latitud basta.
    new_south = bounds.south + (bounds.north - bounds.south) * (crop_px / image.height)
    return trimmed, Bounds(north=bounds.north, south=new_south, east=bounds.east, west=bounds.west)
