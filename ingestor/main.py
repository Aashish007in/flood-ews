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
    return psycopg2.connect(DATABASE_URL, connect_timeout=10)


def ingest_city(cur, city_key: str) -> int:
    """Fetch from Open-Meteo for one city and insert into observations.

    Returns the number of rows staged for insert.
    """
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
    return len(values)


def ingest() -> bool:
    """Fetch from Open-Meteo for ALL cities and upsert into observations.

    Returns True only if the DB write succeeded and at least one city
    produced rows — callers (GitHub Actions) rely on this to fail loudly.
    """
    log.info("Starting ingestion cycle for %d cities …", len(CITIES))

    try:
        conn = get_conn()
    except Exception:
        log.exception("Could not connect to database — ingestion aborted")
        return False
    cur = conn.cursor()

    ok_cities: list[str] = []
    failed_cities: list[str] = []
    total_rows = 0
    for city_key in CITIES:
        try:
            total_rows += ingest_city(cur, city_key)
            ok_cities.append(city_key)
        except Exception as e:
            log.exception("  [%s] Failed — skipping (%s)", city_key, e)
            failed_cities.append(city_key)

    try:
        conn.commit()
    except Exception:
        log.exception("Commit failed — no data persisted")
        conn.rollback()
        return False
    finally:
        cur.close()
        conn.close()

    log.info(
        "Ingestion cycle complete: %d rows from %d/%d cities (failed: %s)",
        total_rows, len(ok_cities), len(CITIES), failed_cities or "none",
    )
    return total_rows > 0 and not failed_cities


def main():
    log.info("=== Floodguard AI Ingestor starting (%d cities) ===", len(CITIES))

    # One-shot mode: `python main.py --once` (used by free GitHub Actions cron)
    if "--once" in sys.argv:
        ok = ingest()
        sys.exit(0 if ok else 1)

    # Run immediately on startup
    ingest()

    # Then every 30 minutes
    schedule.every(30).minutes.do(ingest)

    while True:
        schedule.run_pending()
        time.sleep(10)


if __name__ == "__main__":
    main()
