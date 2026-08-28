import { useState, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const MODELS = ['ecmwf_ifs025', 'gfs_global', 'icon_global', 'gem_global', 'jma_gsm'];
const MODEL_COLORS = {
  ecmwf_ifs025: '#3b82f6', // blue
  gfs_global: '#ef4444',   // red
  icon_global: '#eab308',  // yellow
  gem_global: '#a855f7',   // purple
  jma_gsm: '#22c55e',      // green
};

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  const day = d.getDate();
  const mon = d.toLocaleString('en', { month: 'short' });
  return `${day} ${mon} ${h}:${m}`;
}

export default function ModelSpreadChart({ wardName }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState({ mean: 0, spread: 0, agreement: 0 });

  useEffect(() => {
    if (!wardName) {
      setData([]);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const fetchData = async () => {
      try {
        // Step 1: Get centroid from our API
        const res1 = await fetch(`/api/forecast/${encodeURIComponent(wardName)}`);
        if (!res1.ok) throw new Error('Failed to fetch ward data');
        const wardInfo = await res1.json();
        const [lat, lon] = wardInfo.centroid;

        // Step 2: Fetch multi-model from Open-Meteo
        const params = new URLSearchParams({
          latitude: lat,
          longitude: lon,
          hourly: 'precipitation',
          models: MODELS.join(','),
          forecast_days: 3,
          timezone: 'auto'
        });
        
        const res2 = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
        if (!res2.ok) throw new Error('Failed to fetch multi-model data');
        const omData = await res2.json();

        if (!isMounted) return;

        const hourly = omData.hourly;
        const times = hourly.time;
        const chartData = [];
        
        let totalSpread = 0;
        let totalMean = 0;
        let validHours = 0;

        for (let i = 0; i < times.length; i++) {
          const row = { time: formatTime(times[i]) };
          let sum = 0;
          let min = Infinity;
          let max = -Infinity;
          let validModels = 0;

          MODELS.forEach(m => {
            const key = `precipitation_${m}`;
            if (hourly[key] && hourly[key][i] !== null) {
              const val = hourly[key][i];
              row[m] = val;
              sum += val;
              if (val < min) min = val;
              if (val > max) max = val;
              validModels++;
            }
          });

          if (validModels > 0) {
            const mean = sum / validModels;
            const spread = max - min;
            row.mean = mean;
            row.spread = spread;
            
            // Only count metrics if there is meaningful rainfall (> 0.1mm)
            if (mean > 0.1) {
              totalSpread += spread;
              totalMean += mean;
              validHours++;
            }
          }
          chartData.push(row);
        }

        setData(chartData);
        
        // Calculate agreement score
        if (validHours > 0) {
          const avgSpread = totalSpread / validHours;
          const avgMean = totalMean / validHours;
          // agreement = 100% if spread is 0. 
          // If spread is equal to the mean, let's say agreement is 50%.
          // If spread is 2x the mean, agreement is 0%.
          const agreement = Math.max(0, Math.min(100, 100 - (avgSpread / (avgMean || 1) * 50)));
          setMetrics({ 
            mean: avgMean, 
            spread: avgSpread, 
            agreement: Math.round(agreement)
          });
        } else {
          setMetrics({ mean: 0, spread: 0, agreement: 100 });
        }

        setLoading(false);
      } catch (err) {
        console.error(err);
        if (isMounted) setLoading(false);
      }
    };

    fetchData();

    return () => { isMounted = false; };
  }, [wardName]);

  if (!wardName) return null;

  let badgeColor = '#ef4444'; // red
  if (metrics.agreement >= 70) badgeColor = '#22c55e'; // green
  else if (metrics.agreement >= 40) badgeColor = '#eab308'; // orange

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Model Spread (Ensemble)</h3>
        {data.length > 0 && !loading && (
          <div style={{ display: 'flex', gap: 12, fontSize: 12 }}>
            <span style={{ color: '#9ca3b8' }}>Avg Spread: <b style={{ color: '#fff' }}>{metrics.spread.toFixed(1)} mm</b></span>
            <span style={{ 
              background: badgeColor, 
              color: '#000', 
              padding: '2px 8px', 
              borderRadius: 12, 
              fontWeight: 'bold' 
            }}>
              {metrics.agreement}% Agreement
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <div className="loading-spinner"></div>
          <p>Loading multi-model data…</p>
        </div>
      ) : data.length === 0 ? (
        <div className="empty-state" style={{ flex: 1 }}>
          <p>No model data available</p>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2f45" />
              <XAxis dataKey="time" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#2a2f45' }} interval="preserveStartEnd" />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#2a2f45' }} />
              <Tooltip 
                contentStyle={{ background: '#1e2235', border: '1px solid #2a2f45', borderRadius: 8 }}
                itemStyle={{ fontSize: 12 }}
                labelStyle={{ color: '#e8eaf0', fontWeight: 'bold', marginBottom: 6 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              
              {MODELS.map(m => (
                <Line key={m} type="monotone" dataKey={m} name={m.split('_')[0].toUpperCase()} stroke={MODEL_COLORS[m]} strokeWidth={1} dot={false} strokeOpacity={0.6} />
              ))}
              <Line type="monotone" dataKey="mean" name="Ensemble Mean" stroke="#fff" strokeWidth={2} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
