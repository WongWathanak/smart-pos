"""
e2e_test.py — browser tests (headless Chromium via Playwright).

    pip install playwright && python -m playwright install chromium
    python tests/e2e_test.py              # run
    python tests/e2e_test.py shots/       # run and save screenshots there

Part 1: Preview mode (served by a simple static server) — every screen,
        validation, and that nothing can be saved.
Part 2: "http" mode against tests/contract-stub-server.js — a TEST-ONLY stub
        of docs/API_CONTRACT.md (needs Node). This proves the frontend speaks
        the contract; it does NOT test your real C++ backend.
"""
import os, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = sys.argv[1] if len(sys.argv) > 1 else None
ok, errs = [], []

def check(cond, name):
    (ok if cond else errs).append(name)

def shot(pg, name, full=False):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=full)

def new_page(b):
    pg = b.new_page(viewport={"width": 1600, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    # 401/409 are triggered on purpose (wrong password, stock conflict); Chrome logs them.
    expected = ("status of 401", "status of 409")
    pg.on("console", lambda m: errs.append(f"console: {m.text}")
          if m.type == "error" and not any(x in m.text for x in expected) else None)
    return pg

def preview_tests(b, base):
    pg = new_page(b)
    pg.goto(base + "/index.html"); pg.wait_for_timeout(300); shot(pg, "preview_login")
    U=base
    # not logged in -> redirect
    pg.goto(U+"/pages/dashboard.html"); pg.wait_for_url("**/index.html"); check(True,"redirect to login")
    # validation
    pg.click("#login-btn"); check("enter your username" in pg.inner_text("#login-msg"),"login validation")
    pg.fill("#username","ad min"); pg.fill("#password","x"); pg.click("#login-btn"); check("spaces" in pg.inner_text("#login-msg"),"no spaces")
    # cashier login
    pg.click("button[data-role=cashier]"); pg.fill("#username","cashier"); pg.fill("#password","x"); pg.click("#login-btn")
    pg.wait_for_url("**/cashier.html"); pg.wait_for_timeout(400)
    # cashier can't open admin page
    pg.goto(U+"/pages/products.html"); pg.wait_for_url("**/cashier.html"); check(True,"role guard")
    pg.wait_for_timeout(300)
    pg.fill("#product-id","NOPE"); pg.click("#add-btn"); check("not found" in pg.inner_text("#entry-msg"),"unknown id")
    pg.fill("#product-id","S003"); pg.fill("#qty","99"); pg.click("#add-btn"); check("Not enough stock" in pg.inner_text("#entry-msg"),"stock check")
    pg.fill("#product-id","S001"); pg.fill("#qty","2"); pg.click("#add-btn")
    pg.fill("#product-id","S004"); pg.fill("#qty","1"); pg.click("#add-btn")
    check(pg.inner_text("#total-usd")=="$9.00","total 9")
    pg.fill("#given","5"); check("Short" in pg.inner_text("#change-usd"),"short shown")
    pg.fill("#given","20"); check(pg.inner_text("#change-usd")=="$11.00","change 11")
    check(pg.is_disabled("#complete-btn"),"complete disabled in preview")
    pg.click("button[data-currency=KHR]"); pg.fill("#given","40000"); check(pg.inner_text("#change-khr")=="KHR 4,000","khr change")
    shot(pg, "preview_cashier")
    # remove line
    pg.click("[data-remove='1']"); check(pg.inner_text("#total-usd")=="$4.00","remove line")
    # clear cart with confirm
    pg.click("#clear-btn"); pg.wait_for_selector("dialog.modal"); pg.click("dialog.modal .btn-primary")
    pg.wait_for_timeout(200); check("Cart is empty" in pg.inner_text("#cart"),"clear cart")
    # search
    pg.fill("#global-search","rice"); pg.wait_for_timeout(100); check(pg.locator("#catalog tbody tr").count()==1,"search filters")
    # logout
    pg.click("#logout-btn"); pg.click("dialog.modal .btn-primary"); pg.wait_for_url("**/index.html"); check(True,"logout")
    # admin products validation
    pg.fill("#username","admin"); pg.fill("#password","x"); pg.click("#login-btn"); pg.wait_for_url("**/dashboard.html")
    pg.wait_for_selector("#bell-badge:not([hidden])"); pg.click("#bell-btn"); pg.wait_for_timeout(200); check("sample_eggs" in pg.inner_text("#bell-pop"),"bell popover")
    shot(pg, "preview_bell")
    pg.click("#bell-pop a"); pg.wait_for_url("**/products.html#low"); pg.wait_for_timeout(500)
    check(pg.locator("#products-table tbody tr").count()==4,"low filter via bell")
    check(pg.is_disabled("#save-btn"),"save disabled preview")
    pg.click("#products-table tbody tr >> nth=0"); check(pg.input_value("#f-name").startswith("sample_"),"edit loads row")
    check(pg.get_attribute("#f-name","readonly") is not None,"name readonly on update")
    pg.click("a[aria-label='Sales History']"); pg.wait_for_timeout(400)
    check("SAMPLE SALE" in pg.inner_text("#detail"),"sale detail")
    pg.fill("#global-search","#2"); pg.wait_for_timeout(100); check(pg.locator("#sales-table tbody tr").count()==1,"sales search by #")
    # sort
    pg.fill("#global-search",""); pg.click("#sales-table .th-sort >> nth=0"); pg.wait_for_timeout(100)
    check(pg.inner_text("#sales-table tbody tr >> nth=0").startswith("#1") or "#1" in pg.inner_text("#sales-table tbody tr >> nth=0"),"sort asc")
    # sidebar toggle
    pg.click("#menu-btn"); check(pg.is_hidden("#sidebar .nav"),"sidebar toggle")
    # resize
    pg.set_viewport_size({"width":1100,"height":900}); pg.goto(U+"/pages/dashboard.html"); pg.wait_for_timeout(500)
    shot(pg, "preview_dashboard_1100", True)
    sw = pg.evaluate("document.documentElement.scrollWidth"); check(sw<=1100,f"no horizontal scroll at 1100 ({sw})")
    pg.close()

def http_tests(b, base):
    pg = new_page(b)
    pg.goto(base + "/index.html"); pg.wait_for_timeout(400)
    check("SMART API" in pg.inner_text("#connection"), "http: connection label")
    pg.fill("#username", "admin"); pg.fill("#password", "wrong"); pg.click("#login-btn"); pg.wait_for_timeout(300)
    check("Incorrect password" in pg.inner_text("#login-msg"), "http: wrong password from API")
    pg.fill("#username", "admin"); pg.fill("#password", "123123"); pg.click("#login-btn")
    pg.wait_for_url("**/dashboard.html"); pg.wait_for_timeout(600)
    check(pg.locator("#preview-banner").count() == 0, "http: no preview banner")
    check(pg.inner_text("#kpi-revenue") == "$52.00", "http: summary from API")
    shot(pg, "http_dashboard", True)
    pg.click("a[aria-label='Manage Products']"); pg.wait_for_timeout(400)
    pg.click("#new-btn"); pg.fill("#f-id", "0001"); pg.fill("#f-name", "soap"); pg.fill("#f-price", "1.5"); pg.fill("#f-stock", "4")
    pg.click("#save-btn"); check("already exists" in pg.inner_text("#e-id"), "http: duplicate id blocked")
    pg.fill("#f-id", "0152"); pg.fill("#f-name", "hand soap"); pg.click("#save-btn")
    check("_" in pg.inner_text("#e-name"), "http: name with space blocked")
    pg.fill("#f-name", "hand_soap"); pg.click("#save-btn"); pg.wait_for_timeout(500)
    check("added successfully" in pg.inner_text("#form-msg"), "http: product added via API")
    check(pg.locator("#products-table tbody tr[data-id='0152']").count() == 1, "http: list reloaded")
    pg.fill("#f-stock", "9"); pg.click("#save-btn"); pg.wait_for_timeout(500)
    check("updated successfully" in pg.inner_text("#form-msg"), "http: product updated via API")
    shot(pg, "http_products")
    pg.click("#logout-btn"); pg.click("dialog.modal .btn-primary"); pg.wait_for_url("**/index.html")
    pg.click("button[data-role=cashier]"); pg.fill("#username", "cashier"); pg.fill("#password", "123123"); pg.click("#login-btn")
    pg.wait_for_url("**/cashier.html"); pg.wait_for_timeout(500)
    pg.fill("#product-id", "0001"); pg.fill("#qty", "3"); pg.click("#add-btn")
    pg.fill("#product-id", "0100"); pg.fill("#qty", "2"); pg.click("#add-btn")
    pg.fill("#given", "20"); check(pg.is_enabled("#complete-btn"), "http: complete enabled")
    shot(pg, "http_cashier")
    pg.click("#complete-btn"); pg.click("dialog.modal .btn-primary")       # confirm
    pg.wait_for_selector("dialog.modal pre"); text = pg.inner_text("dialog.modal")
    shot(pg, "http_receipt")
    check("TOTAL DUE:      $16.00" in text and "CHANGE (USD):   $4.00" in text, "http: receipt from API")
    pg.click("dialog.modal .btn-primary"); pg.wait_for_timeout(400)
    check("Cart is empty" in pg.inner_text("#cart"), "http: cart cleared after sale")
    check(pg.inner_text("#catalog tbody tr[data-id='0001'] td:nth-child(4)") == "7", "http: stock reloaded from API")
    # API error is shown, cart kept
    pg.fill("#product-id", "0002"); pg.fill("#qty", "1"); pg.click("#add-btn"); pg.fill("#given", "1")
    pg.route("**/api/sales/checkout", lambda r: r.fulfill(status=409, content_type="application/json",
             body='{"ok":false,"error":"Error: Not enough stock! You requested 1, but only 0 are available."}'))
    pg.click("#complete-btn"); pg.click("dialog.modal .btn-primary"); pg.wait_for_timeout(400)
    check("Not enough stock" in pg.inner_text("#pay-msg"), "http: API error shown")
    check("water" in pg.inner_text("#cart"), "http: cart kept after failed sale")
    pg.close()

def main():
    py = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "-d", ROOT], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    node = subprocess.Popen(["node", os.path.join(ROOT, "tests", "contract-stub-server.js"), "8790"], stdout=subprocess.DEVNULL)
    time.sleep(1.2)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            preview_tests(b, "http://localhost:8765")
            http_tests(b, "http://localhost:8790")
            b.close()
    finally:
        py.terminate(); node.terminate()
    print(f"passed: {len(ok)}")
    for e in errs: print("FAILED:", e)
    sys.exit(1 if errs else 0)

if __name__ == "__main__":
    main()
