"""
Open-Meteo API client for South Asian flood-prone cities.
No API key required — uses the free tier.
"""

import httpx
from datetime import datetime, timezone

API_URL = "https://api.open-meteo.com/v1/forecast"
FLOOD_API_URL = "https://flood-api.open-meteo.com/v1/flood"

# Major flood-prone cities across South Asia
CITIES = {
    # India
    "chennai":    {"lat": 13.08,  "lon": 80.27,  "tz": "Asia/Kolkata",    "country": "India"},
    "mumbai":     {"lat": 19.08,  "lon": 72.88,  "tz": "Asia/Kolkata",    "country": "India"},
    "kolkata":    {"lat": 22.57,  "lon": 88.36,  "tz": "Asia/Kolkata",    "country": "India"},
    "patna":      {"lat": 25.61,  "lon": 85.14,  "tz": "Asia/Kolkata",    "country": "India"},
    "guwahati":   {"lat": 26.14,  "lon": 91.74,  "tz": "Asia/Kolkata",    "country": "India"},
    "hyderabad":  {"lat": 17.39,  "lon": 78.49,  "tz": "Asia/Kolkata",    "country": "India"},
    "kochi":      {"lat": 9.93,   "lon": 76.27,  "tz": "Asia/Kolkata",    "country": "India"},
    # Bangladesh
    "dhaka":      {"lat": 23.81,  "lon": 90.41,  "tz": "Asia/Dhaka",      "country": "Bangladesh"},
    "chittagong": {"lat": 22.34,  "lon": 91.78,  "tz": "Asia/Dhaka",      "country": "Bangladesh"},
    "sylhet":     {"lat": 24.90,  "lon": 91.87,  "tz": "Asia/Dhaka",      "country": "Bangladesh"},
    # Pakistan
    "karachi":    {"lat": 24.86,  "lon": 67.01,  "tz": "Asia/Karachi",    "country": "Pakistan"},
    "lahore":     {"lat": 31.55,  "lon": 74.35,  "tz": "Asia/Karachi",    "country": "Pakistan"},
    # Sri Lanka
    "colombo":    {"lat": 6.93,   "lon": 79.85,  "tz": "Asia/Colombo",    "country": "Sri Lanka"},
    # Nepal
    "kathmandu":  {"lat": 27.72,  "lon": 85.32,  "tz": "Asia/Kathmandu",  "country": "Nepal"},
}


def fetch_hourly_data(city_key: str) -> list[dict]:
    """
    Fetch hourly precipitation + soil moisture for a given city.
    Returns a list of dicts, one per hourly slot:
    {
        "time": "2024-01-01T00:00",
        "precipitation": 0.0,
        "soil_moisture": 0.12
    }
    """
    city = CITIES[city_key]
    params = {
        "latitude": city["lat"],
        "longitude": city["lon"],
        "hourly": "precipitation,soil_moisture_0_to_7cm",
        "timezone": city["tz"],
    }

    # Fetch Weather Data
    resp = httpx.get(API_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    # Fetch Flood Data (Daily River Discharge)
    flood_params = {
        "latitude": city["lat"],
        "longitude": city["lon"],
        "daily": "river_discharge",
        "timezone": city["tz"],
    }
    flood_resp = httpx.get(FLOOD_API_URL, params=flood_params, timeout=30)
    flood_resp.raise_for_status()
    flood_data = flood_resp.json()

    print(f"Rainfall Data for {city_key}:", data.keys())
    print(f"Flood Data for {city_key}:", flood_data.keys())

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    precip = hourly.get("precipitation", [])
    soil = hourly.get("soil_moisture_0_to_7cm", [])
    
    daily_flood = flood_data.get("daily", {})
    flood_times = daily_flood.get("time", [])
    river_discharge = daily_flood.get("river_discharge", [])
    
    # Create a mapping of YYYY-MM-DD to river_discharge
    discharge_map = {}
    for i, t in enumerate(flood_times):
        # t is 'YYYY-MM-DD'
        discharge_map[t] = river_discharge[i] if i < len(river_discharge) else None

    rows = []
    for i, t in enumerate(times):
        # t is 'YYYY-MM-DDTHH:MM'
        day_str = t.split("T")[0]
        rows.append(
            {
                "time": t,
                "precipitation": precip[i] if i < len(precip) else None,
                "soil_moisture": soil[i] if i < len(soil) else None,
                "river_discharge": discharge_map.get(day_str)
            }
        )
    return rows
