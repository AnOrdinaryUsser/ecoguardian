"""Carga en `legal_facilities` la capa "Vertederos de Residuos" del MITECO.

Fuente (shapefile nacional, datos a mayo de 2018, escala 1:25.000, ETRS89):
  https://www.mapama.gob.es/app/descargas/descargafichero.aspx?f=vertederos-residuos.zip
Pagina: https://www.miteco.gob.es/en/cartografia-y-sig/ide/descargas/calidad-y-evaluacion-ambiental/vertederos-residuos.html
Credito exigido: © Ministerio para la Transición Ecológica (MITECO)

Uso:
    python scripts/load_legal_landfills.py                 # descarga el zip del MITECO
    python scripts/load_legal_landfills.py --file ruta.zip # usa un zip/.shp local
    python scripts/load_legal_landfills.py --file data/Listado_Vertederos_Espana.xlsx
        # listado en Excel/CSV con UTMX, UTMY, HUSO y sistema de referencia (ETRS89, ED50, REGCAN95)

AVISO: la capa es de 2018. Vertederos autorizados despues de esa fecha no
estaran y apareceran como "ilegal probable". Puedes cargar tambien otras
fuentes (CCAA) con --source y --year: se anaden sin borrar las demas.
"""

import argparse
import re
import sys
import tempfile
import zipfile
from pathlib import Path

import geopandas as gpd
import pandas as pd
import requests

# Usa los certificados del sistema: en redes con inspeccion HTTPS (universidad,
# antivirus, VPN) Python solo no confia en ellos y falla con "self-signed certificate".
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass
from sqlalchemy import text

from common.db import get_engine

MITECO_URL = "https://www.mapama.gob.es/app/descargas/descargafichero.aspx?f=vertederos-residuos.zip"
DEFAULT_SOURCE = "MITECO - Vertederos de Residuos"
TABLE_SOURCE = "MITECO - Listado de vertederos"

# Nombres de columna habituales (se compara en minusculas, sin tildes).
NAME_KEYS = ("nombre", "name", "denominaci", "denominacion", "instalacion", "vertedero")
MUNI_KEYS = ("municipio", "munic", "localidad", "concello")
PROV_KEYS = ("provincia", "prov")
TYPE_KEYS = ("tipo", "clase", "categoria", "type")


def pick(columns, keys):
    norm = {c: re.sub(r"[^a-z]", "", c.lower()) for c in columns}
    for key in keys:
        for col, n in norm.items():
            if n == key or n.startswith(key):
                return col
    return None


def read_layer(path: Path) -> gpd.GeoDataFrame:
    if path.suffix.lower() == ".zip":
        workdir = Path(tempfile.mkdtemp(prefix="vertederos_"))
        with zipfile.ZipFile(path) as zf:
            zf.extractall(workdir)
        shapefiles = list(workdir.rglob("*.shp"))
        if not shapefiles:
            sys.exit("El zip no contiene ningun .shp")
        path = shapefiles[0]
    gdf = gpd.read_file(path)
    if gdf.crs is None:
        print("AVISO: el shapefile no declara CRS; se asume ETRS89 geografico (EPSG:4258).")
        gdf = gdf.set_crs(4258)
    return gdf.to_crs(4326)


# EPSG segun sistema de referencia y huso del listado.
def utm_epsg(system, zone):
    system = (system or "").strip().upper()
    zone = int(zone)
    if system == "ETRS89" and zone in (28, 29, 30, 31):
        return 25800 + zone
    if system == "ED50" and zone in (29, 30, 31):
        return 23000 + zone
    if system == "REGCAN95" and zone in (27, 28):
        return 4055 + zone  # 4082 (27N) / 4083 (28N)
    return None


def clean_text(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text_value = re.sub(r"\s+", " ", str(value)).strip()
    return text_value or None


def read_table(path: Path):
    """Listado en Excel/CSV con columnas UTMX/UTMY/HUSO/SISTEMA DE REFERENCIA.
    Devuelve (GeoDataFrame en EPSG:4326, lista de filas descartadas con el motivo)."""
    from pyproj import Transformer
    from shapely.geometry import Point

    df = pd.read_csv(path, sep=None, engine="python") if path.suffix.lower() == ".csv" else pd.read_excel(path)
    df = df.dropna(how="all")
    norm = {c: re.sub(r"[^a-z0-9]", "", str(c).lower().replace("ó", "o").replace("ú", "u")) for c in df.columns}

    def col(*keys):
        for key in keys:
            for c, n in norm.items():
                if n.startswith(key):
                    return c
        sys.exit(f"Falta la columna '{keys[0]}' en {path.name}. Columnas: {list(df.columns)}")

    c_class, c_name, c_ca = col("clase"), col("denominacion"), col("ca")
    c_auth, c_sys, c_x, c_y, c_zone = col("numerodeautorizacion", "numero"), col("sistema"), col("utmx"), col("utmy"), col("huso")

    records, rejected = [], []
    transformers = {}
    for idx, row in df.iterrows():
        label = clean_text(row[c_name]) or f"fila {idx + 2}"
        x, y = pd.to_numeric(row[c_x], errors="coerce"), pd.to_numeric(row[c_y], errors="coerce")
        zone = pd.to_numeric(row[c_zone], errors="coerce")
        if pd.isna(x) or pd.isna(y):
            rejected.append((label, "sin coordenadas completas (falta UTMX o UTMY)"))
            continue
        epsg = None if pd.isna(zone) else utm_epsg(clean_text(row[c_sys]), zone)
        if epsg is None:
            rejected.append((label, f"sistema/huso no soportado ({row[c_sys]}, {row[c_zone]})"))
            continue
        if epsg not in transformers:
            transformers[epsg] = Transformer.from_crs(epsg, 4326, always_xy=True)
        lon, lat = transformers[epsg].transform(float(x), float(y))
        if not (-19.5 <= lon <= 5.0 and 27.0 <= lat <= 44.5):
            rejected.append((label, f"coordenadas fuera de Espana tras convertir ({lat:.3f}, {lon:.3f}); revisa UTMX/UTMY/huso"))
            continue
        records.append(
            {
                "name": clean_text(row[c_name]),
                "facility_type": clean_text(row[c_class]),
                "municipality": None,
                "province": None,
                "ca": clean_text(row[c_ca]),
                "authorization": clean_text(row[c_auth]),
                "crs": f"{clean_text(row[c_sys])} huso {int(zone)}",
                "utm_x": float(x),
                "utm_y": float(y),
                "geometry": Point(lon, lat),
            }
        )
    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs=4326)
    return gdf, rejected


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", help="zip o .shp local (si no, se descarga del MITECO)")
    parser.add_argument("--source", default=DEFAULT_SOURCE, help="nombre de la fuente (clave para recargar sin duplicar)")
    parser.add_argument("--year", type=int, default=None, help="ano de los datos (informativo)")
    args = parser.parse_args()

    if args.file:
        path = Path(args.file)
    else:
        print(f"Descargando {MITECO_URL} ...")
        response = requests.get(MITECO_URL, timeout=120)
        response.raise_for_status()
        path = Path(tempfile.mkdtemp()) / "vertederos-residuos.zip"
        path.write_bytes(response.content)

    is_table = path.suffix.lower() in (".xlsx", ".xls", ".csv")
    if is_table:
        gdf, rejected = read_table(path)
        if args.source == DEFAULT_SOURCE:
            args.source = TABLE_SOURCE
        if rejected:
            print(f"\nDescartadas {len(rejected)} filas que no se pueden situar en el mapa:")
            for label, reason in rejected[:15]:
                print(f"  - {label[:50]}: {reason}")
            if len(rejected) > 15:
                print(f"  ... y {len(rejected) - 15} mas")
            print()
        cols = list(gdf.columns)
        name_col, muni_col, prov_col, type_col = "name", "municipality", "province", "facility_type"
    else:
        gdf = read_layer(path)
        if args.year is None:
            args.year = 2018
        cols = list(gdf.columns)
        name_col, muni_col, prov_col, type_col = (pick(cols, k) for k in (NAME_KEYS, MUNI_KEYS, PROV_KEYS, TYPE_KEYS))
    print(f"{len(gdf)} elementos. Columnas: {cols}")
    print(f"Mapeo -> nombre:{name_col} municipio:{muni_col} provincia:{prov_col} tipo:{type_col}")

    insert = text(
        """
        INSERT INTO legal_facilities (name, facility_type, municipality, province, source_dataset, source_year, attributes, geom)
        VALUES (:name, :facility_type, :municipality, :province, :source, :year, CAST(:attributes AS jsonb),
                ST_SetSRID(ST_GeomFromText(:wkt), 4326))
        """
    )

    def val(row, col):
        v = row[col] if col else None
        return None if v is None or str(v).strip() in ("", "nan", "None") else str(v).strip()

    rows = []
    for _, row in gdf.iterrows():
        if row.geometry is None or row.geometry.is_empty:
            continue
        attrs = {c: (None if str(row[c]) == "nan" else str(row[c])) for c in cols if c != "geometry"}
        rows.append(
            {
                "name": val(row, name_col),
                "facility_type": val(row, type_col),
                "municipality": val(row, muni_col),
                "province": val(row, prov_col),
                "source": args.source,
                "year": args.year,
                "attributes": __import__("json").dumps(attrs, ensure_ascii=False),
                "wkt": row.geometry.wkt,
            }
        )

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM legal_facilities WHERE source_dataset = :s"), {"s": args.source})
        if rows:
            conn.execute(insert, rows)
    print(f"Cargadas {len(rows)} instalaciones en legal_facilities (fuente: {args.source}).")


if __name__ == "__main__":
    main()
