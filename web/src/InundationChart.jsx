import { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const day = d.getDate();
  const mon = d.toLocaleString('en', { month: 'short' });
  return `${day} ${mon} ${h}:${m}`;
}

export default function InundationChart({ wardName }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!wardName) {
      setData([]);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const fetchData = async () => {
      try {
        const res = await fetch('/api/inundation/history');
        if (!res.ok) throw new Error('Failed to fetch inundation history');
        const raw = await res.json();
        
        if (isMounted) {
          // Add formatted time
          setData(raw.map(d => ({
            ...d,
            timeLabel: formatTime(d.time)
          })));
          setLoading(false);
        }
      } catch (err) {
        console.error(err);
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    return () => { isMounted = false; };
  }, [wardName]);

  if (!wardName) return null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h3 style={{ margin: '0 0 12px 0' }}>Inundation Depth & Probability</h3>

      {loading ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="loading-spinner"></div>
          <p>Loading inundation data…</p>
        </div>
      ) : data.length === 0 ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <p>No historical inundation data</p>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f45" />
              <XAxis dataKey="timeLabel" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#2a2f45' }} interval="preserveStartEnd" />
              
              <YAxis yAxisId="left" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#2a2f45' }} 
                label={{ value: 'Depth (m)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }}
              />
              <YAxis yAxisId="right" orientation="right" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#2a2f45' }} 
                label={{ value: 'Prob (%)', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 11 }}
              />
              
              <Tooltip 
                contentStyle={{ background: '#1e2235', border: '1px solid #2a2f45', borderRadius: 8 }}
                itemStyle={{ fontSize: 12 }}
                labelStyle={{ color: '#e8eaf0', fontWeight: 'bold', marginBottom: 6 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              
              <Line yAxisId="left" type="monotone" dataKey="depth_m" name="Depth (m)" stroke="#3b82f6" strokeWidth={2} dot={true} />
              <Line yAxisId="right" type="monotone" dataKey="probability" name="Probability (%)" stroke="#eab308" strokeWidth={2} strokeDasharray="4 4" dot={true} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
