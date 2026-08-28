import os
import random
import psycopg2

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://flood:changeme123@postgres:5432/flood_ews"
)

# 34 zones provided by user
CITIES = [
    # INDIA
    {"name": "Mumbai - Kurla/Ward East", "city": "Mumbai", "country": "India", "centroid": (19.072, 72.889), "risk_level": "SEVERE", "score": 0.92, "note": "2005 floods, Mithi River, extreme monsoon"},
    {"name": "Mumbai - Andheri/West suburbs", "city": "Mumbai", "country": "India", "centroid": (19.136, 72.855), "risk_level": "HIGH", "score": 0.75, "note": ""},
    {"name": "Chennai - Adyar", "city": "Chennai", "country": "India", "centroid": (13.001, 80.256), "risk_level": "SEVERE", "score": 0.90, "note": "2015 flood, river mouth"},
    {"name": "Chennai - Velachery", "city": "Chennai", "country": "India", "centroid": (12.981, 80.221), "risk_level": "SEVERE", "score": 0.88, "note": "lake bed"},
    {"name": "Kolkata - Central", "city": "Kolkata", "country": "India", "centroid": (22.573, 88.364), "risk_level": "HIGH", "score": 0.78, "note": "Ganges delta, cyclones (Amphan)"},
    {"name": "Hyderabad - Central", "city": "Hyderabad", "country": "India", "centroid": (17.385, 78.486), "risk_level": "HIGH", "score": 0.72, "note": "2020 floods, old lake beds"},
    {"name": "Bengaluru - IT Corridor", "city": "Bengaluru", "country": "India", "centroid": (12.972, 77.594), "risk_level": "MODERATE", "score": 0.55, "note": "2022 IT-corridor floods"},
    {"name": "Ahmedabad - Central", "city": "Ahmedabad", "country": "India", "centroid": (23.022, 72.571), "risk_level": "MODERATE", "score": 0.50, "note": "Sabarmati, monsoon waterlogging"},
    {"name": "Patna - Central", "city": "Patna", "country": "India", "centroid": (25.594, 85.137), "risk_level": "SEVERE", "score": 0.85, "note": "Ganges/Kosi, 2019 floods"},
    {"name": "Guwahati - Central", "city": "Guwahati", "country": "India", "centroid": (26.144, 91.736), "risk_level": "SEVERE", "score": 0.87, "note": "Brahmaputra, annual floods"},
    {"name": "Srinagar - Central", "city": "Srinagar", "country": "India", "centroid": (34.083, 74.797), "risk_level": "HIGH", "score": 0.70, "note": "Jhelum, 2014 flood"},
    {"name": "Kochi - Central", "city": "Kochi", "country": "India", "centroid": (9.931, 76.267), "risk_level": "HIGH", "score": 0.68, "note": "2018 Kerala floods, backwaters"},
    {"name": "Surat - Central", "city": "Surat", "country": "India", "centroid": (21.170, 72.831), "risk_level": "SEVERE", "score": 0.83, "note": "Tapti, 2006 flood"},
    {"name": "Delhi - Yamuna floodplain", "city": "Delhi", "country": "India", "centroid": (28.613, 77.290), "risk_level": "HIGH", "score": 0.72, "note": "2023 Yamuna flood"},
    {"name": "Jaipur - Central", "city": "Jaipur", "country": "India", "centroid": (26.912, 75.787), "risk_level": "LOW", "score": 0.30, "note": ""},
    {"name": "Lucknow - Central", "city": "Lucknow", "country": "India", "centroid": (26.846, 80.946), "risk_level": "MODERATE", "score": 0.48, "note": "Gomti"},
    {"name": "Bhopal - Central", "city": "Bhopal", "country": "India", "centroid": (23.259, 77.412), "risk_level": "LOW", "score": 0.32, "note": ""},
    {"name": "Visakhapatnam - Central", "city": "Visakhapatnam", "country": "India", "centroid": (17.686, 83.218), "risk_level": "HIGH", "score": 0.65, "note": "cyclones, coastal"},
    {"name": "Bhubaneswar - Central", "city": "Bhubaneswar", "country": "India", "centroid": (20.296, 85.824), "risk_level": "HIGH", "score": 0.70, "note": "cyclones (Fani), delta"},

    # BANGLADESH
    {"name": "Dhaka - Central", "city": "Dhaka", "country": "Bangladesh", "centroid": (23.810, 90.412), "risk_level": "SEVERE", "score": 0.95, "note": "delta, monsoon drainage collapse"},
    {"name": "Chattogram - Central", "city": "Chattogram", "country": "Bangladesh", "centroid": (22.356, 91.783), "risk_level": "SEVERE", "score": 0.88, "note": "cyclones, coastal surge"},
    {"name": "Khulna - Central", "city": "Khulna", "country": "Bangladesh", "centroid": (22.845, 89.540), "risk_level": "HIGH", "score": 0.80, "note": "sea-level rise, Sundarbans edge"},
    {"name": "Sylhet - Central", "city": "Sylhet", "country": "Bangladesh", "centroid": (24.894, 91.868), "risk_level": "SEVERE", "score": 0.90, "note": "2022 flash floods, Surma River"},
    {"name": "Rajshahi - Central", "city": "Rajshahi", "country": "Bangladesh", "centroid": (24.374, 88.604), "risk_level": "MODERATE", "score": 0.50, "note": ""},

    # PAKISTAN
    {"name": "Karachi - Central", "city": "Karachi", "country": "Pakistan", "centroid": (24.860, 67.001), "risk_level": "SEVERE", "score": 0.85, "note": "2020/2022 urban floods, monsoon"},
    {"name": "Lahore - Central", "city": "Lahore", "country": "Pakistan", "centroid": (31.549, 74.343), "risk_level": "HIGH", "score": 0.70, "note": "Ravi River, 2022 floods"},
    {"name": "Islamabad - Central", "city": "Islamabad", "country": "Pakistan", "centroid": (33.684, 73.047), "risk_level": "MODERATE", "score": 0.50, "note": "2022 hill torrents nearby"},
    {"name": "Peshawar - Central", "city": "Peshawar", "country": "Pakistan", "centroid": (34.015, 71.580), "risk_level": "MODERATE", "score": 0.55, "note": "2022 Swat valley flooding"},
    {"name": "Multan - Central", "city": "Multan", "country": "Pakistan", "centroid": (30.196, 71.475), "risk_level": "HIGH", "score": 0.68, "note": "Indus basin, 2022 super flood"},

    # NEPAL
    {"name": "Kathmandu - Central", "city": "Kathmandu", "country": "Nepal", "centroid": (27.717, 85.324), "risk_level": "HIGH", "score": 0.70, "note": "Bagmati, glacial-lake outburst risk"},
    {"name": "Biratnagar - Central", "city": "Biratnagar", "country": "Nepal", "centroid": (26.452, 87.271), "risk_level": "HIGH", "score": 0.75, "note": "Terai plains, Koshi floods"},

    # SRI LANKA
    {"name": "Colombo - Central", "city": "Colombo", "country": "Sri Lanka", "centroid": (6.927, 79.861), "risk_level": "HIGH", "score": 0.72, "note": "annual monsoon floods, Kelani River"},
    {"name": "Galle - Central", "city": "Galle", "country": "Sri Lanka", "centroid": (6.053, 80.221), "risk_level": "MODERATE", "score": 0.55, "note": "southwest monsoon"},

    # BHUTAN
    {"name": "Thimphu - Central", "city": "Thimphu", "country": "Bhutan", "centroid": (27.472, 89.639), "risk_level": "MODERATE", "score": 0.45, "note": "flash floods, GLOF risk"},
]

def generate_irregular_polygon(lat, lon, size_km=3.0):
    """
    Generate an irregular polygon ~size_km across around (lat, lon).
    1 degree is ~111km. size_km/111 is the rough degree offset.
    We'll create 5-8 vertices with some random jitter.
    """
    import math
    base_offset = size_km / 111.0 / 2.0
    
    num_points = random.randint(5, 8)
    points = []
    
    # Generate points in a circle around the centroid, adding random noise to radius
    for i in range(num_points):
        angle = (2 * math.pi * i) / num_points
        # Randomize radius by +/- 30%
        radius_jitter = base_offset * random.uniform(0.7, 1.3)
        # Lat/Lon scale factor approx: cos(lat)
        lon_scale = math.cos(math.radians(lat))
        
        p_lat = lat + radius_jitter * math.sin(angle)
        p_lon = lon + (radius_jitter * math.cos(angle)) / lon_scale
        points.append((p_lon, p_lat))
    
    # Close the polygon
    points.append(points[0])
    
    # Create WKT
    coords_str = ", ".join([f"{p[0]:.5f} {p[1]:.5f}" for p in points])
    return f"POLYGON(({coords_str}))"

def seed_db():
    print(f"Connecting to {DATABASE_URL} ...")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    
    print("Clearing existing risk_zones...")
    cur.execute("TRUNCATE TABLE risk_zones CASCADE;")
    
    for z in CITIES:
        geom_wkt = generate_irregular_polygon(z["centroid"][0], z["centroid"][1], size_km=random.uniform(2.5, 4.0))
        
        cur.execute("""
            INSERT INTO risk_zones (ward_name, city, country, geom, risk_level, score, flood_note)
            VALUES (%s, %s, %s, ST_GeomFromText(%s, 4326), %s, %s, %s)
            ON CONFLICT DO NOTHING
        """, (z["name"], z["city"], z["country"], geom_wkt, z["risk_level"], z["score"], z["note"]))
        
        print(f"Inserted {z['name']} ({z['city']}, {z['country']})")
    
    conn.commit()
    cur.close()
    conn.close()
    print("Seeding complete.")

if __name__ == "__main__":
    seed_db()
