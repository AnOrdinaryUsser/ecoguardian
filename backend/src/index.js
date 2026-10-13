import os from 'node:os'
import 'dotenv/config'
import { createApp } from './app.js'
import { ensureAdminUser, ensureSchemaUpgrades } from './services/bootstrap.js'
import { recoverInterruptedFlights } from './services/flightProcessor.js'
import { startAreaScheduler } from './services/areaScheduler.js'

const PORT = process.env.BACKEND_PORT || 4000
const app = createApp()

// 0.0.0.0: accesible desde otros equipos de la red local por la IP de esta maquina.
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`EcoGuardian backend escuchando en el puerto ${PORT}`)
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`  En tu red local: http://${a.address}:${PORT}`)
    }
  }
  console.log(`Swagger UI: http://localhost:${PORT}/api-docs`)
  try {
    await ensureSchemaUpgrades()
    await ensureAdminUser()
    await recoverInterruptedFlights()
    await startAreaScheduler()
  } catch (error) {
    console.error('[bootstrap] No se pudo comprobar/crear el admin (¿esta la base de datos arriba y con el esquema aplicado?):', error.message)
  }
})
