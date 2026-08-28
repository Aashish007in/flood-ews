"""
Ingestor: fetches weather data from Open-Meteo every 30 minutes
for all major flood-prone cities across South Asia.
"""

import os
import sys
import time
import logging
import schedule
import psycopg2
from psycopg2.extras import execute_values
from open_meteo import fetch_hourly_data, CITIES

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("ingestor")

DATABASE_URL = os.environ["DATABASE_URL"]


def get_conn():
    return psycopg2.connect(DATABASE_URL)


def ingest_city(cur, city_key: str):
    """Fetch from Open-Meteo for one city and insert into observations."""
    city = CITIES[city_key]
    lat, lon = city["lat"], city["lon"]
    station_id = f"open-meteo-{city_key}"

    rows = fetch_hourly_data(city_key)
    log.info("  [%s] Fetched %d hourly rows", city_key, len(rows))

    values = []
    for r in rows:
        if r["precipitation"] is None:
            continue
        values.append(
            (
                station_id,
                f"SRID=4326;POINT({lon} {lat})",
                r["precipitation"],
                r["soil_moisture"],
                r["river_discharge"],
                r["time"],
                "open-meteo",
            )
        )

    if values:
        execute_values(
            cur,
            """
            INSERT INTO observations
                (station_id, geom, rainfall_mm, soil_moisture, river_discharge, observed_at, source)
            VALUES %s
            ON CONFLICT DO NOTHING
            """,
            values,
            template="(%s, ST_GeomFromEWKT(%s), %s, %s, %s, %s)",
        )
        log.info("  [%s] Inserted/skipped %d rows", city_key, len(values))
    else:
        log.warning("  [%s] No valid rows to insert", city_key)


def ingest():
    """Fetch from Open-Meteo for ALL cities and upsert into observations."""
    log.info("Starting ingestion cycle for %d cities …", len(CITIES))
    try:
        conn = get_conn()
        cur = conn.cursor()

        for city_key in CITIES:
            try:
                ingest_city(cur, city_key)
            except Exception:
                log.exception("  [%s] Failed — skipping", city_key)

        conn.commit()
        cur.close()
        conn.close()
        log.info("Ingestion cycle complete.")
    except Exception:
        log.exception("Ingestion cycle failed")


def main():
    log.info("=== Floodguard AI Ingestor starting (%d cities) ===", len(CITIES))

    # One-shot mode: `python main.py --once` (used by free GitHub Actions cron)
    if "--once" in sys.argv:
        ingest()
        return

    # Run immediately on startup
    ingest()

    # Then every 30 minutes
    schedule.every(30).minutes.do(ingest)

    while True:
        schedule.run_pending()
        time.sleep(10)


if __name__ == "__main__":
    main()
