from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr
import sqlite3
import os
import uuid
import urllib.request
import urllib.error
import database

app = FastAPI(title="ARC Class 045/048 Shuttle")
database.init_db()

DRIVER_PIN = "045048"
MAX_CAPACITY = 15
NTFY_SERVER = os.getenv("NTFY_SERVER", "https://ntfy.sh").rstrip("/")
DEFAULT_NTFY_TOPIC = "ViylM4A5cfMQgIYQ"
NTFY_DRIVER_TOPIC = os.getenv("NTFY_DRIVER_TOPIC", "").strip() or DEFAULT_NTFY_TOPIC
NTFY_STUDENT_TOPIC = os.getenv("NTFY_STUDENT_TOPIC", "").strip() or DEFAULT_NTFY_TOPIC

class RideRequest(BaseModel):
    name: str
    email: EmailStr | None = None
    pickup: str
    dropoff: str

class AlertPayload(BaseModel):
    pin: str
    current_stop: str
    next_stop: str
    eta_mins: int
    title: str | None = None
    detail: str | None = None
    location: str | None = None

class AlertSignup(BaseModel):
    name: str
    email: EmailStr

class UpdateStatus(BaseModel):
    pin: str
    request_id: int
    new_status: str

class DriverRequestQuery(BaseModel):
    pin: str

class ButtonPress(BaseModel):
    label: str
    view: str | None = None

def publish_ntfy(topic: str, title: str, message: str):
    if not topic:
        return
    header_title = title.encode("ascii", "ignore").decode("ascii") or "ARC Van notification"
    request = urllib.request.Request(
        f"{NTFY_SERVER}/{topic}",
        data=message.encode("utf-8"),
        headers={"Title": header_title, "Priority": "high", "Tags": "bus"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8):
            pass
    except (urllib.error.URLError, TimeoutError, UnicodeError) as error:
        print(f"[NTFY NOTIFICATION FAILED] {error}")


def publish_to_configured_topics(title: str, message: str):
    publish_ntfy(NTFY_STUDENT_TOPIC, title, message)
    if NTFY_DRIVER_TOPIC != NTFY_STUDENT_TOPIC:
        publish_ntfy(NTFY_DRIVER_TOPIC, title, message)


@app.post("/api/button-press")
def button_press(press: ButtonPress, bg: BackgroundTasks):
    label = press.label.strip()[:100] or "Unnamed button"
    view = press.view.strip() if press.view else "unknown"
    bg.add_task(
        publish_to_configured_topics,
        f"045/048 Van button pressed: {label}",
        f"A button was pressed in the {view} view: {label}.",
    )
    return {"success": True}


def trigger_mass_alert(subject: str, message: str):
    conn = sqlite3.connect(database.DB_NAME)
    cursor = conn.cursor()
    cursor.execute("SELECT email FROM users")
    recipients = [row[0] for row in cursor.fetchall()]
    conn.close()
    print(f"\n📢 [MASS ALERT SENT TO {len(recipients)} REGISTERED STUDENTS]")
    print(f"Subject: {subject}\nMessage: {message}\n" + "-" * 40)

@app.get("/api/alerts/latest")
def latest_alert():
    return database.get_latest_alert() or {"id": 0, "title": "No new alerts", "detail": "", "location": None, "created_at": ""}

@app.post("/api/alerts/signup")
def signup_for_alerts(signup: AlertSignup):
    conn = sqlite3.connect(database.DB_NAME)
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO users (email) VALUES (?)", (signup.email.lower(),))
    conn.commit()
    conn.close()
    publish_ntfy(
        NTFY_DRIVER_TOPIC,
        "New 045/048 Van alert signup",
        f"{signup.name} signed up for 045/048 Van alerts.",
    )
    return {"success": True}

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

@app.post("/api/request-ride")
def request_ride(req: RideRequest):
    conn = sqlite3.connect(database.DB_NAME)
    cursor = conn.cursor()
    request_email = req.email or f"ride-{uuid.uuid4().hex}@arc-van.local"
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
    publish_ntfy(
        NTFY_DRIVER_TOPIC,
        "New 045/048 Van ride request",
        f"{req.name} requested a ride from {req.pickup} to {req.dropoff} ({assigned_status}).",
    )
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
    publish_ntfy(
        NTFY_DRIVER_TOPIC,
        "Student heading to 045/048 Van",
        f"{signup.name} is heading to the 045/048 Van.",
    )
    return {"success": True}

@app.post("/api/driver/clear-walking")
def clear_walking(payload: UpdateStatus):
    if payload.pin != DRIVER_PIN:
        raise HTTPException(status_code=403, detail="Invalid Driver PIN")
    database.clear_walking_to_van()
    return {"success": True}

@app.post("/api/driver/broadcast")
def broadcast_alert(alert: AlertPayload, bg: BackgroundTasks):
    if alert.pin != DRIVER_PIN:
        raise HTTPException(status_code=403, detail="Invalid Driver PIN")
    subject = "ARC Van Pickup Alert"
    body = alert.detail or f"15-PAX Van is at {alert.current_stop}, departing in {alert.eta_mins} mins for {alert.next_stop}."
    database.save_alert(alert.title or "ARC Van update", body, alert.location)
    publish_to_configured_topics(alert.title or subject, body)
    bg.add_task(trigger_mass_alert, subject, body)
    return {"success": True}

@app.post("/api/driver/update-status")
def update_status(payload: UpdateStatus):
    if payload.pin != DRIVER_PIN:
        raise HTTPException(status_code=403, detail="Invalid Driver PIN")
    conn = sqlite3.connect(database.DB_NAME)
    cursor = conn.cursor()
    cursor.execute("UPDATE requests SET status = ? WHERE id = ?", (payload.new_status, payload.request_id))
    
    if payload.new_status == "DROPPED_OFF":
        cursor.execute("SELECT COUNT(*) FROM requests WHERE status IN ('CONFIRMED', 'BOARDED')")
        if cursor.fetchone()[0] < MAX_CAPACITY:
            cursor.execute("""
                UPDATE requests SET status = 'CONFIRMED' 
                WHERE id = (SELECT id FROM requests WHERE status = 'WAITLIST' ORDER BY id ASC LIMIT 1)
            """)
    conn.commit()
    conn.close()
    return {"success": True}

# Serve root HTML
@app.get("/")
def serve_index():
    return FileResponse("index.html")

@app.get("/style.css")
def serve_css():
    return FileResponse("style.css")

@app.get("/app.js")
def serve_js():
    return FileResponse("app.js")
import urllib.request
import urllib.parse
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

app = FastAPI()

# Your exact ntfy topic key
NTFY_TOPIC = "ViylM4A5cfMQgIYQ"
DRIVER_PIN = "045048"

def trigger_ntfy_alert(title: str, message: str, priority: str = "high"):
    """Sends a POST request directly to ntfy.sh"""
    url = f"https://ntfy.sh/{NTFY_TOPIC}"
    
    headers = {
        "Title": title,
        "Priority": priority,
        "Tags": "minibus,round_pushpin",
        "User-Agent": "ARC-Van-Service"
    }
    
    req = urllib.request.Request(
        url,
        data=message.encode("utf-8"),
        headers=headers,
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status == 200
    except Exception as e:
        print(f"Error publishing to ntfy: {e}")
        return False

# Pydantic schema for the alert payload
class VanAlert(BaseModel):
    stop_name: str
    status: str

# API endpoint triggered by the driver UI
@app.post("/api/driver/broadcast")
async def broadcast_alert(alert: VanAlert, x_driver_pin: str = Header(None)):
    if x_driver_pin != DRIVER_PIN:
        raise HTTPException(status_code=401, detail="Invalid Driver PIN")

    title = f"🚐 Van Alert: {alert.stop_name}"
    message = alert.status

    success = trigger_ntfy_alert(title, message)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to post alert to ntfy")

    return {"status": "success", "message": f"Alert posted for {alert.stop_name}"}
import time

# Store timestamp of the last ntfy push
LAST_NTFY_SENT = 0
COOLDOWN_SECONDS = 5

def send_push_notification(title: str, message: str) -> bool:
    global LAST_NTFY_SENT
    current_time = time.time()

    # Skip sending if an alert was already sent within the cooldown window
    if current_time - LAST_NTFY_SENT < COOLDOWN_SECONDS:
        print("[DEBUG] Ntfy push skipped: Cooldown active.")
        return True

    url = f"https://ntfy.sh/{NTFY_TOPIC}"
    headers = {
        "Title": title,
        "Priority": "high",
        "Tags": "minibus,round_pushpin",
        "User-Agent": "ARC-Van-Service"
    }

    req = urllib.request.Request(
        url,
        data=message.encode("utf-8"),
        headers=headers,
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            if response.status == 200:
                LAST_NTFY_SENT = current_time
                return True
            return False
    except Exception as e:
        print(f"[DEBUG] Push failed: {e}")
        return False
        import os
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

app = FastAPI()

# Get the directory where main.py actually lives
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.get("/healthz")
async def health_check():
    return {"status": "healthy"}

@app.get("/")
async def serve_index():
    index_path = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h2>ARC Van Service Backend is running (index.html not found in current folder).</h2>", status_code=200)

@app.get("/style.css")
async def serve_css():
    css_path = os.path.join(BASE_DIR, "style.css")
    if os.path.exists(css_path):
        return FileResponse(css_path, media_type="text/css")
    raise HTTPException(status_code=404, detail="style.css not found")

@app.get("/app.js")
async def serve_js():
    js_path = os.path.join(BASE_DIR, "app.js")
    if os.path.exists(js_path):
        return FileResponse(js_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="app.js not found")
class BroadcastPayload(BaseModel):
    current_stop: str
    status_message: str

@app.post("/api/driver/broadcast")
async def driver_broadcast(payload: BroadcastPayload, x_driver_pin: str = Header(default="045048")):
    title = f"🚐 Van Alert: {payload.current_stop}"
    body = payload.status_message

    success = send_ntfy_push(title=title, message=body)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to publish to ntfy")

    return {"status": "success", "message": "Alert published"}