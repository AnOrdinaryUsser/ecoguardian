import { pool } from '../config/db.js'

// Instalacion legal (vertedero autorizado) mas cercana a un punto, con la
// distancia en metros (calculada sobre geography, valida a cualquier latitud).
// Funciona tanto si la capa son puntos como poligonos.
export async function getNearestLegalFacility({ longitude, latitude }) {
  const { rows } = await pool.query(
    `
    SELECT name, facility_type, province, municipality,
           ST_Distance(ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, geom::geography) AS distance_meters
    FROM legal_facilities
    ORDER BY geom::geography <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
    LIMIT 1;
    `,
    [longitude, latitude],
  )
  return rows[0] ?? null
}
