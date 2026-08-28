import { useState, useEffect } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts';

const RISK_PIE_COLORS = { SEVERE: '#ef4444', HIGH: '#f97316', MODERATE: '#eab308', LOW: '#22c55e' };

function WardTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const w = payload[0].payload;
  return (
    <div style={{
      background: '#1e2235', border: '1px solid #2a2f45', borderRadius: 8,
      padding: '8px 12px', fontSize: 12, color: '#e8eaf0'
    }}>
      <div style={{ fontWeight: 700 }}>{w.ward}</div>
      <div style={{ color: '#9ca3b8' }}>{w.city}</div>
      <div style={{ marginTop: 4 }}>
        Risk: <b style={{ color: RISK_PIE_COLORS[w.risk_level] || '#9ca3b8' }}>{w.risk_level}</b>
        {' '}· Score {w.risk_score}
      </div>
    </div>
  );
}

export default function AlertStats() {
  const [data, setData] = useState({
    types: [], ward_counts: [], jal_shakti_stations: [], summary: null
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    const fetchData = async () => {
      try {
        const res = await fetch('/api/alerts/stats');
        if (!res.ok) throw new Error('Failed to fetch alert stats');
        const raw = await res.json();

        if (isMounted) {
          setData({
            types: raw.types || [],
            ward_counts: raw.ward_counts || [],
            jal_shakti_stations: raw.jal_shakti_stations || [],
            summary: raw.summary || null,
          });
          setLoading(false);
        }
      } catch (err) {
        console.error(err);
        if (isMounted) setLoading(false);
      }
    };

    fetchData();
    return () => { isMounted = false; };
  }, []);

  const atWarning = (data.summary?.stations_at_warning ?? 0) + (data.summary?.stations_at_danger ?? 0);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ margin: '0 0 12px 0' }}>Alert Statistics</h3>

      {loading ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="loading-spinner"></div>
          <p>Loading stats…</p>
        </div>
      ) : data.types.length === 0 && data.ward_counts.length === 0 ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <p>No alert statistics available</p>
        </div>
      ) : (
        <>
          <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: 0 }}>
            {/* Pie Chart: Risk level distribution */}
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#9ca3b8', textAlign: 'center' }}>By Risk Level</h4>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.types}
                    cx="50%" cy="50%"
                    innerRadius={30}
                    outerRadius={60}
                    paddingAngle={2}
                    dataKey="count"
                    nameKey="type"
                  >
                    {data.types.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={RISK_PIE_COLORS[entry.type] || '#3b82f6'}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e2235', border: '1px solid #2a2f45', borderRadius: 8, fontSize: 12 }}
                    itemStyle={{ color: '#fff' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Bar Chart: Top wards at risk (score-sorted, backend-limited to 10) */}
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#9ca3b8', textAlign: 'center' }}>Top Risk Wards</h4>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.ward_counts} margin={{ top: 0, right: 12, left: -10, bottom: 0 }} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2f45" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, 1]}
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={{ stroke: '#2a2f45' }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="ward"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={{ stroke: '#2a2f45' }}
                    tickLine={false}
                    width={110}
                  />
                  <Tooltip content={<WardTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                  <Bar dataKey="risk_score" radius={[0, 4, 4, 0]}>
                    {data.ward_counts.map((entry, index) => (
                      <Cell
                        key={`bar-${index}`}
                        fill={RISK_PIE_COLORS[entry.risk_level] || '#3b82f6'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {data.summary && (
            <div style={{ marginTop: 10, fontSize: 12, color: '#9ca3b8', textAlign: 'center' }}>
              💧 {data.summary.total_monitored_stations} CWC gauges monitored
              {atWarning > 0 && (
                <span style={{ color: '#f97316' }}> · {atWarning} above warning level</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
