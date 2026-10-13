-- Enlaces de restablecimiento de contraseña (se guarda solo el hash del token).
CREATE TABLE IF NOT EXISTS password_resets (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT PRIMARY KEY,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
