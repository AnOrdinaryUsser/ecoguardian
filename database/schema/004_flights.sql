-- Vuelos de dron: el piloto sube un video + el registro de vuelo con GPS; el
-- backend extrae fotogramas, los pasa por el modelo y guarda aqui el resultado.
CREATE TABLE IF NOT EXISTS flights (
    id                    SERIAL PRIMARY KEY,
    name                  TEXT NOT NULL,
    notes                 TEXT,
    drone_model           TEXT,
    created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status                TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'done', 'error')),
    error_message         TEXT,
    video_filename        TEXT,
    video_duration_s      DOUBLE PRECISION,
    telemetry_filename    TEXT,
    telemetry_offset_s    DOUBLE PRECISION NOT NULL DEFAULT 0,
    frame_interval_s      DOUBLE PRECISION NOT NULL DEFAULT 2,
    confidence_threshold  DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    frames_total          INTEGER NOT NULL DEFAULT 0,
    frames_done           INTEGER NOT NULL DEFAULT 0,
    detections_count      INTEGER NOT NULL DEFAULT 0,
    track                 geometry(LineString, 4326),
    telemetry             JSONB,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_flights_created_at ON flights (created_at DESC);

CREATE TABLE IF NOT EXISTS flight_frames (
    id                SERIAL PRIMARY KEY,
    flight_id         INTEGER NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
    idx               INTEGER NOT NULL,
    t_seconds         DOUBLE PRECISION NOT NULL,
    longitude         DOUBLE PRECISION,
    latitude          DOUBLE PRECISION,
    altitude_m        DOUBLE PRECISION,
    image_path        TEXT NOT NULL,
    detections_count  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (flight_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_flight_frames_flight ON flight_frames (flight_id, idx);
