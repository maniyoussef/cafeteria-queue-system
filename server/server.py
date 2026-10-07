"""
CampusBite Cafeteria Queue Server (Python version)

Same API as server/index.js, using only the Python standard library:
  GET  /api/status                 server info + network IPs
  GET  /api/queues                 full state of every counter
  GET  /api/events                 live updates (Server-Sent Events)
  POST /api/queue/join             { counterId, studentName, studentId, items, notes }
  POST /api/queue/leave            { counterId, ticketId }
  POST /api/staff/serve-next       { counterId }
  POST /api/staff/complete         { counterId, ticketId, action: "complete" | "no_show" }
  POST /api/test/concurrent-join   { counterId, count }
  POST /api/queue/reset

Error-screen test routes (always fail on purpose):
  GET /api/admin -> 401, GET /api/ticket/9999 -> 404, GET /api/error -> 500

It also serves the website from ../public, so http://<server-ip>:8080 opens the app.
Run with:  python3 server.py      (port can be changed with PORT=xxxx)
"""

import json
import mimetypes
import os
import queue
import random
import socket
import string
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("PORT", 8080))
HOST = "0.0.0.0"  # listen on every network interface so other VMs can connect
PUBLIC_DIR = (Path(__file__).resolve().parent.parent / "public").resolve()

# Fixed content types: on Windows, mimetypes reads the registry and can report
# .js/.css as text/plain, which makes browsers ignore the stylesheet.
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}

COUNTER_CONFIG = [
    # id, name, ticket prefix, first ticket number - 1, average prep minutes
    ("hot-meals", "Hot Meals Counter", "HM", 100, 3),
    ("snacks-drinks", "Snacks & Drinks Counter", "SD", 200, 1.5),
    ("express-deli", "Express Deli & Salad Bar", "EX", 300, 2),
]


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------
# Queue logic — every change happens inside `lock`, so two students joining
# at the same instant can never get the same ticket number.
# --------------------------------------------------------------------------
class QueueManager:
    def __init__(self):
        self.lock = threading.Lock()
        self.history = []
        self.counters = {}
        self._reset_counters()

    def _reset_counters(self):
        self.counters = {
            cid: {
                "id": cid,
                "name": name,
                "prefix": prefix,
                "ticketNumberSeq": seq,
                "activeQueue": [],
                "servingTicket": None,
                "servedCount": 0,
                "totalWaitTimeMs": 0,
                "avgPrepTimeMinutes": prep,
            }
            for cid, name, prefix, seq, prep in COUNTER_CONFIG
        }
        self.history = []

    def _counter(self, counter_id):
        counter = self.counters.get(counter_id)
        if counter is None:
            raise ValueError(f"Counter '{counter_id}' not found.")
        return counter

    def get_state(self):
        with self.lock:
            counters = {}
            for cid, c in self.counters.items():
                counters[cid] = {
                    "id": c["id"],
                    "name": c["name"],
                    "prefix": c["prefix"],
                    "activeCount": len(c["activeQueue"]),
                    "servingTicket": c["servingTicket"],
                    "activeQueue": [
                        {
                            **t,
                            "position": i + 1,
                            "estimatedWaitMinutes": round((i + 1) * c["avgPrepTimeMinutes"], 1),
                        }
                        for i, t in enumerate(c["activeQueue"])
                    ],
                    "servedCount": c["servedCount"],
                    "avgWaitMinutes": round(c["totalWaitTimeMs"] / c["servedCount"] / 60000, 1)
                    if c["servedCount"] > 0
                    else 0,
                }
            return {
                "counters": counters,
                "totalActive": sum(len(c["activeQueue"]) for c in self.counters.values()),
                "totalServed": sum(c["servedCount"] for c in self.counters.values()),
                "lastUpdated": now_iso(),
            }

    def join(self, counter_id="hot-meals", student_name="Student", student_id="", items=None, notes=""):
        with self.lock:
            counter = self._counter(counter_id)
            counter["ticketNumberSeq"] += 1
            if not isinstance(items, list):
                items = [items] if items else []
            suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
            ticket = {
                "id": f"ticket_{int(time.time() * 1000)}_{suffix}",
                "ticketNumber": f"{counter['prefix']}-{counter['ticketNumberSeq']}",
                "counterId": counter_id,
                "counterName": counter["name"],
                "studentName": str(student_name or "").strip() or "Anonymous Student",
                "studentId": str(student_id or "").strip(),
                "items": items,
                "notes": str(notes or "").strip(),
                "joinedAt": now_iso(),
                "timestampMs": int(time.time() * 1000),
                "status": "in_queue",
            }
            counter["activeQueue"].append(ticket)
            position = len(counter["activeQueue"])
            return {
                **ticket,
                "position": position,
                "estimatedWaitMinutes": round(position * counter["avgPrepTimeMinutes"], 1),
            }

    def leave(self, counter_id, ticket_id):
        with self.lock:
            counter = self._counter(counter_id)
            for i, t in enumerate(counter["activeQueue"]):
                if ticket_id in (t["id"], t["ticketNumber"]):
                    removed = counter["activeQueue"].pop(i)
                    removed["status"] = "cancelled"
                    removed["leftAt"] = now_iso()
                    self.history.append(removed)
                    return {"success": True, "removedTicket": removed, "counterId": counter_id}
            return {"success": False, "message": "Ticket not found in active queue"}

    def serve_next(self, counter_id):
        with self.lock:
            counter = self._counter(counter_id)
            if not counter["activeQueue"]:
                return {"success": False, "message": "No students waiting in this queue."}

            next_ticket = counter["activeQueue"].pop(0)  # first in, first out
            next_ticket["status"] = "now_serving"
            next_ticket["calledAt"] = now_iso()

            previous = counter["servingTicket"]
            if previous:
                previous["status"] = "completed"
                previous["completedAt"] = now_iso()
                self.history.append(previous)

            counter["servingTicket"] = next_ticket
            counter["servedCount"] += 1
            counter["totalWaitTimeMs"] += int(time.time() * 1000) - next_ticket["timestampMs"]
            return {
                "success": True,
                "ticket": next_ticket,
                "counterId": counter_id,
                "remainingInQueue": len(counter["activeQueue"]),
            }

    def complete(self, counter_id, ticket_id, action="complete"):
        with self.lock:
            counter = self._counter(counter_id)
            serving = counter["servingTicket"]
            if serving and ticket_id in (serving["id"], serving["ticketNumber"]):
                serving["status"] = "no_show" if action == "no_show" else "completed"
                serving["finishedAt"] = now_iso()
                self.history.append(serving)
                counter["servingTicket"] = None
                return {"success": True, "completedTicket": serving}
            return {"success": False, "message": "Ticket is not currently being served."}

    def reset(self):
        with self.lock:
            self._reset_counters()


queue_manager = QueueManager()


# --------------------------------------------------------------------------
# Live updates — each open browser holds a /api/events connection and gets
# a message every time a queue changes.
# --------------------------------------------------------------------------
event_clients = set()
event_clients_lock = threading.Lock()


def broadcast(event_type="queue:updated", extra=None):
    state = queue_manager.get_state()
    messages = [("queue:updated", state)]
    if event_type != "queue:updated":
        messages.append((event_type, {**(extra or {}), "state": state}))
    with event_clients_lock:
        for client in event_clients:
            for message in messages:
                client.put(message)


def get_network_ips():
    """Best-effort list of this machine's LAN IPv4 addresses."""
    addresses = set()
    try:
        # No packet is sent; this just asks the OS which interface it would use.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            addresses.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addresses.add(info[4][0])
    except OSError:
        pass
    return [{"interface": "lan", "address": a} for a in sorted(addresses) if not a.startswith("127.")]


# --------------------------------------------------------------------------
# HTTP handler
# --------------------------------------------------------------------------
class Server(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Keep the console readable; the live-update stream would otherwise spam it.
        if not self.path.startswith("/api/events"):
            super().log_message(fmt, *args)

    def send_cors_headers(self):
        # Lets the website call this server even when it is opened from another address.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def send_json(self, status_code, data):
        response = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length == 0:
            return {}
        data = json.loads(self.rfile.read(length))
        if not isinstance(data, dict):
            raise ValueError("JSON body must be an object")
        return data

    def path_only(self):
        return self.path.split("?", 1)[0]

    # ---- OPTIONS: browsers ask this before a cross-origin POST with JSON ----
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---- GET ----
    def do_GET(self):
        path = self.path_only()
        try:
            if path == "/api/status":
                with event_clients_lock:
                    connected = len(event_clients)
                self.send_json(200, {
                    "status": "online",
                    "message": "server is running",
                    "systemTime": now_iso(),
                    "networkIPs": get_network_ips(),
                    "connectedClients": connected,
                    "port": PORT,
                })
            elif path == "/api/queues":
                self.send_json(200, queue_manager.get_state())
            elif path == "/api/events":
                self.stream_events()
            # Error-screen test routes
            elif path == "/api/admin":
                self.send_json(401, {"status": "error", "message": "Authentication required"})
            elif path == "/api/ticket/9999":
                self.send_json(404, {"status": "error", "message": "ticket not found"})
            elif path == "/api/error":
                self.send_json(500, {"status": "error", "message": "internal server error"})
            elif path.startswith("/api/"):
                self.send_json(404, {"status": "error", "message": "resource not found"})
            else:
                self.serve_static(path)
        except Exception as err:  # never leave the browser hanging
            self.send_json(500, {"success": False, "error": str(err)})

    # ---- POST ----
    def do_POST(self):
        path = self.path_only()
        try:
            body = self.read_json_body()
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"success": False, "error": "Invalid JSON body"})
            return

        try:
            if path == "/api/queue/join":
                ticket = queue_manager.join(
                    counter_id=body.get("counterId", "hot-meals"),
                    student_name=body.get("studentName", "Student"),
                    student_id=body.get("studentId", ""),
                    items=body.get("items"),
                    notes=body.get("notes", ""),
                )
                broadcast("ticket:joined", {"ticket": ticket})
                self.send_json(201, {
                    "success": True,
                    "ticket": ticket,
                    "message": f"Successfully joined line for {ticket['counterName']}. "
                               f"Ticket #{ticket['ticketNumber']}",
                })

            elif path == "/api/queue/leave":
                result = queue_manager.leave(body.get("counterId"), body.get("ticketId"))
                if result["success"]:
                    broadcast("ticket:cancelled", {"ticketId": body.get("ticketId"),
                                                   "counterId": body.get("counterId")})
                    self.send_json(200, {"success": True, "message": "Successfully removed from queue."})
                else:
                    self.send_json(404, result)

            elif path == "/api/staff/serve-next":
                counter_id = body.get("counterId")
                result = queue_manager.serve_next(counter_id)
                if result["success"]:
                    # The called student's browser listens for this to show "your order is ready"
                    broadcast("ticket:called", {"ticket": result["ticket"], "counterId": counter_id})
                    self.send_json(200, result)
                else:
                    self.send_json(400, result)

            elif path == "/api/staff/complete":
                counter_id, ticket_id = body.get("counterId"), body.get("ticketId")
                result = queue_manager.complete(counter_id, ticket_id, body.get("action", "complete"))
                if result["success"]:
                    broadcast("ticket:completed", {"counterId": counter_id, "ticketId": ticket_id})
                    self.send_json(200, result)
                else:
                    self.send_json(400, result)

            elif path == "/api/test/concurrent-join":
                self.concurrent_join_test(body)

            elif path == "/api/queue/reset":
                queue_manager.reset()
                broadcast("queue:reset")
                self.send_json(200, {"success": True, "message": "All cafeteria queues reset successfully."})

            else:
                self.send_json(404, {"status": "error", "message": "resource not found"})

        except ValueError as err:  # e.g. unknown counter
            self.send_json(400, {"success": False, "error": str(err)})
        except Exception as err:
            self.send_json(500, {"success": False, "error": str(err)})

    def concurrent_join_test(self, body):
        counter_id = body.get("counterId", "hot-meals")
        count = max(1, min(int(body.get("count", 5)), 100))
        start = time.time()
        # Fire all joins at the same time from separate threads to prove the lock works
        with ThreadPoolExecutor(max_workers=count) as pool:
            tickets = list(pool.map(
                lambda i: queue_manager.join(
                    counter_id=counter_id,
                    student_name=f"Simulated Student {i + 1} (VM Test)",
                    items=[f"Combo {i + 1}", "Drink"],
                    notes=f"Batch request index {i + 1}",
                ),
                range(count),
            ))
        duration_ms = int((time.time() - start) * 1000)
        broadcast("queue:batch_joined", {"count": len(tickets)})
        self.send_json(200, {
            "success": True,
            "durationMs": duration_ms,
            "processedCount": len(tickets),
            "tickets": [
                {k: t[k] for k in ("ticketNumber", "position", "studentName", "joinedAt")}
                for t in tickets
            ],
        })

    def stream_events(self):
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()

        client = queue.Queue()
        client.put(("queue:updated", queue_manager.get_state()))
        with event_clients_lock:
            event_clients.add(client)
        try:
            while True:
                try:
                    event, data = client.get(timeout=15)
                    chunk = f"event: {event}\ndata: {json.dumps(data)}\n\n"
                except queue.Empty:
                    chunk = ": keep-alive\n\n"  # stops proxies/browsers closing an idle stream
                self.wfile.write(chunk.encode("utf-8"))
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # browser tab closed
        finally:
            with event_clients_lock:
                event_clients.discard(client)

    def serve_static(self, path):
        if not PUBLIC_DIR.is_dir():
            self.send_json(404, {"status": "error", "message": "resource not found"})
            return
        file_path = (PUBLIC_DIR / path.lstrip("/")).resolve()
        # Block "../" tricks and fall back to index.html for unknown pages
        if PUBLIC_DIR not in file_path.parents or not file_path.is_file():
            file_path = PUBLIC_DIR / "index.html"
        content = file_path.read_bytes()
        content_type = CONTENT_TYPES.get(file_path.suffix.lower()) \
            or mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_cors_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


class QueueHTTPServer(ThreadingHTTPServer):
    daemon_threads = True  # open live-update streams don't block Ctrl+C
    allow_reuse_address = True


if __name__ == "__main__":
    server = QueueHTTPServer((HOST, PORT), Server)
    print("=" * 54)
    print(" CAFETERIA QUEUE SERVER (Python) RUNNING")
    print("=" * 54)
    print(f" Local Access:    http://localhost:{PORT}")
    for ip in get_network_ips():
        print(f" Network Access:  http://{ip['address']}:{PORT}")
    print("=" * 54)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
