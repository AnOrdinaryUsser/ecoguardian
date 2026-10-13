"""Wrapper around the trained illegal-dumpsite detection model.

The real model is a YOLOv8s (Ultralytics) detector, trained for 200 epochs
at 640x640 with a single class: 'dump_site'. This is the only file that
should know about the Ultralytics/PyTorch API; everything else in the
service talks to VertederoDetector, not to the framework directly.
"""

import base64
import io
import os
import threading
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# Antes de leer las variables de entorno de este modulo (si no, el .env llega tarde).
load_dotenv()

from PIL import Image, ImageDraw, ImageFont

from app.imagery import fetch_tile, trim_watermark
from app.pnoa_client import pixel_to_lonlat
from app.schemas import Bounds, Detection

MODEL_WEIGHTS_PATH = os.getenv("MODEL_WEIGHTS_PATH", "./weights/best.pt")

# TILE_SIZE is how many pixels we ASK the PNOA WMS server for (both sides,
# square). PNOA "Maxima Actualidad" itself is natively ~0.25-0.50 m/pixel
# (confirmed against IGN's WMS capabilities); requesting more pixels than
# that native resolution can fill for a given ground footprint doesn't
# invent real detail, WMS just has to interpolate/upsample to satisfy the
# request - which is exactly what a too-blurry tile looks like. Bumped
# from 640 to 960 (still square) so tiles at low/mid analysis zooms (where
# 640px was leaving real PNOA detail on the table) come back sharper; see
# frontend/src/pages/MapPage.jsx for the matching MAX_TILE_ZOOM cap that
# keeps the grid from being drawn so fine it asks for MORE detail than
# PNOA actually has (which 960px alone can't fix - see MODEL_INFERENCE_SIZE
# below for why the model itself still runs at its original 640).
TILE_SIZE = int(os.getenv("MODEL_TILE_SIZE", "960"))

# The model was TRAINED at 640x640 (see module docstring). Feeding it a
# differently-scaled input than training used is its own kind of domain
# shift (object apparent size changes), so inference always runs at this
# fixed size regardless of TILE_SIZE - Ultralytics resizes the (now
# sharper, higher-res-fetched) image down to this for the forward pass and
# automatically rescales the resulting boxes back to the ORIGINAL image's
# pixel space, so detections/coordinates stay correct either way.
MODEL_INFERENCE_SIZE = 640

# Umbral minimo con el que se ejecuta el modelo (solo para diagnostico en el log).
RAW_MIN_CONFIDENCE = 0.05

# Cada celda analizada se guarda en disco (imagen original y anotada con TODAS las cajas
# que vio el modelo, con su confianza) para poder revisarlas a mano.
SAVE_TILES = os.getenv("SAVE_TILES", "true").lower() not in ("0", "false", "no")
TILES_OUTPUT_DIR = Path(os.getenv("TILES_OUTPUT_DIR", "./tiles_output"))


class VertederoDetector:
    def __init__(self, weights_path: str = MODEL_WEIGHTS_PATH):
        self.weights_path = weights_path
        self.model = None
        self.class_names: dict[int, str] = {}
        self._load_model(weights_path)

    def _load_model(self, weights_path: str) -> None:
        # There is no simulated/placeholder mode any more: this service is
        # useless without the real trained weights, so it refuses to start
        # rather than silently serving made-up detections that could be
        # mistaken for real ones. Copy best.pt into model-service/weights/
        # (or point MODEL_WEIGHTS_PATH at it) before starting this service.
        if not os.path.exists(weights_path):
            raise RuntimeError(
                f"[model-service] Weights file not found at '{weights_path}'. "
                "This service requires the real trained model to run - there is "
                "no demo/placeholder mode. Copy best.pt into model-service/weights/ "
                "(or set MODEL_WEIGHTS_PATH) and restart."
            )

        # Imported lazily: ultralytics (and the torch it pulls in) is a heavy
        # dependency, only needed once we actually have weights to load.
        from ultralytics import YOLO

        self.model = YOLO(weights_path)
        self.class_names = self.model.names  # e.g. {0: 'dump_site'}
        print(f"[model-service] Loaded '{weights_path}'. Classes: {self.class_names}")

        # El predictor de Ultralytics se crea (y el modelo se "fusiona") en la primera
        # inferencia y no es seguro para varios hilos: dos peticiones simultaneas
        # tras el arranque rompian con "'Conv' object has no attribute 'bn'".
        # Por eso se hace una inferencia de calentamiento aqui y las siguientes se
        # serializan con un cerrojo.
        self._lock = threading.Lock()
        with self._lock:
            self.model.predict(Image.new("RGB", (MODEL_INFERENCE_SIZE, MODEL_INFERENCE_SIZE)), imgsz=MODEL_INFERENCE_SIZE, verbose=False)
        print("[model-service] Modelo calentado y listo.")

    @property
    def model_version(self) -> str:
        return os.path.basename(self.weights_path)

    def predict(
        self, bounds: Bounds, confidence_threshold: float, image_source: str | None = None
    ) -> tuple[list[Detection], str, str, Bounds]:
        """Runs the real model over the tile covering `bounds`.

        Returns (detections, image_base64): the JPEG tile that was analyzed
        (with detection boxes drawn on it, if any), base64-encoded so the
        frontend can show exactly what the model looked at.
        """
        try:
            image = fetch_tile(bounds, image_source)
            image, bounds = trim_watermark(image, bounds, image_source)
        except Exception as error:  # noqa: BLE001 - degrade gracefully, imagery is best-effort
            print(f"[model-service] WARNING: could not fetch imagery ({error}). Continuing without image.")
            image = None

        detections, boxes_xyxy, raw_boxes = self._predict_real(image, bounds, confidence_threshold)

        if image is not None and SAVE_TILES:
            self._save_tile(image, bounds, raw_boxes, confidence_threshold)

        image_base64 = self._encode_image(image, boxes_xyxy) if image is not None else ""
        # Celda limpia (sin cajas) para el panel de revision, que dibuja la caja encima.
        cell_image_base64 = ""
        if image is not None and detections:
            buffer = io.BytesIO()
            image.convert("RGB").save(buffer, format="JPEG", quality=85)
            cell_image_base64 = base64.b64encode(buffer.getvalue()).decode("ascii")
        # `bounds` es ya el area realmente analizada (tras recortar la marca de agua).
        return detections, image_base64, cell_image_base64, bounds

    def _save_tile(self, image, bounds, raw_boxes, threshold) -> None:
        """Guarda la celda tal cual la vio el modelo y otra copia anotada con todas las cajas."""
        try:
            folder = TILES_OUTPUT_DIR / datetime.now().strftime("%Y-%m-%d")
            folder.mkdir(parents=True, exist_ok=True)
            lat = (bounds.north + bounds.south) / 2
            lon = (bounds.east + bounds.west) / 2
            stem = f"{datetime.now().strftime('%H%M%S_%f')[:10]}_{lat:.5f}_{lon:.5f}"
            image.convert("RGB").save(folder / f"{stem}_original.jpg", quality=92)
            annotated = image.copy().convert("RGB")
            draw = ImageDraw.Draw(annotated)
            for conf, (x1, y1, x2, y2) in raw_boxes:
                color = "#f9b115" if conf >= threshold else "#9aa4b2"
                draw.rectangle([x1, y1, x2, y2], outline=color, width=4)
                draw.text((x1 + 6, y1 + 6), f"{conf * 100:.0f}%", fill=color)
            annotated.save(folder / f"{stem}_anotada.jpg", quality=92)
        except Exception as error:  # noqa: BLE001 - guardar es solo ayuda de revision
            print(f"[model-service] No se pudo guardar la imagen de la celda: {error}")

    def _predict_real(
        self, image: Image.Image | None, bounds: Bounds, confidence_threshold: float
    ) -> tuple[list[Detection], list[tuple[float, float, float, float]], list]:
        if image is None:
            print("[model-service] Analisis SIN imagen: no se ejecuto el modelo en esta celda.")
            return [], [], []

        # Se infiere con un umbral bajo y se filtra despues: asi se puede registrar la
        # confianza maxima que vio el modelo aunque no llegue al umbral pedido.
        started = time.perf_counter()
        with self._lock:
            raw = self.model.predict(
                image, conf=min(confidence_threshold, RAW_MIN_CONFIDENCE), imgsz=MODEL_INFERENCE_SIZE, verbose=False
            )[0]
        raw_boxes = sorted(
            ((float(b.conf[0]), tuple(b.xyxy[0].tolist())) for b in raw.boxes), key=lambda item: item[0], reverse=True
        )
        kept = [b for b in raw.boxes if float(b.conf[0]) >= confidence_threshold]
        where = f"({(bounds.north + bounds.south) / 2:.5f}, {(bounds.east + bounds.west) / 2:.5f})"
        print(
            f"[model-service] celda {where} {image.width}x{image.height}px, inferencia {time.perf_counter() - started:.2f}s, "
            f"{len(raw_boxes)} cajas vistas, umbral {confidence_threshold:.2f} -> {len(kept)} detecciones"
        )
        for conf, (x1, y1, x2, y2) in raw_boxes:
            mark = "DETECCION" if conf >= confidence_threshold else "por debajo del umbral"
            print(f"      - dump_site {conf * 100:5.1f}%  caja ({x1:.0f},{y1:.0f})-({x2:.0f},{y2:.0f})  [{mark}]")

        detections: list[Detection] = []
        boxes_xyxy: list[tuple[float, float, float, float]] = []
        for box in kept:
            x_center, y_center, _box_width, _box_height = box.xywh[0].tolist()
            confidence = float(box.conf[0])
            class_id = int(box.cls[0])
            lon, lat = pixel_to_lonlat(x_center, y_center, bounds, image.width, image.height)
            xyxy = tuple(box.xyxy[0].tolist())
            detections.append(
                Detection(
                    longitude=lon,
                    latitude=lat,
                    confidence=round(confidence, 3),
                    class_name=self.class_names.get(class_id, "unknown"),
                    box_normalized=self._normalize(xyxy, image),
                    crop_base64=self._crop(image, xyxy),
                )
            )
            boxes_xyxy.append(tuple(box.xyxy[0].tolist()))
        return detections, boxes_xyxy, raw_boxes

    def predict_frame(
        self, image: Image.Image, confidence_threshold: float
    ) -> list[Detection]:
        """Inferencia sobre un fotograma de dron. No hay bounds geograficos:
        la posicion la pone el backend a partir del registro de vuelo."""
        with self._lock:
            results = self.model.predict(
                image, conf=confidence_threshold, imgsz=MODEL_INFERENCE_SIZE, verbose=False
            )[0]
        out: list[Detection] = []
        for box in results.boxes:
            xyxy = tuple(box.xyxy[0].tolist())
            out.append(
                Detection(
                    longitude=0.0,
                    latitude=0.0,
                    confidence=round(float(box.conf[0]), 3),
                    class_name=self.class_names.get(int(box.cls[0]), "unknown"),
                    box_normalized=self._normalize(xyxy, image),
                    crop_base64=self._crop(image, xyxy),
                )
            )
        return out

    @staticmethod
    def _normalize(xyxy, image: Image.Image) -> list[float]:
        x1, y1, x2, y2 = xyxy
        w, h = image.size
        return [round(x1 / w, 4), round(y1 / h, 4), round(x2 / w, 4), round(y2 / h, 4)]

    @staticmethod
    def _crop(image: Image.Image, xyxy, margin: float = 0.35) -> str:
        """Recorte JPEG de la deteccion con un margen de contexto (35 %)."""
        x1, y1, x2, y2 = xyxy
        mx, my = (x2 - x1) * margin, (y2 - y1) * margin
        box = (
            max(0, int(x1 - mx)), max(0, int(y1 - my)),
            min(image.width, int(x2 + mx)), min(image.height, int(y2 + my)),
        )
        crop = image.convert("RGB").crop(box)
        if max(crop.size) > 512:
            crop.thumbnail((512, 512))
        buffer = io.BytesIO()
        crop.save(buffer, format="JPEG", quality=85)
        return base64.b64encode(buffer.getvalue()).decode("ascii")

    @staticmethod
    def _encode_image(
        image: Image.Image, boxes_xyxy: list[tuple[float, float, float, float]]
    ) -> str:
        """Draws detection boxes (if any) plus a visible watermark on a copy
        of the tile and returns it as a base64-encoded JPEG string. The
        watermark exists so it's unambiguous, just by looking at the image,
        that it was processed by the trained model and not just a raw PNOA
        crop. Deliberately does NOT print the weights filename/engine name
        here - that detail stays server-side, out of anything a user sees
        per cell."""
        annotated = image.copy().convert("RGB")
        draw = ImageDraw.Draw(annotated, "RGBA")

        for x1, y1, x2, y2 in boxes_xyxy:
            draw.rectangle([x1, y1, x2, y2], outline="#f9b115", width=3)

        width, height = annotated.size
        bar_height = 26
        draw.rectangle([0, height - bar_height, width, height], fill=(4, 20, 15, 190))

        try:
            font = ImageFont.load_default(size=13)
        except TypeError:  # older Pillow without the `size` kwarg
            font = ImageFont.load_default()

        label = "ECOGUARDIAN · YOLOv8"
        draw.text((8, height - bar_height + 6), label, fill="#22e3ac", font=font)

        # quality=90 (was 85): a bigger, sharper TILE_SIZE fetch (above)
        # deserves a re-encode that doesn't immediately throw part of it
        # away again. This does mean each tile's base64 payload is bigger
        # (roughly proportional to TILE_SIZE^2, so ~2.25x from the 640->960
        # bump alone, a bit more from the quality bump) - relevant because
        # the frontend keeps these in the browser's localStorage history
        # (see frontend/src/services/analyses.js getStorageUsage/the
        # storage-usage bar in AnalysisPage), which now fills up faster.
        buffer = io.BytesIO()
        annotated.save(buffer, format="JPEG", quality=90)
        return base64.b64encode(buffer.getvalue()).decode("ascii")


# Singleton instance used by the API layer.
detector = VertederoDetector()
