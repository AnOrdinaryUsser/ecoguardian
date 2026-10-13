import 'dotenv/config'

// Distancia (m) por debajo de la cual una deteccion se considera la propia
// instalacion legal (y no un vertedero ilegal). Un vertedero real ocupa
// cientos de metros y la capa del ministerio es 1:25.000, asi que el margen
// es generoso; ajustalo con LEGAL_FACILITY_RADIUS_METERS.
const LEGAL_FACILITY_RADIUS_METERS = Number(process.env.LEGAL_FACILITY_RADIUS_METERS) || 300

// Regla unica y explicable: si coincide con un vertedero legal registrado es
// "legal probable"; en cualquier otro caso, "ilegal probable".
export function classifyDetection({ nearestLegalFacility }) {
  const isLegal =
    !!nearestLegalFacility &&
    typeof nearestLegalFacility.distance_meters === 'number' &&
    nearestLegalFacility.distance_meters <= LEGAL_FACILITY_RADIUS_METERS

  if (isLegal) {
    return {
      status: 'legal_probable',
      label: 'Vertedero legal registrado',
      severity: 'info',
      reason: `A ${Math.round(nearestLegalFacility.distance_meters)} m de "${nearestLegalFacility.name ?? 'instalacion sin nombre'}", un vertedero autorizado.`,
    }
  }

  return {
    status: 'illegal_probable',
    label: 'Vertedero ilegal probable',
    severity: 'warning',
    reason: 'No coincide con ningun vertedero legal registrado.',
  }
}

export const LEGAL_FACILITY_RADIUS = LEGAL_FACILITY_RADIUS_METERS
