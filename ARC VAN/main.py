import os
import sqlite3
import json
from typing import List
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel

import database

app = FastAPI(title="ARC Class 045/048 Shuttle")
database.init_db()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DRIVER_PIN = "045048"
MAX_CAPACITY = 15

# --- Native WebSocket Connection Manager ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"🔌 WebSocket Client Connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"🔌 WebSocket Client Disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        payload = json.dumps(message)
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                dead_connections.append(connection)
        for dead in dead_connections:
            self.disconnect(dead)

manager = ConnectionManager()

# --- Pydantic Models ---
class PinVerifyPayload(BaseModel):
    pin: str

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

# --- WebSocket Endpoint ---
@app.websocket("/ws/alerts")
async def websocket_alerts_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                parsed = json.loads(data)
                if parsed.get("type") == "PING":
                    await websocket.send_text(json.dumps({"type": "PONG"}))
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

# --- REST Endpoints ---
@app.get("/healthz")
def health():
    return {"status": "healthy"}

# PIN Verification Endpoint (Validates on backend without exposing PIN to frontend)
@app.post("/api/driver/verify-pin")
def verify_driver_pin(payload: PinVerifyPayload):
    if payload.pin == DRIVER_PIN:
        return {"success": True, "token": "driver-authenticated-session"}
    raise HTTPException(status_code=401, detail="Invalid PIN")

@app.get("/api/alerts/latest")
def latest_alert():
    return database.get_latest_alert() or {"id": 0, "title": "No new alerts", "detail": "", "location": None, "created_at": ""}

@app.get("/api/status")
def get_status():
    status = database.get_queue_data()
    status["walking_count"] = database.get_walking_count()
    return status

@app.post("/api/driver/broadcast")
async def broadcast_alert(alert: AlertPayload):
    if alert.pin != DRIVER_PIN:
        raise HTTPException(status_code=403, detail="Invalid Driver PIN")

    subject = alert.title or f"🚐 Van Location: {alert.current_stop}"
    body = alert.detail or f"045/048 Van is currently at {alert.current_stop}."
    loc = alert.location or alert.current_stop

    alert_id = database.save_alert(subject, body, loc)
    latest = database.get_latest_alert()

    await manager.broadcast({
        "type": "NEW_ALERT",
        "alert": latest or {
            "id": alert_id,
            "title": subject,
            "detail": body,
            "location": loc,
            "created_at": "Just now"
        }
    })

    return {"success": True}

@app.post("/api/driver/requests")
def driver_requests(payload: DriverRequestQuery):
    if payload.pin != DRIVER_PIN:
        raise HTTPException(status_code=403, detail="Invalid Driver PIN")
    return {"requests": database.get_queue_data()["manifest"]}

@app.post("/api/alerts/signup")
async def signup_for_alerts(signup: AlertSignup):
    conn = sqlite3.connect(database.DB_NAME)
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO users (email) VALUES (?)", (signup.email.lower(),))
    conn.commit()
    conn.close()
    return {"success": True}

@app.post("/api/request-ride")
async def request_ride(req: RideRequest):
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

    await manager.broadcast({
        "type": "NEW_RIDE_REQUEST",
        "name": req.name,
        "pickup": req.pickup,
        "dropoff": req.dropoff,
        "status": assigned_status
    })

    return {"status": assigned_status}

@app.post("/api/student/heading-to-van")
async def heading_to_van(signup: AlertSignup):
    conn = sqlite3.connect(database.DB_NAME)
    cursor = conn.cursor()
    cursor.execute("INSERT OR IGNORE INTO users (email) VALUES (?)", (signup.email.lower(),))
    conn.commit()
    cursor.execute("SELECT id FROM users WHERE email = ?", (signup.email.lower(),))
    user_id = cursor.fetchone()[0]
    cursor.execute("INSERT INTO walking_to_van (user_id) VALUES (?)", (user_id,))
    conn.commit()
    conn.close()

    count = database.get_walking_count()
    await manager.broadcast({"type": "WALKING_UPDATE", "count": count})
    return {"success": True}

@app.post("/api/driver/clear-walking")
async def clear_walking(payload: UpdateStatus):
    if payload.pin != DRIVER_PIN:
        raise HTTPException(status_code=403, detail="Invalid Driver PIN")
    database.clear_walking_to_van()
    await manager.broadcast({"type": "WALKING_UPDATE", "count": 0})
    return {"success": True}

# Static file routes
@app.get("/")
def serve_index():
    return FileResponse(os.path.join(BASE_DIR, "index.html"))

@app.get("/style.css")
def serve_css():
    return FileResponse(os.path.join(BASE_DIR, "style.css"))

@app.get("/app.js")
def serve_js():
    return FileResponse(os.path.join(BASE_DIR, "app.js"))
