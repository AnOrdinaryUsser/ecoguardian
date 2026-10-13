-- Usuarios de EcoGuardian. Roles:
--   admin   : gestiona usuarios y puede todo
--   monitor : monitoreo ambiental (analizar zonas, areas vigiladas, revisar detecciones)
--   gestor  : gestion de incidencias (catalogar, asignar, planificar limpieza)
--   piloto  : operador de drones (misiones, rutas, subida de vuelos)
CREATE TABLE IF NOT EXISTS users (
    id             SERIAL PRIMARY KEY,
    email          TEXT NOT NULL,
    full_name      TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL CHECK (role IN ('admin', 'monitor', 'gestor', 'piloto')),
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
