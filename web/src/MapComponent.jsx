import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const OWM_KEY = import.meta.env.VITE_OWM_KEY || '';
// When hosted on Vercel, set VITE_API_BASE to the backend URL (e.g. https://floodguard-api.onrender.com)
const API_BASE = import.meta.env.VITE_API_BASE || '';

const SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const LABELS_URL = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';

const RISK_COLORS = { LOW: '#22c55e', MODERATE: '#eab308', HIGH: '#f97316', SEVERE: '#ef4444' };

const LIVE_MAPS = [
  { id: 'satellite', label: 'Satellite', icon: '🛰️' },
  { id: 'live', label: 'Live', icon: '✓' },
  { id: 'hd', label: 'HD', icon: '' },
];

const FORECAST_MAPS = [
  { id: 'precipitation', label: 'Precipitation', icon: '🌧️' },
  { id: 'wind', label: 'Wind', icon: '🌬️' },
  { id: 'temperature', label: 'Temperature', icon: '🌡️' },
  { id: 'humidity', label: 'Humidity', icon: '💧' },
  { id: 'pressure', label: 'Pressure', icon: '🧭' },
];

const OWM_LAYERS = {
  wind: 'wind_new',
  temperature: 'temp_new',
  humidity: 'humidity_new',
  pressure: 'pressure_new',
};

const SEVERITY_COLORS = { SEVERE: '#a855f7', HIGH: '#f97316', MODERATE: '#facc15', WATCH: '#22c55e' };

const GAUGE_STATUS_COLORS = { NORMAL: '#22c55e', WARNING: '#facc15', DANGER: '#f97316', EXTREME: '#ef4444' };

// Great-circle distance in km — used to filter inundation cells around a station
const haversineKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

export default function MapComponent({ onWardSelect, selectedWard, wards = [], layer, onLayerChange }) {
  const mapRef = useRef(null);
  const baseSatRef = useRef(null);
  const labelsRef = useRef(null);
  const radarRef = useRef(null);
  const owmRef = useRef(null);
  const zonesLayerRef = useRef(null);
  const inundationLayerRef = useRef(null);
  const cycloneLayerRef = useRef(null);
  const wdLayerRef = useRef(null);
  const gaugesLayerRef = useRef(null);
  const historyLayerRef = useRef(null);

  const cityBoundsRef = useRef({});
  const wardCentersRef = useRef({});
  const [expandedCity, setExpandedCity] = useState(null);
  const [radarFrames, setRadarFrames] = useState([]);
  const [frameIdx, setFrameIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [cyclones, setCyclones] = useState([]);
  const [cyclonesStale, setCyclonesStale] = useState(false);
  const [wdData, setWdData] = useState(null);
  const [toast, setToast] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [zonesOn, setZonesOn] = useState(true);
  const [inundationOn, setInundationOn] = useState(true);
  const [cyclonesOn, setCyclonesOn] = useState(true);
  const [wdOn, setWdOn] = useState(true);
  const [gaugesOn, setGaugesOn] = useState(true);
  const [historyOn, setHistoryOn] = useState(false);
  const [historyDays, setHistoryDays] = useState(7);
  const [gaugeCount, setGaugeCount] = useState(0);
  const [stations, setStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState('all');
  const [stationMenuOpen, setStationMenuOpen] = useState(false);
  const stationsRef = useRef([]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  /* ── Map initialisation ─────────────────────────────────────────────── */
  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map('map-container', {
      zoomControl: false,
      attributionControl: false,
      worldCopyJump: true,
    }).fitBounds([[-12, 42], [48, 152]]);

    baseSatRef.current = L.tileLayer(SATELLITE_URL, { maxZoom: 19 }).addTo(map);
    labelsRef.current = L.tileLayer(LABELS_URL, { maxZoom: 19, opacity: 0.9, pane: 'shadowPane' });
    radarRef.current = L.tileLayer('', { opacity: 0.65, maxZoom: 12 });
    owmRef.current = null;

    zonesLayerRef.current = L.layerGroup().addTo(map);
    inundationLayerRef.current = L.layerGroup().addTo(map);
    cycloneLayerRef.current = L.layerGroup().addTo(map);
    wdLayerRef.current = L.layerGroup().addTo(map);
    gaugesLayerRef.current = L.layerGroup().addTo(map);
    historyLayerRef.current = L.layerGroup().addTo(map);

    // Custom attribution bar
    const attrib = L.control({ position: 'bottomleft' });
    attrib.onAdd = () => {
      const div = L.DomUtil.create('div', 'ze-attribution');
      div.innerHTML = '© Floodguard AI · Esri, Maxar · RainViewer · Open-Meteo';
      return div;
    };
    attrib.addTo(map);

    mapRef.current = map;
  }, []);

  /* ── Base layer switching ───────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Reset previous extras
    if (owmRef.current) { map.removeLayer(owmRef.current); owmRef.current = null; }
    if (radarRef.current) map.removeLayer(radarRef.current);
    if (labelsRef.current) map.removeLayer(labelsRef.current);

    const radarVisible = layer === 'precipitation' || layer === 'live';
    const labelsVisible = ['hd', 'wind', 'temperature', 'humidity', 'pressure'].includes(layer);

    if (labelsVisible) labelsRef.current.addTo(map);

    if (layer === 'precipitation') {
      radarRef.current.addTo(map);
      setPlaying(true);
    } else if (layer === 'live') {
      radarRef.current.addTo(map);
      setFrameIdx(radarFrames.length - 1);
    } else {
      setPlaying(false);
    }

    if (OWM_LAYERS[layer]) {
      if (!OWM_KEY) {
        showToast('⚠️ Set VITE_OWM_KEY (OpenWeatherMap key) to enable this forecast layer');
      } else {
        owmRef.current = L.tileLayer(
          `https://maps.openweathermap.org/maps/2.0/weather/${OWM_LAYERS[layer]}/{z}/{x}/{y}?appid=${OWM_KEY}&opacity=0.65&palette=PNG32`,
          { maxZoom: 19, opacity: 0.65 }
        ).addTo(map);
      }
    }
  }, [layer, radarFrames.length]);

  /* ── RainViewer radar frames (rainfall) ─────────────────────────────── */
  useEffect(() => {
    const loadRadar = async () => {
      try {
        const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await res.json();
        const frames = [
          ...(data.radar?.past || []),
          ...(data.radar?.nowcast || []),
        ];
        setRadarFrames(frames.map(f => ({
          ...f,
          url: `${data.host}${f.path}/512/{z}/{x}/{y}/4/1_1.png`,
        })));
      } catch (e) {
        console.error('Failed to load radar frames', e);
      }
    };
    loadRadar();
    const interval = setInterval(loadRadar, 5 * 60_000);
    return () => clearInterval(interval);
  }, []);

  /* ── Radar frame animation / selection ──────────────────────────────── */
  useEffect(() => {
    if (!radarRef.current || radarFrames.length === 0) return;
    if (frameIdx < 0 || frameIdx >= radarFrames.length) {
      setFrameIdx(radarFrames.length - 1);
      return;
    }
    radarRef.current.setUrl(radarFrames[frameIdx].url);
  }, [frameIdx, radarFrames]);

  useEffect(() => {
    if (!playing || radarFrames.length === 0) return;
    const t = setInterval(() => {
      setFrameIdx(i => (i + 1) % radarFrames.length);
    }, 600);
    return () => clearInterval(t);
  }, [playing, radarFrames.length]);

  /* ── Cyclone tracking (multi-basin) ─────────────────────────────────── */
  useEffect(() => {
    const fetchCyclones = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/cyclones`);
        if (!res.ok) throw new Error('bad status');
        const data = await res.json();
        const systems = data.systems || [];
        setCyclones(systems);
        setCyclonesStale(!!data.stale);

        cycloneLayerRef.current.clearLayers();
        if (!cyclonesOn) return;
        systems.forEach(s => {
          const color = SEVERITY_COLORS[s.threat_level] || '#a855f7';
          const icon = L.divIcon({
            className: 'cyclone-icon',
            html: `<div class="ze-cyclone-dot" style="--dot-color:${color}">
                     <span class="ze-cyclone-ring"></span>
                     <span class="ze-cyclone-core">🌀</span>
                   </div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          });
          L.marker([s.lat, s.lon], { icon })
            .addTo(cycloneLayerRef.current)
            .bindPopup(`
              <div class="ze-popup">
                <h4 style="color:${color}; margin:0 0 4px;">🌀 ${s.category}</h4>
                <div><b>Basin:</b> ${s.basin}</div>
                <div><b>Max Wind:</b> ${s.max_wind_kmh} km/h</div>
                <div><b>Min Pressure:</b> ${s.min_pressure} hPa</div>
                <div><b>Threat:</b> ${s.threat_level}</div>
              </div>
            `);
        });
      } catch (e) {
        console.error('Failed to fetch cyclones', e);
      }
    };
    fetchCyclones();
    const t = setInterval(fetchCyclones, 10 * 60_000);
    return () => clearInterval(t);
  }, [cyclonesOn]);

  /* ── Western disturbances ───────────────────────────────────────────── */
  useEffect(() => {
    const fetchWD = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/western-disturbances`);
        if (!res.ok) return;
        const data = await res.json();
        setWdData(data);

        wdLayerRef.current.clearLayers();
        if (!wdOn || !data.track?.length) return;

        // Dashed track line (Mediterranean → Himalaya corridor)
        L.polyline(
          data.track.map(n => [n.lat, n.lon]),
          { color: '#38bdf8', weight: 2, dashArray: '8 8', opacity: 0.8 }
        ).addTo(wdLayerRef.current);

        data.track.forEach(n => {
          const isActive = data.active.some(a => a.lat === n.lat && a.lon === n.lon);
          const icon = L.divIcon({
            className: 'wd-icon',
            html: `<div class="ze-wd-dot ${isActive ? 'active' : ''}"></div>`,
            iconSize: [16, 16],
            iconAnchor: [8, 8],
          });
          L.marker([n.lat, n.lon], { icon })
            .addTo(wdLayerRef.current)
            .bindPopup(`
              <div class="ze-popup">
                <h4 style="color:#38bdf8; margin:0 0 4px;">${isActive ? '🌩️' : '🌫️'} Western Disturbance</h4>
                <div><b>Node:</b> ${n.name}</div>
                <div><b>Min Pressure:</b> ${n.min_pressure} hPa</div>
                <div><b>Max Wind:</b> ${n.max_wind_kmh} km/h</div>
                <div><b>Precip (24h):</b> ${n.precip_next_24h} mm</div>
                <div style="margin-top:4px; font-weight:600; color:${isActive ? '#38bdf8' : '#9ca3b8'};">
                  ${isActive ? 'ACTIVE — bringing rain/snow to N. India' : 'Weak / transient signature'}
                </div>
              </div>
            `);
        });
      } catch (e) {
        console.error('Failed to fetch western disturbances', e);
      }
    };
    fetchWD();
    const t = setInterval(fetchWD, 15 * 60_000);
    return () => clearInterval(t);
  }, [wdOn]);

  /* ── Risk zones ─────────────────────────────────────────────────────── */
  useEffect(() => {
    const fetchRiskZones = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/risk`);
        const geojson = await res.json();
        zonesLayerRef.current.clearLayers();
        if (!zonesOn) return;

        const openForecastPopup = async (latlng, p) => {
          onWardSelect(p.ward_name, p.city);
          try {
            const fr = await fetch(`${API_BASE}/api/forecast/${encodeURIComponent(p.ward_name)}`);
            if (fr.ok) {
              const d = await fr.json();
              L.popup()
                .setLatLng(latlng)
                .setContent(`
                  <div class="ze-popup">
                    <h4 style="margin:0 0 4px;">${p.ward_name}</h4>
                    <div style="color:#9ca3b8; font-size:12px; margin-bottom:6px;">${p.city}, ${p.country}</div>
                    <div>Risk: <b style="color:${RISK_COLORS[p.risk_level]}">${p.risk_level}</b> (score ${p.score})</div>
                    <div>🌧️ Next 24h: <b>${d.next_24h_mm.toFixed(1)} mm</b></div>
                  </div>
                `)
                .openOn(mapRef.current);
            }
          } catch (e) { console.error(e); }
        };

        // Ward polygons (visible when zoomed in)
        L.geoJSON(geojson, {
          style: f => ({
            fillColor: RISK_COLORS[f.properties.risk_level] || '#666',
            fillOpacity: 0.45,
            color: '#fff',
            weight: 1.2,
          }),
          onEachFeature: (f, lyr) => {
            const p = f.properties;
            lyr.bindTooltip(`${p.ward_name} — ${p.risk_level}`, { direction: 'top' });
            lyr.on('click', () => openForecastPopup(lyr.getBounds().getCenter(), p));
          },
        }).addTo(zonesLayerRef.current);

        // Always-visible risk dots at ward centroids (visible when zoomed out)
        cityBoundsRef.current = {};
        wardCentersRef.current = {};
        (geojson.features || []).forEach(f => {
          const p = f.properties;
          const gj = L.geoJSON(f);
          const center = gj.getBounds().getCenter();
          wardCentersRef.current[p.ward_name] = center;
          if (!cityBoundsRef.current[p.city]) {
            cityBoundsRef.current[p.city] = L.latLngBounds([]);
          }
          cityBoundsRef.current[p.city].extend(gj.getBounds());
          const color = RISK_COLORS[p.risk_level] || '#666';
          L.circleMarker(center, {
            radius: 6,
            color: '#fff',
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.95,
          })
            .bindTooltip(`${p.ward_name} — ${p.risk_level}`, { direction: 'top' })
            .on('click', () => openForecastPopup(center, p))
            .addTo(zonesLayerRef.current);
        });
      } catch (e) {
        console.error('Failed to fetch risk zones', e);
      }
    };
    fetchRiskZones();
  }, [zonesOn, onWardSelect]);

  /* ── Inundation warnings ────────────────────────────────────────────── */
  useEffect(() => {
    const fetchFloodWarnings = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/flood-warnings`);
        const geojson = await res.json();
        inundationLayerRef.current.clearLayers();
        if (!inundationOn) return;

        // When a district station is picked in the dropdown, only show
        // inundation cells in that station's canal area (25 km radius)
        const sel = stationsRef.current.find(s => s.station_id === selectedStation) || null;
        const features = sel && geojson?.features
          ? geojson.features.filter(f => {
              const c = f.geometry?.coordinates;
              if (!c) return false;
              return haversineKm(c[1], c[0], sel.lat, sel.lon) <= 25;
            })
          : (geojson?.features || []);
        const filtered = { type: 'FeatureCollection', features };

        L.geoJSON(filtered, {
          style: f => {
            const d = f.properties.depth_m;
            let color = '#3b82f6';
            if (d >= 0.8 && d < 1.5) color = '#1d4ed8';
            else if (d >= 1.5) color = '#1e3a8a';
            return { fillColor: color, fillOpacity: 0.8, color: '#60a5fa', weight: 1 };
          },
          onEachFeature: (f, lyr) =>
            lyr.bindPopup(`<div class="ze-popup"><b>Inundation Warning</b>${sel ? `<br/><b>District station:</b> ${sel.name}` : ''}<br/>Depth: ${f.properties.depth_m.toFixed(2)} m</div>`),
        }).addTo(inundationLayerRef.current);
      } catch (e) {
        console.error('Failed to fetch flood warnings', e);
      }
    };
    fetchFloodWarnings();
    const t = setInterval(fetchFloodWarnings, 2 * 60_000);
    return () => clearInterval(t);
  }, [inundationOn, selectedStation]);

  /* ── Jal Shakti / CWC river gauge stations ───────────────────────────── */
  useEffect(() => {
    const fetchGauges = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/alerts/stats`);
        if (!res.ok) return;
        const data = await res.json();
        const stations = data.jal_shakti_stations || [];
        stationsRef.current = stations;
        setStations(stations);
        setGaugeCount(stations.length);

        gaugesLayerRef.current.clearLayers();
        if (!gaugesOn) return;

        const trendArrow = { RISING: '▲', FALLING: '▼', STEADY: '▬' };

        stations.forEach(s => {
          const color = GAUGE_STATUS_COLORS[s.status] || '#9ca3b8';
          L.circleMarker([s.lat, s.lon], {
            radius: 7,
            color: '#fff',
            weight: 2,
            fillColor: color,
            fillOpacity: 0.95,
          })
            .bindTooltip(
              `<div class="gauge-tooltip">
                <h4>💧 ${s.name}</h4>
                <div><b>Basin:</b> ${s.river_basin} · ${s.state}</div>
                <div><b>Water level:</b> ${s.water_level_m} m ${trendArrow[s.trend] || ''}</div>
                <div><b>Warning level:</b> ${s.warning_level_m} m</div>
                <div><b>Danger level:</b> ${s.danger_level_m} m</div>
                <div class="gauge-status" style="color:${color}">${s.status} · ${s.trend} — ${s.agency}</div>
              </div>`,
              { direction: 'top', className: 'gauge-tooltip-wrap', opacity: 1 }
            )
            .addTo(gaugesLayerRef.current);
        });
      } catch (e) {
        console.error('Failed to fetch river gauges', e);
      }
    };
    fetchGauges();
    const t = setInterval(fetchGauges, 10 * 60_000);
    return () => clearInterval(t);
  }, [gaugesOn]);

  /* ── Historical inundation polygons (date-range selectable) ──────────── */
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/inundation/history?days=${historyDays}`);
        if (!res.ok) return;
        const geojson = await res.json();
        historyLayerRef.current.clearLayers();
        if (!historyOn) return;
        L.geoJSON(geojson, {
          style: f => {
            const d = f.properties.depth_m || 0;
            let color = '#94a3b8';
            if (d >= 0.3 && d < 0.8) color = '#a78bfa';
            else if (d >= 0.8 && d < 1.5) color = '#8b5cf6';
            else if (d >= 1.5) color = '#6d28d9';
            return { fillColor: color, fillOpacity: 0.55, color, weight: 1, dashArray: '3 4' };
          },
          onEachFeature: (f, lyr) => {
            const p = f.properties;
            lyr.bindPopup(`
              <div class="ze-popup">
                <h4 style="margin:0 0 4px;">📜 Historical Inundation</h4>
                ${p.ward_name ? `<div><b>Ward:</b> ${p.ward_name}, ${p.city}</div>` : ''}
                <div><b>Depth:</b> ${p.depth_m != null ? p.depth_m.toFixed(2) : '—'} m</div>
                <div><b>Probability:</b> ${p.probability != null ? (p.probability * 100).toFixed(0) + '%' : '—'}</div>
                <div><b>Recorded:</b> ${p.recorded_at ? new Date(p.recorded_at).toLocaleString() : '—'}</div>
              </div>
            `);
          },
        }).addTo(historyLayerRef.current);
      } catch (e) {
        console.error('Failed to fetch inundation history', e);
      }
    };
    fetchHistory();
  }, [historyOn, historyDays]);

  /* ── UI helpers ─────────────────────────────────────────────────────── */
  const frameTime = radarFrames[frameIdx]
    ? new Date(radarFrames[frameIdx].time * 1000)
    : new Date();

  const dateStr = frameTime.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const timeStr = frameTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

  const zoom = (delta) => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(map.getZoom() + delta);
  };

  const locate = () => {
    if (!navigator.geolocation) return showToast('Geolocation unavailable');
    navigator.geolocation.getCurrentPosition(
      pos => mapRef.current?.flyTo([pos.coords.latitude, pos.coords.longitude], 10),
      () => showToast('Unable to get your location')
    );
  };

  const worstCyclone = cyclones.find(s => s.threat_level === 'SEVERE')
    || cyclones.find(s => s.threat_level === 'HIGH')
    || cyclones[0];

  // Group wards into a city menu
  const cityGroups = useMemo(() => {
    const map = new Map();
    wards.forEach(w => {
      if (!map.has(w.city)) map.set(w.city, { city: w.city, country: w.country, wards: [] });
      map.get(w.city).wards.push(w);
    });
    return Array.from(map.values()).sort((a, b) =>
      a.country.localeCompare(b.country) || a.city.localeCompare(b.city));
  }, [wards]);

  const toggleCity = (g) => {
    if (expandedCity === g.city) {
      setExpandedCity(null);
      return;
    }
    setExpandedCity(g.city);
    const bounds = cityBoundsRef.current[g.city];
    if (bounds && bounds.isValid() && mapRef.current) {
      mapRef.current.flyToBounds(bounds, { padding: [60, 60], maxZoom: 12, duration: 0.8 });
    }
  };

  const flyToWard = (wardName) => {
    const center = wardCentersRef.current[wardName];
    if (center && mapRef.current) {
      mapRef.current.flyTo(center, 12, { duration: 0.8 });
    }
  };

  // District-wise station grouping for the Inundation dropdown
  const stationGroups = useMemo(() => {
    const map = new Map();
    stations.forEach(s => {
      const key = s.state || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    });
    return Array.from(map.entries())
      .map(([state, sts]) => ({ state, stations: sts }))
      .sort((a, b) => a.state.localeCompare(b.state));
  }, [stations]);

  const selectedStationObj = stations.find(s => s.station_id === selectedStation) || null;

  const pickStation = (id) => {
    setSelectedStation(id);
    setStationMenuOpen(false);
    if (id !== 'all') {
      const s = stationsRef.current.find(x => x.station_id === id);
      if (s && mapRef.current) mapRef.current.flyTo([s.lat, s.lon], 11, { duration: 0.8 });
    }
  };

  const renderLayerItem = (item, group) => {
    const active = layer === item.id;
    return (
      <div
        key={item.id}
        className={`ze-layer-item ${active ? 'active' : ''}`}
        onClick={() => onLayerChange(item.id)}
      >
        {item.icon && <span className="ze-layer-icon">{item.icon}</span>}
        <span>{item.label}</span>
        {group === 'live' && active && <span className="ze-check">✓</span>}
      </div>
    );
  };

  return (
    <div className="ze-map-root">
      <div id="map-container" />

      {/* ── Logo ─────────────────────────────────────────────── */}
      <div className="ze-logo">
        <div className="ze-logo-badge">🛡️</div>
        <div className="ze-logo-text">
          <strong>FLOODGUARD</strong>
          <span>AI</span>
        </div>
      </div>

      {/* ── Left panel ───────────────────────────────────────── */}
      {panelOpen && (
        <aside className="ze-panel">
          <div className="ze-panel-section">
            <div className="ze-panel-title">LIVE MAPS</div>
            {LIVE_MAPS.map(i => renderLayerItem(i, 'live'))}
          </div>

          <div className="ze-panel-section">
            <div className="ze-panel-title">FORECAST MAPS</div>
            {FORECAST_MAPS.map(i => renderLayerItem(i, 'forecast'))}
          </div>

          <div className="ze-panel-section">
            <div className="ze-panel-title">OVERLAYS</div>
            {[
              { label: 'Cyclones', on: cyclonesOn, set: setCyclonesOn, count: cyclones.length },
              { label: 'Western Disturbances', on: wdOn, set: setWdOn, count: wdData?.count ?? 0 },
              { label: 'Flood Zones', on: zonesOn, set: setZonesOn },
              { label: 'Inundation', on: inundationOn, set: setInundationOn },
              { label: 'Jal Shakti / CWC Gauges', on: gaugesOn, set: setGaugesOn, count: gaugeCount },
              { label: 'Flood History', on: historyOn, set: setHistoryOn },
            ].map(o => (
              <label key={o.label} className="ze-toggle">
                <input type="checkbox" checked={o.on} onChange={e => o.set(e.target.checked)} />
                <span>{o.label}</span>
                {o.count > 0 && <span className="ze-count">{o.count}</span>}
              </label>
            ))}
            {inundationOn && (
              <div className="ze-station-select">
                <button
                  type="button"
                  className="ze-station-btn"
                  onClick={() => setStationMenuOpen(o => !o)}
                >
                  <span>
                    📍 {selectedStationObj ? selectedStationObj.name : 'All district stations'}
                  </span>
                  <span className="ze-station-arrow">{stationMenuOpen ? '▾' : '▸'}</span>
                </button>
                {stationMenuOpen && (
                  <div className="ze-station-menu">
                    <label className="ze-station-option">
                      <input
                        type="radio"
                        name="inundation-station"
                        checked={selectedStation === 'all'}
                        onChange={() => pickStation('all')}
                      />
                      <span>All districts</span>
                    </label>
                    {stationGroups.map(g => (
                      <div key={g.state}>
                        <div className="ze-station-group">{g.state}</div>
                        {g.stations.map(s => (
                          <label key={s.station_id} className="ze-station-option">
                            <input
                              type="radio"
                              name="inundation-station"
                              checked={selectedStation === s.station_id}
                              onChange={() => pickStation(s.station_id)}
                            />
                            <span
                              className="ze-station-dot"
                              style={{ background: GAUGE_STATUS_COLORS[s.status] || '#9ca3b8' }}
                            />
                            <span>{s.name}</span>
                            <span className="ze-station-basin">{s.river_basin}</span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {historyOn && (
              <div className="ze-history-range">
                <span className="ze-history-label">Range:</span>
                {[1, 7, 30].map(d => (
                  <button
                    key={d}
                    className={`ze-range-btn ${historyDays === d ? 'active' : ''}`}
                    onClick={() => setHistoryDays(d)}
                  >
                    {d === 1 ? '24h' : `${d}d`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ze-panel-section ze-ward-section">
            <div className="ze-panel-title">FLOOD ZONES — MAJOR CITIES</div>
            <div className="ze-ward-list">
              {cityGroups.map(g => (
                <div key={g.city} className="ze-city-group">
                  <div
                    className={`ze-city-item ${expandedCity === g.city ? 'open' : ''}`}
                    onClick={() => toggleCity(g)}
                  >
                    <span className="ze-city-arrow">{expandedCity === g.city ? '▾' : '▸'}</span>
                    <span className="ze-city-name">{g.city}</span>
                    <span className="ze-city-count">{g.wards.length}</span>
                  </div>
                  {expandedCity === g.city && g.wards.map(w => (
                    <div
                      key={`${w.city}-${w.ward_name}`}
                      className={`ze-ward-item ${selectedWard === w.ward_name ? 'active' : ''}`}
                      onClick={() => {
                        onWardSelect(w.ward_name, w.city);
                        flyToWard(w.ward_name);
                      }}
                    >
                      <span className={`ze-risk-dot risk-${w.risk_level}`} />
                      <span className="ze-ward-name">{w.ward_name}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </aside>
      )}

      {/* ── Panel collapse button ────────────────────────────── */}
      <button
        className="ze-panel-toggle"
        onClick={() => setPanelOpen(o => !o)}
        title={panelOpen ? 'Hide panel' : 'Show panel'}
      >
        {panelOpen ? '‹' : '›'}
      </button>

      {/* ── Right icon rail ──────────────────────────────────── */}
      <div className="ze-rail">
        <button className="ze-rail-btn" title="Search" onClick={() => showToast('Use the Flood Zones list to find a ward')}>🔍</button>
        <button className="ze-rail-btn" title="Settings" onClick={() => showToast('Settings coming soon')}>⚙️</button>
        <button className="ze-rail-btn" title="Info" onClick={() => showToast('Floodguard AI — South Asia Early Warning System')}>ℹ️</button>
        <button className="ze-rail-btn" title="My location" onClick={locate}>🎯</button>
      </div>

      {/* ── Zoom controls ────────────────────────────────────── */}
      <div className="ze-zoom">
        <button className="ze-rail-btn" onClick={() => zoom(1)} title="Zoom in">＋</button>
        <button className="ze-rail-btn" onClick={() => zoom(-1)} title="Zoom out">－</button>
      </div>

      {/* ── Timeline ─────────────────────────────────────────── */}
      <div className="ze-timeline">
        <button className="ze-play" onClick={() => setPlaying(p => !p)} title={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="ze-time-block">
          <span className="ze-time-val">{dateStr}</span>
          <span className="ze-time-arrow" onClick={() => setFrameIdx(i => Math.min(i + 1, radarFrames.length - 1))}>˄</span>
        </div>
        <div className="ze-time-block">
          <span className="ze-time-val">{timeStr}</span>
          <span className="ze-time-arrow" onClick={() => setFrameIdx(i => Math.max(i - 1, 0))}>˅</span>
        </div>
        <button className="ze-play" onClick={() => setFrameIdx(radarFrames.length - 1)} title="Latest">⏭</button>
        {layer === 'precipitation' && <span className="ze-timeline-label">Radar · RainViewer</span>}
      </div>

      {/* ── Cyclone alert banner ─────────────────────────────── */}
      {cyclones.length > 0 && (
        <div className="ze-cyclone-banner">
          <span className="ze-banner-spin">🌀</span>
          {cyclones.length} cyclonic system{cyclones.length > 1 ? 's' : ''} tracked — strongest: {cyclones[0].category} ({cyclones[0].max_wind_kmh} km/h, {cyclones[0].basin})
          {cyclonesStale && <span style={{ fontWeight: 400, opacity: 0.85 }}> · last known data (live scan unavailable)</span>}
        </div>
      )}

      {/* ── Toast ────────────────────────────────────────────── */}
      {toast && <div className="ze-toast">{toast}</div>}
    </div>
  );
}