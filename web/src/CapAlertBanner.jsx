import { useEffect, useState } from 'react';

const CAP_URL = 'https://flood-ews.onrender.com/api/mock-cap';

/**
 * CAP Emergency Alert Banner.
 * Fetches the Common Alerting Protocol XML feed, parses out the
 * headline / urgency / severity fields, and — if the alert urgency is
 * "Immediate" — floats a compact warning badge at the top-center of the
 * map UI. Silently renders nothing if the feed is unreachable or the
 * urgency is lower than Immediate.
 */
export default function CapAlertBanner() {
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCap() {
      try {
        const res = await fetch(CAP_URL);
        if (!res.ok) throw new Error(`CAP fetch failed with status ${res.status}`);
        const xmlText = await res.text();

        const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        if (doc.querySelector('parsererror')) throw new Error('Invalid CAP XML received');

        const get = (tag) =>
          doc.getElementsByTagName(tag)[0]?.textContent?.trim() || '';

        const headline = get('headline');
        const urgency = get('urgency');
        const severity = get('severity');

        if (!cancelled && urgency === 'Immediate' && headline) {
          setAlert({ headline, urgency, severity });
        } else if (!cancelled) {
          setAlert(null);
        }
      } catch (err) {
        console.error('CAP alert fetch/parse error:', err);
        if (!cancelled) setAlert(null);
      }
    }

    fetchCap();
    // Re-check the feed every 5 minutes so the banner tracks live alerts
    const interval = setInterval(fetchCap, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!alert) return null;

  return (
    <div className="cap-alert-banner" role="alert">
      <span className="cap-triangle-wrap">
        <span className="cap-triangle" />
        <span className="cap-siren">🚨</span>
      </span>
      <span className="cap-headline">{alert.headline}</span>
    </div>
  );
}
