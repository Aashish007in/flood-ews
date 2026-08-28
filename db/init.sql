-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Observations from weather stations / APIs
CREATE TABLE IF NOT EXISTS observations (
    id            BIGSERIAL PRIMARY KEY,
    station_id    TEXT NOT NULL,
    geom          GEOMETRY(Point, 4326) NOT NULL,
    rainfall_mm   DOUBLE PRECISION,
    soil_moisture DOUBLE PRECISION,
    river_discharge DOUBLE PRECISION,
    observed_at   TIMESTAMPTZ NOT NULL,
    source        TEXT NOT NULL DEFAULT 'manual',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_obs_station   ON observations (station_id);
CREATE INDEX IF NOT EXISTS idx_obs_time      ON observations (observed_at);
CREATE INDEX IF NOT EXISTS idx_obs_geom      ON observations USING GIST (geom);
-- Dedupe guard: each ingest run backfills the last 48h, so the same
-- (station, hour) is inserted repeatedly. Requires deduping any existing
-- duplicate rows before this index can be created (see DEPLOY notes).
CREATE UNIQUE INDEX IF NOT EXISTS uq_obs_station_time ON observations (station_id, observed_at);

-- Rainfall forecasts (gridded polygons)
CREATE TABLE IF NOT EXISTS rainfall_forecasts (
    id              BIGSERIAL PRIMARY KEY,
    geom            GEOMETRY(Polygon, 4326) NOT NULL,
    forecast_mm_3h  DOUBLE PRECISION NOT NULL,
    lead_hours      INTEGER NOT NULL,
    issued_at       TIMESTAMPTZ NOT NULL,
    model           TEXT NOT NULL DEFAULT 'gfs',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rf_issued ON rainfall_forecasts (issued_at);
CREATE INDEX IF NOT EXISTS idx_rf_geom   ON rainfall_forecasts USING GIST (geom);

-- Inundation model output
CREATE TABLE IF NOT EXISTS inundation (
    id            BIGSERIAL PRIMARY KEY,
    cell_geom     GEOMETRY(Polygon, 4326) NOT NULL,
    depth_m       DOUBLE PRECISION NOT NULL,
    probability   DOUBLE PRECISION NOT NULL DEFAULT 0,
    forecast_time TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inun_time ON inundation (forecast_time);
CREATE INDEX IF NOT EXISTS idx_inun_geom ON inundation USING GIST (cell_geom);

-- Risk zones (ward/area-level summaries, with city grouping)
CREATE TABLE IF NOT EXISTS risk_zones (
    id          SERIAL PRIMARY KEY,
    ward_name   TEXT NOT NULL,
    city        TEXT NOT NULL DEFAULT 'Chennai',
    country     TEXT NOT NULL DEFAULT 'India',
    geom        GEOMETRY(Polygon, 4326) NOT NULL,
    risk_level  TEXT NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW','MODERATE','HIGH','SEVERE')),
    score       DOUBLE PRECISION NOT NULL DEFAULT 0,
    flood_note  TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (city, ward_name)
);
CREATE INDEX IF NOT EXISTS idx_rz_geom ON risk_zones USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_rz_city ON risk_zones (city);

-- Alerts sent to subscribers
CREATE TABLE IF NOT EXISTS alerts (
    id           BIGSERIAL PRIMARY KEY,
    risk_zone_id INTEGER REFERENCES risk_zones(id),
    channel      TEXT NOT NULL DEFAULT 'sms',
    message      TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    sent_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Subscribers who opt in to alerts
CREATE TABLE IF NOT EXISTS subscribers (
    id        SERIAL PRIMARY KEY,
    phone     TEXT NOT NULL UNIQUE,
    name      TEXT,
    zone_ids  INTEGER[] DEFAULT '{}',
    opted_in  BOOLEAN NOT NULL DEFAULT TRUE
);

-- Persisted alert state to avoid duplicate notifications
CREATE TABLE IF NOT EXISTS alert_state (
    zone_id    INTEGER PRIMARY KEY REFERENCES risk_zones(id),
    last_level TEXT NOT NULL DEFAULT 'LOW',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
