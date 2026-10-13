-- Estadisticas agregadas de uso (sin datos personales).
CREATE TABLE IF NOT EXISTS usage_stats (
    id                    SERIAL PRIMARY KEY,
    area_square_meters    DOUBLE PRECISION NOT NULL DEFAULT 0,
    detections_count      INTEGER NOT NULL DEFAULT 0,
    recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_stats_recorded_at ON usage_stats (recorded_at);
