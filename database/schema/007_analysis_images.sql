-- Miniaturas de celdas analizadas, guardadas en servidor para no llenar localStorage.
CREATE TABLE IF NOT EXISTS analysis_images (
    id          SERIAL PRIMARY KEY,
    image_data  BYTEA NOT NULL,
    mime_type   TEXT NOT NULL DEFAULT 'image/jpeg',
    created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
