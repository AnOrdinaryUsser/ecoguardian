-- Detecciones del modelo (satelite/Mapbox o fotogramas de dron), con la
-- comprobacion de legalidad y el estado de revision manual.
CREATE TABLE IF NOT EXISTS detections (
    id                       SERIAL PRIMARY KEY,
    longitude                DOUBLE PRECISION NOT NULL,
    latitude                 DOUBLE PRECISION NOT NULL,
    confidence               DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    class_name               TEXT NOT NULL DEFAULT 'dump_site',
    classification_status    TEXT,
    nearest_legal_name       TEXT,
    nearest_legal_distance_m DOUBLE PRECISION,
    image_source             TEXT NOT NULL DEFAULT 'mapbox',
    source_type              TEXT NOT NULL DEFAULT 'satellite' CHECK (source_type IN ('satellite', 'drone')),
    -- 'tile' = centro de la caja en la celda satelital; 'drone_position' = posicion
    -- del dron al capturar el fotograma (aproximada, no se conoce la orientacion de la camara).
    position_accuracy        TEXT NOT NULL DEFAULT 'tile',
    flight_id                INTEGER REFERENCES flights(id) ON DELETE SET NULL,
    frame_id                 INTEGER REFERENCES flight_frames(id) ON DELETE SET NULL,
    sightings                INTEGER NOT NULL DEFAULT 1,
    bbox                     JSONB,
    model_version            TEXT,
    created_by               INTEGER REFERENCES users(id) ON DELETE SET NULL,
    review_status            TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'confirmed', 'rejected')),
    reviewed_by              INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at              TIMESTAMPTZ,
    review_note              TEXT,
    geom                     geometry(Point, 4326) NOT NULL,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_detections_geom ON detections USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_detections_geog ON detections USING GIST ((geom::geography));
CREATE INDEX IF NOT EXISTS idx_detections_created_at ON detections (created_at);
CREATE INDEX IF NOT EXISTS idx_detections_review ON detections (review_status, source_type);
CREATE INDEX IF NOT EXISTS idx_detections_flight ON detections (flight_id);

-- Recorte de la imagen donde se detecto el vertedero (para el panel de revision).
CREATE TABLE IF NOT EXISTS detection_images (
    detection_id  INTEGER PRIMARY KEY REFERENCES detections(id) ON DELETE CASCADE,
    image_data    BYTEA NOT NULL,
    mime_type     TEXT NOT NULL DEFAULT 'image/jpeg'
);
