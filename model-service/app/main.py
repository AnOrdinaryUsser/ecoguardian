"""FastAPI application exposing the trained dumpsite-detection model.

Swagger UI is generated automatically by FastAPI from the type hints in
app/schemas.py and is available at /docs (ReDoc at /redoc, raw spec at
/openapi.json) with zero extra configuration.
"""

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.model import detector
import base64
import io

from fastapi import HTTPException
from PIL import Image

from app.schemas import PredictFrameRequest, PredictFrameResponse, PredictRequest, PredictResponse

load_dotenv()

app = FastAPI(
    title="EcoGuardian — Model Service",
    description=(
        "Servicio que sirve el modelo YOLOv8 entrenado para detectar "
        "posibles vertederos ilegales (clase 'dump_site') en imagen "
        "aerea/satelital (Mapbox por defecto, PNOA opcional)."
    ),
    version=detector.model_version,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["Salud"])
def health_check():
    """Simple liveness check used by the backend and by deployment tooling."""
    return {
        "status": "ok",
        "model_version": detector.model_version,
        "classes": detector.class_names,
    }


@app.post("/predict", response_model=PredictResponse, tags=["Prediccion"])
def predict(request: PredictRequest):
    """Runs the trained model over the imagery covering the given bounds.

    Devuelve la lista de detecciones (longitud, latitud, confianza, clase)
    por encima del umbral de confianza indicado, junto con la propia imagen
    analizada (en base64) con las cajas de deteccion dibujadas.
    """
    detections, image_base64, cell_image_base64, analyzed_bounds = detector.predict(
        request.bounds, request.confidence_threshold, request.image_source
    )
    return PredictResponse(
        detections=detections,
        model_version=detector.model_version,
        image_base64=image_base64,
        cell_image_base64=cell_image_base64,
        analyzed_bounds=analyzed_bounds,
    )


@app.post("/predict-frame", response_model=PredictFrameResponse, tags=["Prediccion"])
def predict_frame(request: PredictFrameRequest):
    """Inferencia sobre un fotograma de video de dron (JPEG en base64).

    No devuelve coordenadas: el backend asigna la posicion del dron en ese
    instante a partir del registro de vuelo."""
    try:
        image = Image.open(io.BytesIO(base64.b64decode(request.image_base64))).convert("RGB")
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Imagen no valida: {error}") from error
    detections = detector.predict_frame(image, request.confidence_threshold)
    return PredictFrameResponse(detections=detections, model_version=detector.model_version)
