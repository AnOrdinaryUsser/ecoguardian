"""Pydantic request/response models for the model-service API.

These type annotations are what FastAPI uses to auto-generate the OpenAPI
schema and the interactive Swagger UI at /docs, so keep them accurate.
"""

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Bounds(BaseModel):
    """Bounding box of a grid cell, in WGS84 decimal degrees."""

    north: float = Field(..., example=41.66)
    south: float = Field(..., example=41.65)
    east: float = Field(..., example=-4.72)
    west: float = Field(..., example=-4.73)


class PredictRequest(BaseModel):
    bounds: Bounds
    image_source: Optional[Literal["mapbox", "pnoa"]] = Field(
        default=None,
        description="Fuente de imagen. Por defecto DEFAULT_IMAGE_SOURCE (mapbox).",
    )
    # Was ge=0.85 (the product spec's intended production range) - widened
    # down to 0.30 so a lower threshold can be used while testing a freshly
    # trained model, to see whether it's detecting anything at all before
    # deciding it's confident enough for the stricter production range. If
    # this is still ge=0.85 in your deployed model-service, this endpoint
    # will reject (422) any request below that, no matter what the
    # frontend's slider is set to - both sides need to agree.
    confidence_threshold: float = Field(
        default=0.90,
        ge=0.30,
        le=0.95,
        description="Minimum confidence score (0.30-0.95) for a detection to be reported.",
    )


class Detection(BaseModel):
    longitude: float
    latitude: float
    confidence: float = Field(..., ge=0.0, le=1.0)
    class_name: str = Field(
        default="dump_site",
        description="Class detected by the YOLO model (this project's trained model has a single class: dump_site).",
    )
    box_normalized: Optional[list[float]] = Field(
        default=None,
        description="Caja [x1, y1, x2, y2] normalizada 0-1 respecto a la imagen analizada.",
    )
    crop_base64: str = Field(
        default="",
        description="Recorte JPEG (base64) de la zona detectada, con algo de contexto alrededor.",
    )


class PredictResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    detections: list[Detection]
    model_version: str
    cell_image_base64: str = Field(
        default="",
        description="Celda analizada sin cajas dibujadas (JPEG base64); solo si hay detecciones.",
    )
    analyzed_bounds: Optional[Bounds] = Field(
        default=None,
        description="Limites geograficos de la imagen realmente analizada (tras recortar la marca de agua). Sirve para calcular tamanos en metros.",
    )
    image_base64: str = Field(
        default="",
        description=(
            "Imagen PNOA analizada (recorte de la celda), codificada en base64 "
            "como JPEG, para poder mostrarla en el frontend junto a las "
            "detecciones. Vacia si no se pudo obtener la imagen."
        ),
    )


class PredictFrameRequest(BaseModel):
    """Un fotograma de video de dron (JPEG en base64)."""

    image_base64: str
    confidence_threshold: float = Field(default=0.5, ge=0.05, le=0.95)


class PredictFrameResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    detections: list[Detection]
    model_version: str
