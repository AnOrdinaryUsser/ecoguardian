"""Shared PostGIS connection helper for the ETL scripts."""

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine

# Lee la configuracion del proyecto (.env en la raiz de ecoguardian), la misma que usa Docker
# y el backend; un .env propio en etl/ tiene prioridad si existe.
load_dotenv()  # etl/.env (opcional)
load_dotenv(Path(__file__).resolve().parents[3] / ".env")


def get_engine():
    host = os.getenv("POSTGRES_HOST", "localhost")
    port = os.getenv("POSTGRES_PORT", "5432")
    db = os.getenv("POSTGRES_DB", "ecoguardian")
    user = os.getenv("POSTGRES_USER", "ecoguardian")
    password = os.getenv("POSTGRES_PASSWORD", "change_me")

    connection_string = f"postgresql+psycopg2://{user}:{password}@{host}:{port}/{db}"
    return create_engine(connection_string)
