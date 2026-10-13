-- Gestion de incidencias, alertas por correo, areas monitorizadas, tamano de detecciones y planes de vuelo.
-- (El backend aplica lo mismo de forma idempotente al arrancar: services/bootstrap.js)

CREATE TABLE IF NOT EXISTS monitored_areas (
    id                    SERIAL PRIMARY KEY,
    name                  TEXT NOT NULL,
    notes                 TEXT,
    polygon               JSONB NOT NULL,                 -- [[lng, lat], ...]
    interval_days         INTEGER NOT NULL DEFAULT 30 CHECK (interval_days BETWEEN 1 AND 365),
    zoom                  INTEGER NOT NULL DEFAULT 18 CHECK (zoom BETWEEN 13 AND 19),
    confidence_threshold  DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (confidence_threshold BETWEEN 0.3 AND 0.95),
    active                BOOLEAN NOT NULL DEFAULT TRUE,
    cells_estimate        INTEGER,
    last_run_at           TIMESTAMPTZ,
    next_run_at           TIMESTAMPTZ,
    created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS area_runs (
    id                SERIAL PRIMARY KEY,
    area_id           INTEGER NOT NULL REFERENCES monitored_areas(id) ON DELETE CASCADE,
    trigger           TEXT NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'scheduled')),
    status            TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'error')),
    cells_total       INTEGER NOT NULL DEFAULT 0,
    cells_done        INTEGER NOT NULL DEFAULT 0,
    cells_failed      INTEGER NOT NULL DEFAULT 0,
    detections_found  INTEGER NOT NULL DEFAULT 0,
    new_detections    INTEGER NOT NULL DEFAULT 0,
    error_message     TEXT,
    started_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_area_runs_area ON area_runs (area_id, started_at DESC);

ALTER TABLE detections ADD COLUMN IF NOT EXISTS area_m2 DOUBLE PRECISION;
ALTER TABLE detections ADD COLUMN IF NOT EXISTS monitored_area_id INTEGER REFERENCES monitored_areas(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS incidents (
    id                    SERIAL PRIMARY KEY,
    detection_id          INTEGER UNIQUE REFERENCES detections(id) ON DELETE SET NULL,
    title                 TEXT NOT NULL,
    description           TEXT,
    status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'notified', 'in_progress', 'resolved', 'dismissed')),
    priority              TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    assigned_to           INTEGER REFERENCES users(id) ON DELETE SET NULL,
    authority_name        TEXT,
    authority_email       TEXT,
    planned_cleanup_date  DATE,
    resolved_at           TIMESTAMPTZ,
    latitude              DOUBLE PRECISION NOT NULL,
    longitude             DOUBLE PRECISION NOT NULL,
    area_m2               DOUBLE PRECISION,
    created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents (status, priority);

CREATE TABLE IF NOT EXISTS incident_events (
    id           SERIAL PRIMARY KEY,
    incident_id  INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind         TEXT NOT NULL,
    message      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events (incident_id, created_at);

CREATE TABLE IF NOT EXISTS alert_recipients (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    organization  TEXT,
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_log (
    id               SERIAL PRIMARY KEY,
    kind             TEXT NOT NULL,
    recipient_email  TEXT NOT NULL,
    subject          TEXT,
    detection_id     INTEGER,
    incident_id      INTEGER,
    area_id          INTEGER,
    status           TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log (created_at DESC);

CREATE TABLE IF NOT EXISTS flight_plans (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    polygon     JSONB NOT NULL,
    params      JSONB NOT NULL,
    waypoints   JSONB NOT NULL,
    stats       JSONB NOT NULL,
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
