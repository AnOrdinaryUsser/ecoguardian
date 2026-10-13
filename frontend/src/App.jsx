import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar.jsx'
import TutorialTour, { TUTORIAL_SEEN_KEY } from './components/TutorialTour.jsx'
import MapPage from './pages/MapPage.jsx'
import AnalysisPage from './pages/AnalysisPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import LoginPage from './pages/LoginPage.jsx'
import ResetPasswordPage from './pages/ResetPasswordPage.jsx'
import ReviewPage from './pages/ReviewPage.jsx'
import FlightsPage from './pages/FlightsPage.jsx'
import FlightDetailPage from './pages/FlightDetailPage.jsx'
import UsersPage from './pages/UsersPage.jsx'
import IncidentsPage from './pages/IncidentsPage.jsx'
import AreasPage from './pages/AreasPage.jsx'
import RoutesPage from './pages/RoutesPage.jsx'
import AlertsPage from './pages/AlertsPage.jsx'
import RequireRole from './auth/RequireRole.jsx'
import { useAuth } from './auth/AuthContext.jsx'

// Raiz: sin sesion se muestra el login; con sesion, la barra lateral (segun el
// rol) y la pagina activa, con la intro y el tutorial por encima.
export default function App() {
  const { user, loading } = useAuth()
  const [tutorialActive, setTutorialActive] = useState(false)

  function startTutorial() {
    setTutorialActive(true)
  }

  // Sin intro: el tutorial se lanza solo la primera vez tras iniciar sesion.
  useEffect(() => {
    if (!user) return
    let alreadySeen = null
    try {
      alreadySeen = localStorage.getItem(TUTORIAL_SEEN_KEY)
    } catch (error) {
      alreadySeen = 'true'
    }
    if (!alreadySeen) setTutorialActive(true)
  }, [user])

  if (loading) return null
  if (!user) {
    return (
      <Routes>
        <Route path="/restablecer" element={<ResetPasswordPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  return (
    <div className="app-shell">
      <Sidebar onStartTutorial={startTutorial} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<MapPage />} />
          <Route
            path="/analisis"
            element={
              <RequireRole roles={['monitor']}>
                <AnalysisPage />
              </RequireRole>
            }
          />
          <Route path="/revision" element={<ReviewPage />} />
          <Route path="/incidencias" element={<IncidentsPage />} />
          <Route path="/areas" element={<AreasPage />} />
          <Route
            path="/rutas"
            element={
              <RequireRole roles={['piloto']}>
                <RoutesPage />
              </RequireRole>
            }
          />
          <Route
            path="/alertas"
            element={
              <RequireRole roles={['gestor']}>
                <AlertsPage />
              </RequireRole>
            }
          />
          <Route path="/drones" element={<FlightsPage />} />
          <Route path="/drones/:id" element={<FlightDetailPage />} />
          <Route path="/estadisticas" element={<DashboardPage />} />
          <Route
            path="/usuarios"
            element={
              <RequireRole roles={[]}>
                <UsersPage />
              </RequireRole>
            }
          />
        </Routes>
      </main>
      <TutorialTour active={tutorialActive} onFinish={() => setTutorialActive(false)} />
    </div>
  )
}
