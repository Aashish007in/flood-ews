import requests
import logging

logger = logging.getLogger(__name__)

# Jasmin's default HTTP API is usually on port 1401
# Since docker-compose named the service `jasmin`, we hit http://jasmin:1401/send
JASMIN_API_URL = "http://jasmin:1401/send"

def send_sms(to: str, message: str) -> bool:
    """
    Sends an SMS via the Jasmin HTTP API.
    Since we don't have a real Jasmin config yet, we will log the attempt
    and make the request (which will likely get a 403/auth error unless configured,
    but it proves the integration).
    """
    params = {
        "username": "flood_admin",
        "password": "changeme",
        "to": to,
        "content": message
    }
    
    logger.info(f"Attempting to send SMS to {to}: '{message}'")
    try:
        response = requests.get(JASMIN_API_URL, params=params, timeout=5)
        logger.info(f"Jasmin API responded with status {response.status_code}: {response.text.strip()}")
        # Jasmin normally returns "Success" or error message string.
        # We'll consider 200 a technical success for our stub, even if auth fails.
        return response.status_code == 200
    except requests.exceptions.RequestException as e:
        logger.error(f"Failed to connect to Jasmin API: {e}")
        return False

def trigger_siren(zone_id: int):
    """
    STUB: Triggers physical sirens via MQTT or similar hardware protocol.
    Skipped for now per requirements.
    """
    logger.info(f"[STUB] Sirens would be triggered for zone {zone_id} here.")
    pass
