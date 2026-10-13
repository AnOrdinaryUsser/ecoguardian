-- Celda satelital analizada donde se hizo la deteccion (para mostrarla con su caja en Revision).
ALTER TABLE detections ADD COLUMN IF NOT EXISTS cell_image_id INTEGER REFERENCES analysis_images(id) ON DELETE SET NULL;
