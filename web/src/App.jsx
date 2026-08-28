import { useState, useEffect, useMemo, useCallback } from 'react'
import RainfallChart from './RainfallChart.jsx'
import MapComponent from './MapComponent.jsx'
import ModelSpreadChart from './ModelSpreadChart.jsx'
import InundationChart from './InundationChart.jsx'
import AlertStats from './AlertStats.jsx'
import CapAlertBanner from './CapAlertBanner.jsx'

const RISK_ORDER = { SEVERE: 0, HIGH: 1, MODERATE: 2, LOW: 3 }

// When hosted on Vercel, set VITE_API_BASE to the backend URL (e.g. https://floodguard-api.onrender.com)
const API_BASE = import.meta.env.VITE_API_BASE || ''

export default function App() {
  const [allWards, setAllWards] = useState([])
  const [selectedWard, setSelectedWard] = useState(null)
  const [selectedCity, setSelectedCity] = useState(null)
  const [timeseries, setTimeseries] = useState([])
  const [loading, setLoading] = useState(false)
  const [layer, setLayer] = useState('satellite')
  const [dashboardOpen, setDashboardOpen] = useState(false)

  // Fetch all wards
  useEffect(() => {
    fetch(`${API_BASE}/api/risk`)
      .then(r => r.json())
      .then(geojson => {
        const features = geojson.features || []
        const wards = features
          .map(f => f.properties)
          .sort((a, b) => (RISK_ORDER[a.risk_level] ?? 9) - (RISK_ORDER[b.risk_level] ?? 9))
        setAllWards(wards)
      })
      .catch(err => console.error('Failed to fetch wards:', err))
  }, [])

  // Fetch timeseries and live forecast when ward is selected
  useEffect(() => {
    if (!selectedWard) {
      setTimeseries([])
      return
    }
    setLoading(true)
    setDashboardOpen(true)
    const wardData = allWards.find(w => w.ward_name === selectedWard)
    const cityParam = wardData ? `&city=${encodeURIComponent(wardData.city)}` : ''

    Promise.all([
      fetch(`${API_BASE}/api/timeseries/${encodeURIComponent(selectedWard)}?${cityParam}`).then(r => r.json()),
      fetch(`${API_BASE}/api/forecast/${encodeURIComponent(selectedWard)}`).then(r => r.json())
    ])
      .then(([dbData, forecastData]) => {
        const observed = dbData.filter(d => d.kind === 'observed')
        const forecast = (forecastData.hourly_series || []).map(d => ({
          time: d.time,
          rainfall_mm: d.precipitation,
          kind: 'forecast'
        }))
        const merged = [...observed, ...forecast].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
        setTimeseries(merged)
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to fetch data:', err)
        setLoading(false)
      })
  }, [selectedWard, allWards])

  const activeWardData = allWards.find(w => w.ward_name === selectedWard)

  const handleWardSelect = useCallback((wardName, cityName) => {
    setSelectedWard(wardName)
    setSelectedCity(cityName)
    if (wardName) setDashboardOpen(true)
  }, [])

  const closeDashboard = useCallback(() => {
    setDashboardOpen(false)
    setSelectedWard(null)
  }, [])

  // Compute summary stats
  const observed = timeseries.filter(t => t.kind === 'observed')
  const totalRainfall = observed.reduce((s, t) => s + (t.rainfall_mm || 0), 0)
  const maxRainfall = observed.length ? Math.max(...observed.map(t => t.rainfall_mm || 0)) : 0
  const avgSoilMoisture = observed.length
    ? (observed.reduce((s, t) => s + (t.soil_moisture || 0), 0) / observed.length)
    : 0

  const riskCounts = useMemo(() => {
    const counts = { SEVERE: 0, HIGH: 0, MODERATE: 0, LOW: 0 }
    allWards.forEach(w => { counts[w.risk_level] = (counts[w.risk_level] || 0) + 1 })
    return counts
  }, [allWards])

  return (
    <div className="app ze-app">
      {/* ── Full-screen Zoom Earth map ─────────────────────────── */}
      <MapComponent
        onWardSelect={handleWardSelect}
        selectedWard={selectedWard}
        wards={allWards}
        layer={layer}
        onLayerChange={setLayer}
      />

      {/* ── CAP emergency alert banner (top-center, above all map layers) ── */}
      <CapAlertBanner />

      {/* ── Slide-in dashboard drawer ──────────────────────────── */}
      {selectedWard && dashboardOpen && (
        <aside className="ze-dashboard">
          <div className="ze-dashboard-header">
            <div>
              <h2>{selectedWard}</h2>
              {activeWardData && (
                <span className="header-subtitle">
                  {activeWardData.city}, {activeWardData.country}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {activeWardData && (
                <span className={`risk-badge risk-${activeWardData.risk_level}`}>
                  <span className="dot"></span>
                  {activeWardData.risk_level}
                </span>
              )}
              <button className="ze-close-btn" onClick={closeDashboard} title="Close">✕</button>
            </div>
          </div>

          <div className="ze-dashboard-body">
            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-label">Observed Total (48h)</div>
                <div className="stat-value">
                  {totalRainfall.toFixed(1)}<span className="stat-unit">mm</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Peak Hourly</div>
                <div className="stat-value">
                  {maxRainfall.toFixed(1)}<span className="stat-unit">mm</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Avg Soil Moisture</div>
                <div className="stat-value">
                  {avgSoilMoisture.toFixed(2)}<span className="stat-unit">m³/m³</span>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Observations</div>
                <div className="stat-value">
                  {observed.length}<span className="stat-unit">pts</span>
                </div>
              </div>
            </div>

            <div className="chart-container" style={{ height: 320, marginTop: 16 }}>
              <h3>Rainfall — Observed vs Forecast</h3>
              {loading ? (
                <div className="empty-state">
                  <div className="loading-spinner"></div>
                  <p>Loading timeseries…</p>
                </div>
              ) : (
                <div className="chart-wrapper">
                  <RainfallChart data={timeseries} />
                </div>
              )}
            </div>

            <div className="chart-container" style={{ height: 320, marginTop: 16 }}>
              <ModelSpreadChart wardName={selectedWard} />
            </div>

            <div style={{ display: 'flex', gap: 16, marginTop: 16, height: 280 }}>
              <div className="chart-container" style={{ flex: 1, margin: 0 }}>
                <InundationChart wardName={selectedWard} />
              </div>
              <div className="chart-container" style={{ flex: 1, margin: 0 }}>
                <AlertStats />
              </div>
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}