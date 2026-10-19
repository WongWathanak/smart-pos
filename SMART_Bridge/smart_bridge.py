#!/usr/bin/env python3
"""
smart_bridge.py — connects the SMART web frontend to your C++ backend.

Your backend (main.cpp) is a console program. This bridge runs your COMPILED
backend (smart_backend.exe) and answers its menus step by step, exactly like a
person typing. It then gives the browser the JSON API described in
SMART_Frontend/docs/API_CONTRACT.md, and serves the frontend pages too.

  * Your main.cpp and .txt files are NOT changed or copied by the bridge.
    Only your backend writes to the .txt files (when it saves a sale or product).
  * Exception: the cashier product list is read from product.txt READ-ONLY,
    because the backend has no cashier "list products" option.
  * Python 3.8+ standard library only — nothing to install.

Usage:
  python smart_bridge.py --backend C:\\SMART_backend\\smart_backend.exe
                         --data    C:\\SMART_backend
                         --frontend C:\\SMART_Frontend
  then open http://localhost:8080
"""
import argparse
import json
import mimetypes
import os
import queue
import re
import secrets
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

KHR_PER_USD = 4000
MAX_CART_ITEMS = 100

# Prompts printed by main.cpp. If you change a prompt there, change it here.
P_MAIN = "Enter your number here:"
P_ADMIN_USER, P_ADMIN_PASS = "Enter your ADMIN username:", "Enter your ADMIN password:"
P_CASH_USER, P_CASH_PASS = "Enter your CASHIER username:", "Enter your CASHIER password:"
P_ADMIN_OPT = "Enter your option:"
P_PROD_MENU = "Choose an option:"
P_ID = "Enter Product ID:"                    # add product AND cashier entry
P_NAME, P_PRICE, P_STOCK = "Enter Product Name", "Enter Price (USD):", "Enter Initial Stock:"
P_UPD_ID, P_UPD_PRICE, P_UPD_STOCK = "Enter Product ID to update:", "Enter new price", "Enter new stock amount:"
P_QTY = "Enter quantity to buy:"
P_MONEY_TYPE, P_MONEY = "Enter The Given Type of Money", "Enter The Given Money"
M_FILE_MISSING, M_BAD_USER, M_BAD_PASS = "not found!", "Incorrect username", "Incorrect password"
M_NO_PRODUCTS, M_FULL, M_ID_NOT_FOUND = "Could not open product.txt", "Inventory is full", "Product ID not found."
M_CART_LIMIT = "Cart limit reached"


class BackendError(Exception):
    def __init__(self, message, status=500, transcript=""):
        super().__init__(message)
        self.status = status
        self.transcript = transcript


# =============================================================================
# Talking to the console program
# =============================================================================
class Console:
    """Runs the backend once and answers its prompts."""

    def __init__(self, exe, cwd, timeout=8.0):
        self.timeout = timeout
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self.p = subprocess.Popen([exe], cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, bufsize=0, creationflags=flags)
        self.q = queue.Queue()
        self.buf = ""
        self.pos = 0
        self.dead = False
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        while True:
            chunk = self.p.stdout.read(4096)
            if not chunk:
                self.q.put(None)
                return
            self.q.put(chunk)

    def _add(self, chunk):
        if chunk is None:
            self.dead = True
        else:
            self.buf += chunk.decode("utf-8", "replace").replace("\r", "")

    def _pull(self):
        """Take everything already received, without waiting."""
        while True:
            try:
                self._add(self.q.get_nowait())
            except queue.Empty:
                return

    def _wait(self, seconds):
        """Wait up to `seconds` for new output."""
        try:
            self._add(self.q.get(timeout=seconds))
        except queue.Empty:
            return
        self._pull()

    def expect(self, markers):
        """Wait for one of `markers`. Returns (index, text up to it) or (-1, rest)."""
        end_time = time.time() + self.timeout
        while True:
            best = None
            for i, m in enumerate(markers):
                at = self.buf.find(m, self.pos)
                if at >= 0 and (best is None or at < best[1]):
                    best = (i, at)
            if best:
                i, at = best
                text = self.buf[self.pos:at + len(markers[i])]
                self.pos = at + len(markers[i])
                return i, text
            if self.dead or time.time() > end_time:
                return -1, self.buf[self.pos:]
            self._wait(min(0.2, max(0.01, end_time - time.time())))

    def send(self, line):
        self._pull()
        self.buf += str(line) + "\n"              # echo, so the transcript reads like a terminal
        self.pos = len(self.buf)
        self.p.stdin.write((str(line) + "\n").encode())
        self.p.stdin.flush()

    def wait_exit(self):
        try:
            self.p.stdin.close()
            self.p.wait(self.timeout)
        except Exception:
            self.kill()

    def kill(self):
        if self.p.poll() is None:
            self.p.kill()
            try:
                self.p.wait(2)
            except Exception:
                pass

    def fail(self, message, status=500):
        self.kill()
        raise BackendError(message, status, self.buf)


# =============================================================================
# Reading what the backend prints
# =============================================================================
def parse_products(text):
    out = []
    for line in text.split("\n"):
        m = re.match(r"^\s*(\S+)\s*\|\s*(.*?)\s*\|\s*\$\s*(-?[0-9.]+)\s*\|\s*Stock:\s*(-?\d+)\s*$", line)
        if m:
            out.append({"id": m[1], "name": m[2], "price": float(m[3]), "stock": int(m[4])})
    return out


def parse_product_file(path):
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:     # read-only
        for line in f:
            parts = line.rstrip("\r\n").split(",")
            if len(parts) < 4:
                continue
            try:
                out.append({"id": parts[0], "name": parts[1], "price": float(parts[2]), "stock": int(parts[3])})
            except ValueError:
                pass
    return out[:150]


def is_rule(line, ch, min_len):
    t = line.strip()
    return len(t) >= min_len and set(t) == {ch}


def parse_sales(text):
    body, inside = [], False
    for line in text.split("\n"):
        if not inside:
            inside = "View Sales History" in line
            continue
        if len(line.strip()) == 50 and is_rule(line, "=", 50):
            break
        body.append(line)
    sales, cur = [], None

    def close():
        nonlocal cur
        if cur and (cur["lines"] or cur["totalUsd"] > 0):
            cur["number"] = len(sales) + 1
            cur["raw"] = cur["raw"].strip()
            sales.append(cur)
        cur = None

    for raw in body:
        line = raw.strip()
        if not line:
            continue
        if "RECEIPT" in line or "NEW SALE" in line:
            close()
            cur = {"lines": [], "totalUsd": 0.0, "raw": line + "\n"}
            continue
        if cur is None:
            continue
        cur["raw"] += line + "\n"
        if line.startswith("TOTAL_USD:"):
            try:
                cur["totalUsd"] = float(line[10:].strip())
            except ValueError:
                pass
        elif is_rule(line, "=", 10) or is_rule(line, "-", 10):
            close()
        elif re.match(r"^(\d+)x\s+(.+)$", line):                 # new format: 3x bread
            m = re.match(r"^(\d+)x\s+(.+)$", line)
            cur["lines"].append({"name": m[2].strip(), "quantity": int(m[1])})
        elif re.match(r"^(.*\S)\s+x(\d+)$", line):               # old format: bread x10
            m = re.match(r"^(.*\S)\s+x(\d+)$", line)
            cur["lines"].append({"name": m[1], "quantity": int(m[2])})
    close()
    return sales


def parse_summary(text):
    a = re.search(r"Total Transactions Today:\s*(\d+)", text)
    b = re.search(r"Total Revenue \(USD\):\s*\$\s*(-?[0-9.]+)", text)
    c = re.search(r"Total Revenue \(KHR\):\s*(-?[0-9.]+)", text)
    if not (a and b):
        msg = next((l.strip() for l in text.split("\n") if "No sales" in l), "No sales data available to summarize.")
        return {"transactions": 0, "revenueUsd": 0, "revenueKhr": 0, "message": msg}
    usd = float(b[1])
    return {"transactions": int(a[1]), "revenueUsd": usd, "revenueKhr": float(c[1]) if c else usd * KHR_PER_USD}


def backend_message(text):
    for line in text.split("\n"):
        t = line.strip()
        if t.startswith("Error:") or t.startswith("->"):
            return t
    return ""


def fmt_price(v):
    s = f"{float(v):.2f}"
    return s.rstrip("0").rstrip(".") if "." in s else s


# =============================================================================
# One function per backend menu flow
# =============================================================================
class Backend:
    def __init__(self, exe, data_dir):
        self.exe = exe
        self.data = data_dir
        self.lock = threading.Lock()          # one backend run at a time (it rewrites whole files)

    def _open(self, role, user, password):
        c = Console(self.exe, self.data)
        admin = role == "admin"
        if c.expect([P_MAIN])[0] < 0:
            c.fail("The backend did not show its welcome menu.")
        c.send("1" if admin else "2")
        i, _ = c.expect([P_ADMIN_USER if admin else P_CASH_USER, M_FILE_MISSING])
        if i == 1:
            c.fail(f"Error: {'admin' if admin else 'cashier'}_login.txt not found!")
        if i < 0:
            c.fail("The backend did not ask for a username.")
        c.send(user)
        i, _ = c.expect([P_ADMIN_PASS if admin else P_CASH_PASS, M_BAD_USER])
        if i == 1:
            c.fail("Incorrect username. Try again.", 401)
        if i < 0:
            c.fail("The backend did not ask for a password.")
        c.send(password)
        i, _ = c.expect([P_ADMIN_OPT if admin else P_ID, M_BAD_PASS, M_NO_PRODUCTS])
        if i == 1:
            c.fail("Incorrect password. Try again.", 401)
        if i == 2:
            c.fail("Error: Could not open product.txt")
        if i < 0:
            c.fail("The backend did not respond after login.")
        return c

    @staticmethod
    def _close_admin(c):                       # admin menu: 4 Logout, then 0 Exit
        c.send("4")
        if c.expect([P_MAIN])[0] >= 0:
            c.send("0")
        c.wait_exit()

    def _close_products(self, c):              # product menu: 4 back, 4 logout, 0 exit
        c.send("4")
        if c.expect([P_ADMIN_OPT])[0] >= 0:
            self._close_admin(c)
        else:
            c.kill()

    def login(self, role, user, password):
        if not user or not password or re.search(r"\s", user + password):
            raise BackendError("Username and password are required and cannot contain spaces.", 400)
        with self.lock:
            c = self._open(role, user, password)
            if role == "admin":
                self._close_admin(c)
            else:
                c.send("0")                    # empty cart -> back to the welcome menu
                if c.expect([P_MAIN])[0] >= 0:
                    c.send("0")
                c.wait_exit()

    def products(self, user, password):
        with self.lock:
            c = self._open("admin", user, password)
            c.send("3")
            if c.expect([P_PROD_MENU])[0] < 0:
                c.fail("Could not open Manage Products.")
            c.send("1")
            i, text = c.expect([P_PROD_MENU])
            if i < 0:
                c.fail("Could not read the product list.")
            self._close_products(c)
            return parse_products(text)

    def sales(self, user, password):
        with self.lock:
            c = self._open("admin", user, password)
            c.send("1")
            i, text = c.expect([P_ADMIN_OPT])
            if i < 0:
                c.fail("Could not read sales history.")
            self._close_admin(c)
            return parse_sales(text)

    def summary(self, user, password):
        with self.lock:
            c = self._open("admin", user, password)
            c.send("2")
            i, text = c.expect([P_ADMIN_OPT])
            if i < 0:
                c.fail("Could not read the daily summary.")
            self._close_admin(c)
            return parse_summary(text)

    def add_product(self, user, password, p):
        with self.lock:
            c = self._open("admin", user, password)
            c.send("3")
            if c.expect([P_PROD_MENU])[0] < 0:
                c.fail("Could not open Manage Products.")
            c.send("2")
            i, _ = c.expect([P_ID, M_FULL])
            if i == 1:
                c.expect([P_PROD_MENU])
                self._close_products(c)
                raise BackendError("Inventory is full! Cannot add more products.", 409)
            if i < 0:
                c.fail("The backend did not ask for a Product ID.")
            for value, nxt in ((p["id"], P_NAME), (p["name"], P_PRICE), (fmt_price(p["price"]), P_STOCK)):
                c.send(value)
                if c.expect([nxt])[0] < 0:
                    c.fail("The backend stopped while adding the product.")
            c.send(int(p["stock"]))
            i, text = c.expect([P_PROD_MENU])
            if i < 0:
                c.fail("The backend did not confirm the new product.")
            self._close_products(c)
            if "Product added successfully!" not in text:
                raise BackendError("The backend did not report success.", 500, c.buf)
            return "Product added successfully!"

    def update_product(self, user, password, pid, price, stock):
        with self.lock:
            c = self._open("admin", user, password)
            c.send("3")
            if c.expect([P_PROD_MENU])[0] < 0:
                c.fail("Could not open Manage Products.")
            c.send("3")
            if c.expect([P_UPD_ID])[0] < 0:
                c.fail("The backend did not ask for a Product ID.")
            c.send(pid)
            i, _ = c.expect([P_UPD_PRICE, M_ID_NOT_FOUND])
            if i == 1:
                c.expect([P_PROD_MENU])
                self._close_products(c)
                raise BackendError("Product ID not found.", 404)
            if i < 0:
                c.fail("The backend did not ask for the new price.")
            c.send(fmt_price(price))
            if c.expect([P_UPD_STOCK])[0] < 0:
                c.fail("The backend did not ask for the new stock.")
            c.send(int(stock))
            i, text = c.expect([P_PROD_MENU])
            if i < 0:
                c.fail("The backend did not confirm the update.")
            self._close_products(c)
            if "Product updated successfully!" not in text:
                raise BackendError("The backend did not report success.", 500, c.buf)
            return "Product updated successfully!"

    def checkout(self, user, password, items, payment):
        """Runs one cashier sale. If anything fails before payment the backend
        process is stopped, and because main.cpp only writes after payment,
        nothing is saved."""
        currency = payment.get("currency")
        try:
            amount = float(payment.get("amount"))
        except (TypeError, ValueError):
            raise BackendError("Enter the money given.", 400)
        if currency not in ("USD", "KHR") or amount <= 0:
            raise BackendError("Enter the money given.", 400)
        if not items:
            raise BackendError("Cart is empty.", 400)
        if len(items) > MAX_CART_ITEMS:
            raise BackendError("Cart limit reached! Cannot add more items.", 400)
        for it in items:
            if not str(it.get("id", "")).strip() or str(it["id"]).strip() == "0" or re.search(r"\s", str(it["id"])):
                raise BackendError("Invalid Product ID.", 400)
            if not isinstance(it.get("quantity"), int) or it["quantity"] <= 0:
                raise BackendError("Error: Please enter a valid quantity greater than 0.", 400)

        with self.lock:
            c = self._open("cashier", user, password)
            lines = []
            for it in items:
                c.send(it["id"])
                i, text = c.expect([P_QTY, P_ID, M_CART_LIMIT])
                if i == 1:
                    c.fail(backend_message(text) or f"Error: Product ID '{it['id']}' not found. Try again.", 404)
                if i != 0:
                    c.fail("The backend did not ask for a quantity.")
                m = re.search(r"Product found:\s*(.*)\s+\(\$\s*(-?[0-9.]+)\)", text)
                c.send(it["quantity"])
                i, text = c.expect([P_ID])
                msg = backend_message(text)
                if i < 0 or not msg.startswith("->"):
                    c.fail(msg or "The backend refused this item.", 409)
                lines.append({"id": it["id"], "name": m[1].strip() if m else it["id"],
                              "price": float(m[2]) if m else 0.0, "quantity": it["quantity"]})

            c.send("0")                                        # finish -> receipt
            i, receipt = c.expect([P_MONEY_TYPE])
            if i < 0:
                c.fail("The backend did not show a receipt.")
            tu = re.search(r"TOTAL DUE:\s*\$\s*(-?[0-9.]+)", receipt)
            tk = re.search(r"TOTAL DUE KHR:\s*KHR\s*(-?\d+)", receipt)
            total_usd = float(tu[1]) if tu else 0.0
            total_khr = int(tk[1]) if tk else round(total_usd * KHR_PER_USD)
            # main.cpp does not check the money given — stop before anything is saved.
            enough = round(amount) >= total_khr if currency == "KHR" else round(amount * 100) >= round(total_usd * 100)
            if not enough:
                c.fail(f"Not enough money: total is ${total_usd:.2f} (KHR {total_khr:,}). Nothing was saved.", 400)

            c.send("2" if currency == "KHR" else "1")
            if c.expect([P_MONEY])[0] < 0:
                c.fail("The backend did not ask for the money given.")
            c.send(str(round(amount)) if currency == "KHR" else f"{amount:.2f}")
            i, change_text = c.expect([P_MAIN])
            if i < 0:
                c.fail("The backend did not finish the sale.")
            cu = re.search(r"CHANGE \(USD\):\s*\$\s*(-?[0-9.]+)", change_text)
            ck = re.search(r"CHANGE \(KHR\):\s*KHR\s*(-?\d+)", change_text)
            c.send("0")
            c.wait_exit()

        for l in lines:
            l["subtotal"] = round(l["price"] * l["quantity"], 2)
        return {
            "ok": True,
            "receipt": {"lines": lines, "totalUsd": total_usd, "totalKhr": total_khr},
            "change": {"usd": float(cu[1]) if cu else 0.0, "khr": int(ck[1]) if ck else 0},
        }

    def cashier_catalog(self):
        try:
            return parse_product_file(os.path.join(self.data, "product.txt"))
        except OSError:
            raise BackendError("Could not read product.txt.", 500)


# =============================================================================
# HTTP server: API + frontend files
# =============================================================================
class Handler(BaseHTTPRequestHandler):
    backend = None
    frontend = None
    sessions = {}          # token -> (role, username, password), in memory only

    def log_message(self, fmt, *args):
        if self.server.verbose:
            sys.stderr.write("[bridge] " + (fmt % args) + "\n")

    def _json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status, message):
        self._json(status, {"ok": False, "error": message})

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 1_000_000:
            raise BackendError("Request too large.", 413)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except ValueError:
            raise BackendError("Invalid JSON.", 400)

    def _session(self, need_role=None):
        token = (self.headers.get("Authorization") or "").replace("Bearer ", "", 1)
        s = self.sessions.get(token)
        if not s:
            raise BackendError("Please log in.", 401)
        if need_role and s[0] != need_role:
            raise BackendError("This action is not available for your role.", 403)
        return token, s

    def do_GET(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")

    def _route(self, method):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            try:
                self._api(method, path[4:])
            except BackendError as e:
                if e.transcript and self.server.verbose:
                    sys.stderr.write("[bridge] backend output:\n" + e.transcript + "\n")
                self._error(e.status, str(e))
            except Exception as e:  # never leak a stack trace to the browser
                sys.stderr.write(f"[bridge] unexpected error: {e!r}\n")
                self._error(500, "The bridge hit an unexpected error. See the bridge window.")
            return
        if method != "GET":
            return self._error(405, "Method not allowed.")
        self._static(path)

    def _api(self, method, route):
        b = self.backend
        if route == "/login" and method == "POST":
            body = self._body()
            role = body.get("role")
            if role not in ("admin", "cashier"):
                raise BackendError("Role must be admin or cashier.", 400)
            user, pw = str(body.get("username", "")).strip(), str(body.get("password", ""))
            b.login(role, user, pw)
            token = secrets.token_urlsafe(24)
            self.sessions[token] = (role, user, pw)
            return self._json(200, {"ok": True, "token": token, "role": role, "username": user})

        token, (role, user, pw) = self._session()
        if route == "/logout" and method == "POST":
            self.sessions.pop(token, None)
            return self._json(200, {"ok": True})
        if route == "/products" and method == "GET":
            products = b.products(user, pw) if role == "admin" else b.cashier_catalog()
            return self._json(200, {"ok": True, "products": products})
        if route == "/sales/checkout" and method == "POST":
            self._session("cashier")
            body = self._body()
            return self._json(200, b.checkout(user, pw, body.get("items") or [], body.get("payment") or {}))

        self._session("admin")                                  # everything below is admin-only
        if route == "/products" and method == "POST":
            p = self._body()
            for k in ("id", "name"):
                if not isinstance(p.get(k), str) or not p[k] or re.search(r"[\s,]", p[k]):
                    raise BackendError(f"Invalid {k}: no spaces or commas (use _).", 400)
            if p["id"] == "0":
                raise BackendError("ID 0 can't be used: the cashier types 0 to finish a sale.", 400)
            if not isinstance(p.get("price"), (int, float)) or p["price"] <= 0:
                raise BackendError("Price must be greater than 0.", 400)
            if not isinstance(p.get("stock"), int) or p["stock"] < 0:
                raise BackendError("Stock must be a whole number, 0 or more.", 400)
            existing = b.products(user, pw)
            if any(x["id"] == p["id"] for x in existing):           # main.cpp would add a duplicate
                raise BackendError(f"A product with ID {p['id']} already exists.", 409)
            return self._json(200, {"ok": True, "message": b.add_product(user, pw, p)})
        m = re.match(r"^/products/(.+)$", route)
        if m and method == "PUT":
            v = self._body()
            if not isinstance(v.get("price"), (int, float)) or v["price"] <= 0:
                raise BackendError("Price must be greater than 0.", 400)
            if not isinstance(v.get("stock"), int) or v["stock"] < 0:
                raise BackendError("Stock must be a whole number, 0 or more.", 400)
            return self._json(200, {"ok": True, "message": b.update_product(user, pw, unquote(m[1]), v["price"], v["stock"])})
        if route == "/sales" and method == "GET":
            return self._json(200, {"ok": True, "sales": b.sales(user, pw)})
        if route == "/summary" and method == "GET":
            return self._json(200, {"ok": True, **b.summary(user, pw)})
        raise BackendError("No such endpoint.", 404)

    def _static(self, path):
        if path == "/config/config.json":                     # switch the frontend to http mode
            with open(os.path.join(self.frontend, "config", "config.json"), encoding="utf-8") as f:
                cfg = json.load(f)
            host = self.headers.get("Host") or f"localhost:{self.server.server_port}"
            proto = self.headers.get("X-Forwarded-Proto", "http")
            cfg.update({"apiMode": "http", "apiBaseUrl": f"{proto}://{host}/api"})
            return self._json(200, cfg)
        rel = "index.html" if path in ("", "/") else unquote(path).lstrip("/")
        full = os.path.realpath(os.path.join(self.frontend, rel))
        if not full.startswith(os.path.realpath(self.frontend) + os.sep) or not os.path.isfile(full):
            self.send_error(404)
            return
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(full)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def find_default(*candidates):
    for c in candidates:
        if c and os.path.exists(c):
            return c
    return candidates[0]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    exe_name = "smart_backend.exe" if os.name == "nt" else "smart_backend"
    ap = argparse.ArgumentParser(description="SMART bridge: web frontend <-> C++ console backend")
    ap.add_argument("--backend", default=find_default(os.path.join(here, "..", "SMART_backend", exe_name)),
                    help="compiled main.cpp (default ../SMART_backend/" + exe_name + ")")
    ap.add_argument("--data", help="folder with product.txt etc. (default: the backend's folder)")
    ap.add_argument("--frontend", default=os.path.join(here, "..", "SMART_Frontend"),
                    help="SMART_Frontend folder (default ../SMART_Frontend)")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8080)))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--verbose", action="store_true", help="log requests and backend output")
    a = ap.parse_args()

    exe = os.path.abspath(a.backend)
    data = os.path.abspath(a.data or os.path.dirname(exe))
    front = os.path.abspath(a.frontend)
    problems = []
    if not os.path.isfile(exe):
        problems.append(f"Backend program not found: {exe}\n  Compile it:  g++ -std=c++17 main.cpp -o {exe_name}")
    for f in ("admin_login.txt", "cashier_login.txt", "product.txt"):
        if not os.path.isfile(os.path.join(data, f)):
            problems.append(f"Missing in data folder: {os.path.join(data, f)}")
    if not os.path.isfile(os.path.join(front, "index.html")):
        problems.append(f"Frontend not found: {front}")
    if problems:
        print("Cannot start the SMART bridge:\n- " + "\n- ".join(problems))
        sys.exit(1)

    # Quick check that the program really is the SMART backend.
    c = Console(exe, data, timeout=5)
    if c.expect([P_MAIN])[0] < 0:
        c.kill()
        print("The program did not show the SMART welcome menu:\n" + c.buf)
        sys.exit(1)
    c.send("0")
    c.wait_exit()

    Handler.backend = Backend(exe, data)
    Handler.frontend = front
    srv = ThreadingHTTPServer((a.host, a.port), Handler) 
    srv.verbose = a.verbose
    print(f"SMART bridge running.\n  Backend : {exe}\n  Data    : {data}\n  Frontend: {front}\n"
          f"\n  Open http://localhost:{a.port} in your browser.  Press Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
