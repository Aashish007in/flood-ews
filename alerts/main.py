import os
import time
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime, timezone, timedelta
from sender import send_sms, trigger_siren

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://flood:changeme123@postgres:5432/flood_ews")
POLL_INTERVAL_SEC = 300  # 5 minutes
DEDUPE_HOURS = 3

def get_db_connection():
    while True:
        try:
            conn = psycopg2.connect(DATABASE_URL)
            return conn
        except psycopg2.OperationalError as e:
            logger.warning(f"Database connection failed, retrying in 5 seconds... ({e})")
            time.sleep(5)

def poll_and_alert():
    conn = get_db_connection()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Find zones that are currently HIGH or SEVERE
            cur.execute("""
                SELECT id, ward_name, city, country, risk_level
                FROM risk_zones
                WHERE risk_level IN ('HIGH', 'SEVERE')
            """)
            high_risk_zones = cur.fetchall()

            for zone in high_risk_zones:
                zone_id = zone['id']
                level = zone['risk_level']
                ward = zone['ward_name']
                city = zone['city']

                # Check if we already sent an alert for this zone + level in the last 3 hours
                cutoff_time = datetime.now(timezone.utc) - timedelta(hours=DEDUPE_HOURS)
                
                cur.execute("""
                    SELECT id FROM alerts
                    WHERE risk_zone_id = %s 
                      AND message LIKE %s
                      AND created_at >= %s
                """, (zone_id, f"%{level}%", cutoff_time))
                
                if cur.fetchone():
                    logger.debug(f"Skipping {ward} - alert for {level} already sent in last {DEDUPE_HOURS} hours.")
                    continue

                # Trigger Siren stub
                trigger_siren(zone_id)

                # Fetch subscribers who opted in for this zone
                # (For simplicity, if zone_ids array contains zone_id, OR if zone_ids is empty meaning global)
                cur.execute("""
                    SELECT phone, name FROM subscribers
                    WHERE opted_in = TRUE 
                      AND (%s = ANY(zone_ids) OR array_length(zone_ids, 1) IS NULL)
                """, (zone_id,))
                
                subscribers = cur.fetchall()
                if not subscribers:
                    logger.info(f"No subscribers found for zone {ward}. (Simulating 1 default subscriber)")
                    # Mock a subscriber if none exist so we can demonstrate sending
                    subscribers = [{'phone': '+919999999999', 'name': 'Admin'}]

                for sub in subscribers:
                    phone = sub['phone']
                    name = sub.get('name', 'Resident')
                    message = f"URGENT: {level} flood risk in {ward}, {city}. Please take precautions."
                    
                    # Send SMS via Jasmin
                    success = send_sms(phone, message)
                    
                    # Log the alert to the database
                    status = 'sent' if success else 'failed'
                    cur.execute("""
                        INSERT INTO alerts (risk_zone_id, channel, message, status, sent_at)
                        VALUES (%s, 'sms', %s, %s, %s)
                    """, (zone_id, message, status, datetime.now(timezone.utc) if success else None))
                    
                    logger.info(f"Alert {status} for {ward} to {phone}.")
            
            conn.commit()
    except Exception as e:
        logger.error(f"Error during poll_and_alert: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    logger.info("Starting Flood EWS Alerting Service...")
    # Give the DB time to initialize completely
    time.sleep(10)
    
    while True:
        poll_and_alert()
        logger.info(f"Sleeping for {POLL_INTERVAL_SEC} seconds...")
        time.sleep(POLL_INTERVAL_SEC)
