import { zipToBuffer } from './zip.js'

// Formatos de exportacion de una ruta de vuelo.
//  - kmz     : plantilla de waypoints WPML de DJI (template.kml + waylines.wpml).
//              Es el formato de DJI Pilot 2 / Fly para misiones importables; la compatibilidad
//              concreta con DJI Fly del Mini 5 Pro depende de la version de la app.
//  - litchi  : CSV de Litchi (app de terceros con waypoints para la serie Mini).
//  - gpx     : ruta GPX, util como referencia para vuelo manual (Avata 2) o para cualquier visor.
//  - geojson : LineString + puntos, para QGIS u otros SIG.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const safeName = (name) => String(name || 'ruta').replace(/[^\w\-]+/g, '_').slice(0, 60) || 'ruta'

export function toGpx({ name, waypoints }) {
  const pts = waypoints.map((w) => `    <rtept lat="${w.lat}" lon="${w.lng}"><ele>${w.altitude}</ele><name>WP${w.index + 1}</name></rtept>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="EcoGuardian" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <rte>
    <name>${esc(name)}</name>
${pts}
  </rte>
</gpx>
`
}

export function toLitchiCsv({ waypoints, stats }) {
  const header = 'latitude,longitude,altitude(m),heading(deg),curvesize(m),rotationdir,gimbalmode,gimbalpitchangle,actiontype1,actionparam1,altitudemode,speed(m/s),poi_latitude,poi_longitude,poi_altitude(m),poi_altitudemode,photo_distinterval,photo_timeinterval'
  // Heading -1 = "automatico" (sigue el rumbo); cardan -90 = cenital; intervalo de fotos a la distancia calculada.
  const rows = waypoints.map((w) => [w.lat, w.lng, w.altitude, -1, 0, 0, 2, -90, -1, 0, 0, w.speed, 0, 0, 0, 0, stats?.photoIntervalM ?? 0, 0].join(','))
  return `${header}\n${rows.join('\n')}\n`
}

export function toGeoJson({ name, waypoints, polygon, params, stats }) {
  const features = [
    { type: 'Feature', properties: { kind: 'route', name }, geometry: { type: 'LineString', coordinates: waypoints.map((w) => [w.lng, w.lat, w.altitude]) } },
    ...waypoints.map((w) => ({ type: 'Feature', properties: { kind: 'waypoint', index: w.index + 1, altitude: w.altitude, speed: w.speed }, geometry: { type: 'Point', coordinates: [w.lng, w.lat] } })),
  ]
  if (polygon) features.unshift({ type: 'Feature', properties: { kind: 'area' }, geometry: { type: 'Polygon', coordinates: [[...polygon, polygon[0]]] } })
  return JSON.stringify({ type: 'FeatureCollection', name, properties: { params, stats }, features }, null, 2)
}

export async function toKmz({ name, waypoints, params }) {
  const now = Date.now()
  const altitude = params.altitude
  const speed = params.speed
  const droneEnum = Number(process.env.DJI_DRONE_ENUM) || 68
  const droneSub = Number(process.env.DJI_DRONE_SUB_ENUM) || 0

  // template.kml usa alturas globales; waylines.wpml lleva la altura y la velocidad de cada punto ya resueltas.
  const placemarks = (execute) =>
    waypoints
      .map(
        (w) => `      <Placemark>
        <Point><coordinates>${w.lng},${w.lat}</coordinates></Point>
        <wpml:index>${w.index}</wpml:index>
${
  execute
    ? `        <wpml:executeHeight>${altitude}</wpml:executeHeight>
        <wpml:waypointSpeed>${speed}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam>
          <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
          <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>
          <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>
          <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
        </wpml:waypointHeadingParam>
        <wpml:waypointTurnParam>
          <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>
          <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
        </wpml:waypointTurnParam>
        <wpml:useStraightLine>1</wpml:useStraightLine>`
    : `        <wpml:ellipsoidHeight>${altitude}</wpml:ellipsoidHeight>
        <wpml:height>${altitude}</wpml:height>
        <wpml:useGlobalHeight>1</wpml:useGlobalHeight>
        <wpml:useGlobalSpeed>1</wpml:useGlobalSpeed>
        <wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>
        <wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>`
}
      </Placemark>`,
      )
      .join('\n')

  const missionConfig = `    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:globalTransitionalSpeed>${speed}</wpml:globalTransitionalSpeed>
      <wpml:droneInfo>
        <wpml:droneEnumValue>${droneEnum}</wpml:droneEnumValue>
        <wpml:droneSubEnumValue>${droneSub}</wpml:droneSubEnumValue>
      </wpml:droneInfo>
    </wpml:missionConfig>`

  const folderCommon = `      <wpml:autoFlightSpeed>${speed}</wpml:autoFlightSpeed>
      <wpml:globalHeight>${altitude}</wpml:globalHeight>
      <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>
      <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>
      <wpml:gimbalPitchMode>manual</wpml:gimbalPitchMode>
      <wpml:globalWaypointHeadingParam>
        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
        <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>
        <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>
        <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
      </wpml:globalWaypointHeadingParam>`

  const header = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.6">`

  const template = `${header}
  <Document>
    <wpml:author>EcoGuardian</wpml:author>
    <wpml:createTime>${now}</wpml:createTime>
    <wpml:updateTime>${now}</wpml:updateTime>
${missionConfig}
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:waylineCoordinateSysParam>
        <wpml:coordinateMode>WGS84</wpml:coordinateMode>
        <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
      </wpml:waylineCoordinateSysParam>
${folderCommon}
${placemarks(false)}
    </Folder>
  </Document>
</kml>
`
  const waylines = `${header}
  <Document>
${missionConfig}
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:autoFlightSpeed>${speed}</wpml:autoFlightSpeed>
${placemarks(true)}
    </Folder>
  </Document>
</kml>
`
  return zipToBuffer({ 'wpmz/template.kml': template, 'wpmz/waylines.wpml': waylines })
}

export async function exportRoute(format, plan) {
  const base = safeName(plan.name)
  switch (format) {
    case 'gpx':
      return { filename: `${base}.gpx`, contentType: 'application/gpx+xml', body: toGpx(plan) }
    case 'litchi':
      return { filename: `${base}-litchi.csv`, contentType: 'text/csv; charset=utf-8', body: toLitchiCsv(plan) }
    case 'geojson':
      return { filename: `${base}.geojson`, contentType: 'application/geo+json', body: toGeoJson(plan) }
    case 'kmz':
      return { filename: `${base}.kmz`, contentType: 'application/vnd.google-earth.kmz', body: await toKmz(plan) }
    default:
      return null
  }
}
