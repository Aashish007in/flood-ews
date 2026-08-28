import { useState, useEffect } from 'react';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from 'recharts';

const PIE_COLORS = ['#3b82f6', '#ef4444', '#eab308', '#a855f7', '#22c55e'];

export default function AlertStats() {
  const [data, setData] = useState({ types: [], ward_counts: [] });
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
          setData(raw);
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
        <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: 0 }}>
          {/* Pie Chart: Alert Types */}
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#9ca3b8', textAlign: 'center' }}>By Type</h4>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.types}
                  cx="50%" cy="50%"
                  innerRadius={30}
                  outerRadius={60}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {data.types.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ background: '#1e2235', border: '1px solid #2a2f45', borderRadius: 8, fontSize: 12 }}
                  itemStyle={{ color: '#fff' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Bar Chart: By Ward */}
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 13, color: '#9ca3b8', textAlign: 'center' }}>By Ward</h4>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.ward_counts} margin={{ top: 0, right: 0, left: -20, bottom: 0 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2f45" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={{ stroke: '#2a2f45' }} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={{ stroke: '#2a2f45' }} tickLine={false} width={60} />
                <Tooltip 
                  contentStyle={{ background: '#1e2235', border: '1px solid #2a2f45', borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                />
                <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
