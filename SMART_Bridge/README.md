# SMART Bridge — connects the web frontend to your C++ backend

```
 browser (SMART_Frontend)  ──HTTP/JSON──▶  smart_bridge.py  ──types into──▶  smart_backend.exe  ──▶  your .txt files
                                           (this folder)     ◀─reads output─  (your main.cpp, unchanged)
```

- Runs your **compiled** `main.cpp` and answers its menus like a person typing.
- Gives the browser the API in `SMART_Frontend/docs/API_CONTRACT.md` and serves the frontend pages.
- **Does not change or copy** your `main.cpp` or `.txt` files. Only your backend writes them.
  Only exception: the cashier product list is read from `product.txt` read-only
  (your backend has no cashier "list products" option).
- Python 3.8+, standard library only. Nothing to install.
- Listens on `127.0.0.1` only (this computer).

## Folder layout it expects

```
C:\Projects\
├── SMART_backend\     main.cpp, smart_backend.exe, product.txt, sales_history.txt, admin_login.txt, cashier_login.txt
├── SMART_Frontend\    the web frontend
└── SMART_Bridge\      this folder
```

## Steps

1. Compile your backend (once, and again after you change `main.cpp`):
   ```
   cd C:\Projects\SMART_backend
   g++ -std=c++17 main.cpp -o smart_backend.exe
   ```
2. Double-click `start_smart.bat` (or run the command below).
3. The browser opens `http://localhost:8080`. Log in with your real
   username/password from `admin_login.txt` / `cashier_login.txt`.
4. Keep the black bridge window open while using SMART. Ctrl+C closes it.

Manual start / different folders:
```
python smart_bridge.py --backend C:\path\smart_backend.exe --data C:\path\to\txt_files --frontend C:\path\SMART_Frontend
```
Options: `--port 8080`, `--verbose` (prints every request and the backend's console output — useful when something fails).

## What it does for each screen

| Frontend request | Backend keystrokes |
|---|---|
| Login | `1`/`2` → username → password (then logout/exit) |
| Dashboard / Sales History / Summary | admin `1`, `2` |
| Products list / add / update | admin `3` → `1` / `2` / `3` |
| Complete sale | cashier: ID → qty (each item) → `0` → `1`/`2` → money |

Checks the bridge adds because `main.cpp` doesn't do them (stopped **before**
anything is saved): money given must cover the total, no duplicate product IDs,
no spaces/commas in IDs and names, ID `0` not allowed.
If an item fails (unknown ID, not enough stock), the backend run is stopped —
`main.cpp` only writes files after payment, so nothing is saved.

## Notes

- Use one bridge on one computer. Two at once would both rewrite `product.txt`.
- Logins are kept in the bridge's memory only, and forgotten when it stops.
- If you change a menu text/prompt in `main.cpp`, update the matching line at
  the top of `smart_bridge.py` (section "Prompts printed by main.cpp").

## Tested

Ubuntu, Python 3.13, your new `main.cpp` compiled with g++, on a copy of your
`.txt` files, driven through the real frontend in headless Chromium:
wrong/right logins, dashboard ($52.00 / 2 sales), 101 products, add + update
product (checked in `product.txt`), USD sale with receipt and change, KHR
sale, stock and `sales_history.txt` written by your backend, short money /
unknown ID / too much quantity refused with files unchanged, role and token
checks. 20/20 passed. **Not yet run on Windows.**
