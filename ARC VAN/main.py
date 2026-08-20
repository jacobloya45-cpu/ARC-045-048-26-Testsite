import os
import sqlite3
import urllib.request
import urllib.error
import json
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

import database

app = FastAPI(title="ARC Class 045/048 Shuttle")
database.init_db()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DRIVER_PIN = "045048"
MAX_CAPACITY = 15
NTFY_TOPIC = "arc-van-fort-knox-045048"

def send_ntfy(title: str, message: str) -> bool:
    """Direct synchronous push to ntfy.sh"""
    url = f"https://ntfy.sh/{NTFY_TOPIC}"
    headers = {
        "Title": title.encode("utf-8").decode("latin-1", "ignore"),
        "Priority": "high",
        "Tags": "minibus,round_pushpin",
        "User-Agent": "ARC-Van-Tracker/1.0"
    }
    
    req = urllib.request.Request(
        url,
        data=message.encode("utf-8"),
        headers=headers,
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            print(f"✅ [NTFY SUCCESS] Alert published: '{title}' - Status {resp.status}")
            return True
    except Exception as e:
        print(f"❌ [NTFY ERROR] Failed to send alert: {e}")
        return False

class AlertPayload(BaseModel):
    pin: str
    current_stop: str | None = "Van Route"
    next_stop: str | None = "Van Route"
    eta_mins: int | None = 0
    title: str | None = None
    detail: str | None = None
    location: str | None = None

class RideRequest(BaseModel):
    name: str
    email: str | None = None
    pickup: str
    dropoff: str

class AlertSignup(BaseModel):
    name: str
    email: str

class UpdateStatus(BaseModel):
    pin: str
    request_id: int | None = 0
    new_status: str | None = ""

class DriverRequestQuery(BaseModel):
    pin: str

class ButtonPress(BaseModel):
    label: str
    view: str | None = None

@app.get("/healthz")
def health():
    return {"status": "healthy"}

@app.post("/api/button-press")
def button_press(press: ButtonPress):
    return {"success": True}

@app.get("/api/alerts/latest")
def latest_alert():
    return database.get_latest_alert() or {"id": 0, "title": "No new alerts", "detail": "", "location": None, "created_at": ""}

@app.get("/api/status")
def get_status():
    status = database.get_queue_data()
    status["walking_count"] = database.get_walking_count()
    return status

@app.post("/api/driver/requests")
def driver_requests(payload: DriverRequestQuery):
    if payload.pin != DRIVER_PIN:
        raise HTTPException(status_code=403, detail="Invalid Driver PIN")
    return {"requests": database.get_queue_data()["manifest"]}

# 🚨 DIRECT DRIVER BROADCAST HANDLER
@app.post("/api/driver/broadcast")
def broadcast_alert(alert: AlertPayload):
    if alert.pin != DRIVER_PIN:
        raise HTTPException(status_code=403, detail="Invalid Driver PIN")

    subject = alert.title or f"Van Location: {alert.current_stop}"
    body = alert.detail or f"045/048 Van is currently at {alert.current_stop}."

    # Save to local SQLite database
    database.save_alert(subject, body, alert.location or alert.current_stop)

    # Push directly to Ntfy
    send_ntfy(subject, body)

    return {"success": True}

@app.post("/api/alerts/signup")
def signup_for_alerts(signup: AlertSignup):
    conn = sqlite3.connect(database.DB_NAME)
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO users (email) VALUES (?)", (signup.email.lower(),))
    conn.commit()
    conn.close()
    send_ntfy("New Alert Signup", f"{signup.name} signed up for alerts.")
    return {"success": True}

@app.post("/api/request-ride")
def request_ride(req: RideRequest):
    conn = sqlite3.connect(database.DB_NAME)
    cursor = conn.cursor()
    request_email = req.email or f"ride-{os.urandom(4).hex()}@arc-van.local"
    cursor.execute("INSERT OR IGNORE INTO users (email) VALUES (?)", (request_email.lower(),))
    cursor.execute("SELECT id FROM users WHERE email = ?", (request_email.lower(),))
    user_id = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM requests WHERE status IN ('CONFIRMED', 'BOARDED')")
    active_count = cursor.fetchone()[0]
    assigned_status = "CONFIRMED" if active_count < MAX_CAPACITY else "WAITLIST"

    cursor.execute(
        "INSERT INTO requests (user_id, pickup, dropoff, status) VALUES (?, ?, ?, ?)",
        (user_id, req.pickup, req.dropoff, assigned_status)
    )
    conn.commit()
    conn.close()
    send_ntfy("New Ride Request", f"{req.name} requested pickup at {req.pickup} to {req.dropoff}.")
    return {"status": assigned_status}

@app.post("/api/student/heading-to-van")
def heading_to_van(signup: AlertSignup):
    conn = sqlite3.connect(database.DB_NAME)
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO users (email) VALUES (?)", (signup.email.lower(),))
    conn.commit()
    cursor.execute("SELECT id FROM users WHERE email = ?", (signup.email.lower(),))
    user_id = cursor.fetchone()[0]
    cursor.execute("INSERT INTO walking_to_van (user_id) VALUES (?)", (user_id,))
    conn.commit()
    conn.close()
    send_ntfy("Student Walking to Van", f"{signup.name} is on the way to the van.")
    return {"success": True}

@app.post("/api/driver/clear-walking")
def clear_walking(payload: UpdateStatus):
    if payload.pin != DRIVER_PIN:
        raise HTTPException(status_code=403, detail="Invalid Driver PIN")
    database.clear_walking_to_van()
    return {"success": True}

@app.get("/")
def serve_index():
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

@app.get("/style.css")
def serve_css():
    return FileResponse(os.path.join(BASE_DIR, "style.css"))

@app.get("/app.js")
def serve_js():
    return FileResponse(os.path.join(BASE_DIR, "app.js"))
