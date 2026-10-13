-- Vertederos legales (autorizados). Fuente prevista: MITECO "Vertederos de Residuos"
-- (shapefile nacional, datos de 2018). Todo lo detectado que NO coincida con una de estas
-- instalaciones se considera probable vertedero ilegal.
CREATE TABLE IF NOT EXISTS legal_facilities (
    id              SERIAL PRIMARY KEY,
    name            TEXT,
    facility_type   TEXT,
    municipality    TEXT,
    province        TEXT,
    source_dataset  TEXT NOT NULL,
    source_year     INTEGER,
    attributes      JSONB,
    geom            geometry(Geometry, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_legal_facilities_geom ON legal_facilities USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_legal_facilities_geog ON legal_facilities USING GIST ((geom::geography));
