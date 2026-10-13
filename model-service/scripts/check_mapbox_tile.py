"""Descarga la imagen de Mapbox de una celda y la guarda en disco para compararla
con tus imagenes de entrenamiento/prueba.

    python scripts/check_mapbox_tile.py 40.4168 -3.7038 17 salida.jpg

Argumentos: latitud longitud zoom_xyz fichero. La celda es el tile XYZ de ese
zoom que contiene el punto (igual que la rejilla del frontend)."""

import math
import sys

from dotenv import load_dotenv

load_dotenv()

from app.imagery import fetch_mapbox_tile  # noqa: E402
from app.schemas import Bounds  # noqa: E402


def tile_bounds(lat, lon, zoom):
    n = 2**zoom
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)

    def lon_of(xx):
        return xx / n * 360 - 180

    def lat_of(yy):
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy / n))))

    return Bounds(north=lat_of(y), south=lat_of(y + 1), west=lon_of(x), east=lon_of(x + 1))


if __name__ == "__main__":
    lat, lon, zoom, out = float(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
    bounds = tile_bounds(lat, lon, zoom)
    image = fetch_mapbox_tile(bounds)
    image.save(out, quality=92)
    print(f"Guardada {out} ({image.width}x{image.height}) bounds={bounds}")
