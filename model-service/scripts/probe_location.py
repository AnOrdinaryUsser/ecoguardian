"""Diagnostico: prueba el modelo en un punto con varios niveles de zoom.

    python scripts/probe_location.py 41.6990 -4.8310
    python scripts/probe_location.py 41.6990 -4.8310 15 16 17 18 19

Para cada zoom descarga la celda XYZ que contiene el punto (como la rejilla de la web),
ejecuta el modelo con umbral bajo (0.05) y guarda la imagen anotada en tiles_output/.
Sirve para ver a que zoom detecta mejor un vertedero conocido (el modelo se entreno con
imagenes de Mapbox 640x640) y que confianzas reales saca."""

import math
import sys
from pathlib import Path

# Permite ejecutarlo como `python scripts/probe_location.py` desde model-service.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv

load_dotenv()

from PIL import ImageDraw  # noqa: E402

from app.imagery import fetch_mapbox_tile  # noqa: E402
from app.model import detector, MODEL_INFERENCE_SIZE  # noqa: E402
from check_mapbox_tile import tile_bounds  # noqa: E402


def main():
    lat, lon = float(sys.argv[1]), float(sys.argv[2])
    zooms = [int(z) for z in sys.argv[3:]] or [16, 17, 18, 19]
    out_dir = Path("tiles_output")
    out_dir.mkdir(exist_ok=True)
    print(f"Punto {lat}, {lon}\n")
    for zoom in zooms:
        bounds = tile_bounds(lat, lon, zoom)
        side_m = (bounds.east - bounds.west) * 111320 * math.cos(math.radians(lat))
        image = fetch_mapbox_tile(bounds)
        with detector._lock:
            result = detector.model.predict(image, conf=0.05, imgsz=MODEL_INFERENCE_SIZE, verbose=False)[0]
        boxes = sorted(((float(b.conf[0]), tuple(b.xyxy[0].tolist())) for b in result.boxes), reverse=True)
        draw = ImageDraw.Draw(image)
        for conf, (x1, y1, x2, y2) in boxes:
            draw.rectangle([x1, y1, x2, y2], outline="#f9b115", width=4)
            draw.text((x1 + 4, y1 + 4), f"{conf:.2f}", fill="#f9b115")
        path = out_dir / f"probe_z{zoom}.jpg"
        image.save(path, quality=90)
        top = ", ".join(f"{c:.2f}" for c, _ in boxes[:5]) or "ninguna"
        print(f"zoom {zoom}: celda ~{side_m:.0f} m, imagen {image.width}px | cajas: {len(boxes)} | mejores confianzas: {top} -> {path}")


if __name__ == "__main__":
    main()
