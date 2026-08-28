"""
Flood EWS API — FastAPI backend serving GeoJSON + Leaflet map.
Covers major flood-prone cities across South Asia.
"""

import os
import time
import json
import asyncio
import httpx
import random
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

DATABASE_URL = os.environ["DATABASE_URL"]

engine = create_async_engine(DATABASE_URL, echo=False, pool_size=5)
async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

app = FastAPI(title="Floodguard AI API", version="0.3.0")

# Allow the Vercel-hosted frontend to call this API from another domain
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok"}


# ── GET /api/cities → distinct list of cities ─────────────────────────────────
@app.get("/api/cities")
async def get_cities():
    async with async_session() as session:
        result = await session.execute(
            text("SELECT DISTINCT city, country FROM risk_zones ORDER BY country, city")
        )
        rows = result.fetchall()
        return JSONResponse(content=[{"city": r.city, "country": r.country} for r in rows])


# ── GET /api/risk → risk zones as GeoJSON (optional ?city= filter) ────────────
@app.get("/api/risk")
async def get_risk_zones(city: str = Query(default=None)):
    async with async_session() as session:
        if city:
            result = await session.execute(
                text(
                    """
                    SELECT json_build_object(
                        'type', 'FeatureCollection',
                        'features', COALESCE((
                            SELECT json_agg(f)
                            FROM (
                                SELECT json_build_object(
                                    'type', 'Feature',
                                    'properties', json_build_object(
                                        'id', id,
                                        'ward_name', ward_name,
                                        'city', city,
                                        'country', country,
                                        'risk_level', risk_level,
                                        'score', score,
                                        'flood_note', flood_note,
                                        'updated_at', updated_at
                                    ),
                                    'geometry', ST_AsGeoJSON(geom)::json
                                ) AS f
                                FROM risk_zones
                                WHERE city = :city
                                ORDER BY ward_name
                            ) sub
                        ), '[]'::json)
                    ) AS geojson
                    """
                ),
                {"city": city},
            )
        else:
            result = await session.execute(
                text(
                    """
                    SELECT json_build_object(
                        'type', 'FeatureCollection',
                        'features', COALESCE((
                            SELECT json_agg(f)
                            FROM (
                                SELECT json_build_object(
                                    'type', 'Feature',
                                    'properties', json_build_object(
                                        'id', id,
                                        'ward_name', ward_name,
                                        'city', city,
                                        'country', country,
                                        'risk_level', risk_level,
                                        'score', score,
                                        'updated_at', updated_at
                                    ),
                                    'geometry', ST_AsGeoJSON(geom)::json
                                ) AS f
                                FROM risk_zones
                                ORDER BY city, ward_name
                            ) sub
                        ), '[]'::json)
                    ) AS geojson
                    """
                )
            )
        row = result.fetchone()
        return JSONResponse(content=row[0])


# ── GET /api/stations → last 24h observations ────────────────────────────────
@app.get("/api/stations")
async def get_stations():
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    async with async_session() as session:
        result = await session.execute(
            text(
                """
                SELECT station_id,
                       ST_Y(geom) AS lat,
                       ST_X(geom) AS lon,
                       rainfall_mm,
                       soil_moisture,
                       observed_at,
                       source
                FROM observations
                WHERE observed_at >= :since
                ORDER BY observed_at DESC
                """
            ),
            {"since": since},
        )
        rows = result.fetchall()
        data = [
            {
                "station_id": r.station_id,
                "lat": r.lat,
                "lon": r.lon,
                "rainfall_mm": r.rainfall_mm,
                "soil_moisture": r.soil_moisture,
                "observed_at": r.observed_at.isoformat() if r.observed_at else None,
                "source": r.source,
            }
            for r in rows
        ]
        return JSONResponse(content=data)


# ── GET /api/timeseries/{ward} → observed 48h + any forecast ─────────────────
@app.get("/api/timeseries/{ward}")
async def get_timeseries(ward: str, city: str = Query(default=None)):
    since = datetime.now(timezone.utc) - timedelta(hours=48)
    async with async_session() as session:
        # Find the station_id for the city this ward belongs to
        # We match by city to return city-specific observations
        city_filter = ""
        params = {"ward": ward, "since": since}
        if city:
            # Get the station_id for this city from observations
            station_id = f"open-meteo-{city.lower()}"
            city_filter = "AND station_id = :station_id"
            params["station_id"] = station_id

        obs_result = await session.execute(
            text(
                f"""
                SELECT observed_at AS time,
                       rainfall_mm,
                       soil_moisture,
                       'observed' AS kind
                FROM observations
                WHERE observed_at >= :since
                {city_filter}
                ORDER BY observed_at
                """
            ),
            params,
        )
        obs_rows = obs_result.fetchall()

        # Forecast data — rainfall_forecasts that intersect the ward polygon
        fc_result = await session.execute(
            text(
                """
                SELECT rf.issued_at + (rf.lead_hours || ' hours')::interval AS time,
                       rf.forecast_mm_3h AS rainfall_mm,
                       NULL::double precision AS soil_moisture,
                       'forecast' AS kind
                FROM rainfall_forecasts rf
                JOIN risk_zones rz ON ST_Intersects(rf.geom, rz.geom)
                WHERE rz.ward_name = :ward
                  AND rf.issued_at >= :since
                ORDER BY time
                """
            ),
            {"ward": ward, "since": since},
        )
        fc_rows = fc_result.fetchall()

        data = [
            {
                "time": r.time.isoformat() if r.time else None,
                "rainfall_mm": r.rainfall_mm,
                "soil_moisture": r.soil_moisture,
                "kind": r.kind,
            }
            for r in list(obs_rows) + list(fc_rows)
        ]
        # Sort combined by time
        data.sort(key=lambda x: x["time"] or "")
        return JSONResponse(content=data)


# ── GET /api/forecast/{zone_name} → Open-Meteo proxy with caching ─────────────
_cache = {}

@app.get("/api/forecast/{zone_name}")
async def get_forecast(zone_name: str):
    now = time.time()
    
    # Return from cache if valid (15 mins)
    if zone_name in _cache:
        entry = _cache[zone_name]
        if now - entry["ts"] < 900:
            return JSONResponse(content=entry["data"])
            
    async with async_session() as session:
        result = await session.execute(
            text("SELECT city, country, ST_Y(ST_Centroid(geom)) as lat, ST_X(ST_Centroid(geom)) as lon FROM risk_zones WHERE ward_name = :zone_name LIMIT 1"),
            {"zone_name": zone_name}
        )
        row = result.fetchone()
        
    if not row:
        raise HTTPException(status_code=404, detail="Zone not found")
        
    lat, lon = row.lat, row.lon
    
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation,precipitation_probability,soil_moisture_0_to_7cm",
        "forecast_days": 3,
        "timezone": "auto"
    }
    
    try:
        # TIMEOUT ADDED HERE to prevent 502 server hangs
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail="Upstream API error")
            data = resp.json()
    except httpx.RequestError:
        raise HTTPException(status_code=504, detail="Upstream API timeout")
        
    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    precip = hourly.get("precipitation", [])
    
    # Calculate aggregates
    next_24h_mm = sum((p or 0) for p in precip[:24])
    next_48h_mm = sum((p or 0) for p in precip[:48])
    next_72h_mm = sum((p or 0) for p in precip[:72])
    max_hourly = max((p or 0) for p in precip) if precip else 0
    
    # Format hourly series
    hourly_series = []
    for i in range(len(times)):
        hourly_series.append({
            "time": times[i],
            "precipitation": precip[i] if i < len(precip) else 0,
            "probability": hourly.get("precipitation_probability", [])[i] if "precipitation_probability" in hourly else 0,
            "soil_moisture": hourly.get("soil_moisture_0_to_7cm", [])[i] if "soil_moisture_0_to_7cm" in hourly else 0
        })
        
    resp_data = {
        "name": zone_name,
        "country": row.country,
        "centroid": [lat, lon],
        "next_24h_mm": next_24h_mm,
        "next_48h_mm": next_48h_mm,
        "next_72h_mm": next_72h_mm,
        "max_hourly": max_hourly,
        "hourly_series": hourly_series
    }
    
    # Save to cache
    _cache[zone_name] = {"ts": now, "data": resp_data}
    return JSONResponse(content=resp_data)


# ── GET /api/cyclone → Open-Meteo multi-point fetching ────────────────────────
@app.get("/api/cyclone")
async def get_cyclone():
    # 5 coastal points around Chennai
    points = [
        {"lat": 13.08, "lon": 80.27, "name": "Center"},
        {"lat": 13.58, "lon": 80.27, "name": "North"},
        {"lat": 12.58, "lon": 80.27, "name": "South"},
        {"lat": 13.08, "lon": 80.77, "name": "East"},
        {"lat": 13.08, "lon": 79.77, "name": "West"},
    ]
    
    min_pressure = 9999.0
    max_wind_kmh = 0.0
    peak_lat = 13.08
    peak_lon = 80.27
    
    async with httpx.AsyncClient() as client:
        for p in points:
            params = {
                "latitude": p["lat"],
                "longitude": p["lon"],
                "hourly": "pressure_msl,wind_speed_10m",
                "forecast_days": 5,
                "timezone": "auto"
            }
            resp = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
            if resp.status_code == 200:
                data = resp.json().get("hourly", {})
                pressures = data.get("pressure_msl", [])
                winds = data.get("wind_speed_10m", [])
                
                valid_pressures = [x for x in pressures if x is not None]
                valid_winds = [x for x in winds if x is not None]
                
                if valid_pressures and valid_winds:
                    local_min_p = min(valid_pressures)
                    local_max_w = max(valid_winds)
                    
                    if local_min_p < min_pressure or (local_min_p == min_pressure and local_max_w > max_wind_kmh):
                        min_pressure = local_min_p
                        max_wind_kmh = local_max_w
                        peak_lat = p["lat"]
                        peak_lon = p["lon"]

    # Classification per IMD scale (if pressure < 995 and wind > 62)
    threat_level = "NONE"
    category = "None"
    
    if min_pressure < 995 and max_wind_kmh > 62:
        if max_wind_kmh >= 118:
            threat_level = "SEVERE"
            category = "Very Severe Cyclonic Storm"
        elif max_wind_kmh >= 89:
            threat_level = "HIGH"
            category = "Severe Cyclonic Storm"
        elif max_wind_kmh >= 62:
            threat_level = "MODERATE"
            category = "Cyclonic Storm"
    elif min_pressure < 995:
        threat_level = "WATCH"
        category = "Depression"

    return JSONResponse(content={
        "threat_level": threat_level,
        "category": category,
        "max_wind_kmh": max_wind_kmh,
        "min_pressure": min_pressure,
        "peak_coord": [peak_lat, peak_lon]
    })


# ── GET /api/flood-warnings → Inundation GeoJSON ──────────────────────────────
@app.get("/api/flood-warnings")
async def get_flood_warnings():
    since = datetime.now(timezone.utc) - timedelta(hours=6)
    
    async with async_session() as session:
        # Check if we have any data
        count_res = await session.execute(
            text("SELECT COUNT(*) FROM inundation WHERE depth_m > 0.3 AND created_at >= :since"),
            {"since": since}
        )
        count = count_res.scalar()
        
        # TEST DATA: If empty, seed 20 fake flood cells inside Adyar ward
        if count == 0:
            adyar_res = await session.execute(
                text("SELECT geom FROM risk_zones WHERE ward_name = 'Chennai - Adyar' LIMIT 1")
            )
            adyar_row = adyar_res.fetchone()
            
            if adyar_row:
                # Generate 20 fake cells within Adyar polygon bounds
                for _ in range(20):
                    depth = round(random.uniform(0.3, 1.8), 2)
                    # We will just generate random points and buffer them to make polygons
                    await session.execute(
                        text("""
                        INSERT INTO inundation (cell_geom, depth_m, probability, forecast_time, created_at)
                        SELECT ST_Buffer(
                            ST_GeneratePoints(geom, 1),
                            0.001 -- roughly 100m
                        ), :depth, 0.9, NOW(), NOW()
                        FROM risk_zones WHERE ward_name = 'Chennai - Adyar' LIMIT 1
                        """),
                        {"depth": depth}
                    )
                await session.commit()

        # Query all active flood warnings
        result = await session.execute(
            text("""
                SELECT json_build_object(
                    'type', 'FeatureCollection',
                    'features', COALESCE((
                        SELECT json_agg(f)
                        FROM (
                            SELECT json_build_object(
                                'type', 'Feature',
                                'properties', json_build_object(
                                    'id', id,
                                    'depth_m', depth_m,
                                    'forecast_time', forecast_time,
                                    'created_at', created_at
                                ),
                                'geometry', ST_AsGeoJSON(cell_geom)::json
                            ) AS f
                            FROM inundation
                            WHERE depth_m > 0.3 AND created_at >= :since
                        ) sub
                    ), '[]'::json)
                ) AS geojson
            """),
            {"since": since}
        )
        row = result.fetchone()
        return JSONResponse(content=row[0])


# ── GET /api/cyclones → multi-basin cyclone scan (N. Indian Ocean + NW Pacific)
@app.get("/api/cyclones")
async def get_cyclones():
    points = [
        # Bay of Bengal
        {"lat": 13.08, "lon": 80.27, "basin": "Bay of Bengal"},
        {"lat": 16.50, "lon": 85.00, "basin": "Bay of Bengal"},
        {"lat": 10.00, "lon": 88.00, "basin": "Bay of Bengal"},
        {"lat": 19.00, "lon": 90.00, "basin": "Bay of Bengal"},
        {"lat": 8.00,  "lon": 78.00, "basin": "Bay of Bengal"},
        # Arabian Sea
        {"lat": 12.00, "lon": 65.00, "basin": "Arabian Sea"},
        {"lat": 16.00, "lon": 70.00, "basin": "Arabian Sea"},
        {"lat": 20.00, "lon": 68.00, "basin": "Arabian Sea"},
        # NW Pacific
        {"lat": 15.00, "lon": 130.00, "basin": "NW Pacific"},
        {"lat": 20.00, "lon": 135.00, "basin": "NW Pacific"},
        {"lat": 25.00, "lon": 140.00, "basin": "NW Pacific"},
        {"lat": 10.00, "lon": 140.00, "basin": "NW Pacific"},
        {"lat": 18.00, "lon": 125.00, "basin": "NW Pacific"},
        {"lat": 22.00, "lon": 128.00, "basin": "NW Pacific"},
    ]

    async def probe(p):
        params = {
            "latitude": p["lat"],
            "longitude": p["lon"],
            "hourly": "pressure_msl,wind_speed_10m",
            "forecast_days": 5,
            "timezone": "UTC",
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
            if resp.status_code != 200:
                return None
            hourly = resp.json().get("hourly", {})
            pressures = [x for x in hourly.get("pressure_msl", []) if x is not None]
            winds = [x for x in hourly.get("wind_speed_10m", []) if x is not None]
            if not pressures or not winds:
                return None
            return {
                "lat": p["lat"], "lon": p["lon"], "basin": p["basin"],
                "min_pressure": round(min(pressures), 1),
                "max_wind_kmh": round(max(winds), 1),
            }
        except Exception:
            return None

    results = await asyncio.gather(*(probe(p) for p in points))

    candidates = []
    for r in results:
        if not r:
            continue
        if r["max_wind_kmh"] >= 40 or r["min_pressure"] <= 1000:
            candidates.append(r)

    # Sort strongest first, then de-duplicate systems within ~6 degrees of each other
    candidates.sort(key=lambda r: (-r["max_wind_kmh"], r["min_pressure"]))
    systems = []
    for c in candidates:
        if all((abs(c["lat"] - s["lat"]) + abs(c["lon"] - s["lon"])) > 6 for s in systems):
            wind = c["max_wind_kmh"]
            if wind >= 118:
                category, severity = "Very Severe Cyclonic Storm", "SEVERE"
            elif wind >= 89:
                category, severity = "Severe Cyclonic Storm", "HIGH"
            elif wind >= 62:
                category, severity = "Cyclonic Storm", "MODERATE"
            else:
                category, severity = "Depression", "WATCH"
            systems.append({**c, "category": category, "threat_level": severity})

    return JSONResponse(content={"count": len(systems), "systems": systems})


# ── GET /api/western-disturbances → WD scan along Mediterranean→Himalaya track
@app.get("/api/western-disturbances")
async def get_western_disturbances():
    track = [
        {"lat": 37.0, "lon": 55.0, "name": "Caspian approach"},
        {"lat": 36.0, "lon": 62.0, "name": "Afghanistan"},
        {"lat": 35.0, "lon": 68.0, "name": "Hindu Kush"},
        {"lat": 34.0, "lon": 73.0, "name": "N. Pakistan"},
        {"lat": 33.5, "lon": 76.0, "name": "Jammu & Kashmir"},
        {"lat": 32.5, "lon": 78.0, "name": "Himachal Pradesh"},
        {"lat": 30.5, "lon": 79.5, "name": "Uttarakhand"},
        {"lat": 28.5, "lon": 81.0, "name": "W. Nepal / UP"},
    ]

    async def probe(p):
        params = {
            "latitude": p["lat"],
            "longitude": p["lon"],
            "hourly": "pressure_msl,wind_speed_10m,precipitation",
            "forecast_days": 3,
            "timezone": "UTC",
        }
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
            if resp.status_code != 200:
                return None
            hourly = resp.json().get("hourly", {})
            pressures = [x for x in hourly.get("pressure_msl", []) if x is not None]
            winds = [x for x in hourly.get("wind_speed_10m", []) if x is not None]
            precip = [x for x in hourly.get("precipitation", []) if x is not None]
            if not pressures or not winds:
                return None
            return {
                "lat": p["lat"], "lon": p["lon"], "name": p["name"],
                "min_pressure": round(min(pressures), 1),
                "max_wind_kmh": round(max(winds), 1),
                "precip_next_24h": round(sum(precip[:24]), 1) if precip else 0.0,
            }
        except Exception:
            return None

    results = await asyncio.gather(*(probe(p) for p in track))
    nodes = [r for r in results if r]
    # A node is "active" if it shows a low-pressure / windy / wet signature
    active = [
        r for r in nodes
        if r["min_pressure"] <= 1008 or r["max_wind_kmh"] >= 30 or r["precip_next_24h"] >= 1
    ]

    return JSONResponse(content={
        "track": nodes,
        "active": active,
        "count": len(active),
    })


# ── GET /api/inundation/history → Empty stub for now ─────────────────────────
@app.get("/api/inundation/history")
async def get_inundation_history():
    return JSONResponse(content=[])


# ── GET /api/alerts/stats → Empty stub for now ───────────────────────────────
@app.get("/api/alerts/stats")
async def get_alerts_stats():
    return JSONResponse(content={"types": [], "ward_counts": []})


# ── GET /api/mock-cap → Common Alerting Protocol Generator ───────────────────
@app.get("/api/mock-cap")
def generate_mock_cap():
    from fastapi import Response  # Imported here to avoid header conflicts

    now = datetime.now(timezone.utc)
    expiry = now + timedelta(hours=3)

    time_str = now.isoformat(timespec='seconds')
    expiry_str = expiry.isoformat(timespec='seconds')

    cap_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>MOCK-FLOOD-{now.strftime('%Y%m%d%H%M%S')}</identifier>
  <sender>mock-agency@floodguard.ai</sender>
  <sent>{time_str}</sent>
  <status>Exercise</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <category>Met</category>
    <event>Severe Flood Warning</event>
    <responseType>Evacuate</responseType>
    <urgency>Immediate</urgency>
    <severity>Severe</severity>
    <certainty>Observed</certainty>
    <expires>{expiry_str}</expires>
    <headline>Evacuate Immediately: River breaching banks</headline>
    <description>Heavy continuous rainfall has caused critical river overflow. Imminent flooding of residential areas.</description>
    <instruction>Move to higher ground immediately. Do not drive through flooded roads.</instruction>
    <area>
      <areaDesc>Northern District Floodplain</areaDesc>
      <polygon>13.2,80.1 13.3,80.2 13.2,80.3 13.1,80.2 13.2,80.1</polygon>
    </area>
  </info>
</alert>"""

    return Response(content=cap_xml, media_type="application/xml")

