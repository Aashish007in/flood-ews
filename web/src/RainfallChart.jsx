import {
  ComposedChart, Bar, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ReferenceLine, ResponsiveContainer,
} from 'recharts'

const COLORS = {
  observed: '#6366f1',
  forecast: 'rgba(249,115,22,0.5)',
  forecastStroke: '#f97316',
  now: '#ef4444',
  grid: '#2a2f45',
  text: '#6b7280',
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const day = d.getDate()
  const mon = d.toLocaleString('en', { month: 'short' })
  return `${day} ${mon} ${h}:${m}`
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#1e2235',
      border: '1px solid #2a2f45',
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
      color: '#e8eaf0',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 2 }}>
          {p.name}: {p.value != null ? `${p.value.toFixed(2)} mm` : '—'}
        </div>
      ))}
    </div>
  )
}

export default function RainfallChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="empty-state" style={{ height: '100%' }}>
        <p>No timeseries data available</p>
      </div>
    )
  }

  // Transform data: split observed/forecast into separate fields
  const chartData = data.map(d => ({
    time: formatTime(d.time),
    observed: d.kind === 'observed' ? d.rainfall_mm : null,
    forecast: d.kind === 'forecast' ? d.rainfall_mm : null,
  }))

  // Find the NOW boundary (last observed index)
  const lastObsIdx = chartData.reduce(
    (acc, d, i) => (d.observed != null ? i : acc), -1
  )
  const nowLabel = lastObsIdx >= 0 ? chartData[lastObsIdx].time : null

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
        <XAxis
          dataKey="time"
          tick={{ fill: COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: COLORS.grid }}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fill: COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: COLORS.grid }}
          label={{
            value: 'mm',
            position: 'insideTopLeft',
            fill: COLORS.text,
            fontSize: 11,
            offset: -5,
          }}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 12, color: '#9ca3b8' }}
          iconType="rect"
        />

        {/* Observed rainfall as bars */}
        <Bar
          dataKey="observed"
          name="Observed"
          fill={COLORS.observed}
          radius={[3, 3, 0, 0]}
          maxBarSize={20}
        />

        {/* Forecast rainfall as semi-transparent area */}
        <Area
          dataKey="forecast"
          name="Forecast"
          type="monotone"
          fill={COLORS.forecast}
          stroke={COLORS.forecastStroke}
          strokeWidth={2}
          dot={false}
        />

        {/* NOW reference line */}
        {nowLabel && (
          <ReferenceLine
            x={nowLabel}
            stroke={COLORS.now}
            strokeDasharray="4 4"
            strokeWidth={2}
            label={{
              value: 'NOW',
              position: 'top',
              fill: COLORS.now,
              fontSize: 12,
              fontWeight: 700,
            }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
