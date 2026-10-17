# SMART API contract (for connecting the frontend to your C++ backend)

**Status: proposed. No server implements this yet.**
Your backend (`main.cpp`) is a console program (`cin`/`cout`) and has no HTTP
interface, so a browser cannot talk to it directly. This file defines exactly
what the frontend sends and expects, so that a small HTTP layer can be added
later **without changing the frontend**. Every endpoint below maps to an
existing function in your `main.cpp`; nothing new is invented on the business side.

The frontend calls these only when `config/config.json` has
`"apiMode": "http"`. In `"preview"` mode it uses built-in sample data and never
calls the network.

---

## Conventions

- Base URL: `apiBaseUrl` in `config/config.json` (default `http://localhost:8080/api`).
- Requests and responses are JSON (`Content-Type: application/json`).
- After login, every request sends `Authorization: Bearer <token>`.
- Success: HTTP `200` with the body shown below.
- Failure: any non-2xx status with `{ "ok": false, "error": "<message to show the user>" }`.
  The frontend shows `error` as-is, so it should be the backend's own message
  (e.g. `"Error: Not enough stock! You requested 99, but only 40 are available."`).
- Money: `price`, `totalUsd`, etc. are numbers in USD; KHR values are whole riels.
  Exchange rate in the backend: **1 USD = 4000 KHR**.
- Status codes the frontend handles: `400` invalid input, `401` not logged in /
  wrong password, `403` wrong role, `404` not found, `409` conflict
  (duplicate ID, not enough stock, inventory full), `5xx` backend failure.

---

## 1. Login — `login_admin()` / `login_cashier()`

`POST /login`
```json
{ "role": "admin", "username": "admin", "password": "123123" }
```
`role` is `"admin"` (welcome menu 1) or `"cashier"` (welcome menu 2).
Checked against `admin_login.txt` / `cashier_login.txt`.

Response
```json
{ "ok": true, "token": "opaque-session-token", "role": "admin", "username": "admin" }
```
Errors: `401 { "ok": false, "error": "Incorrect password. Try again." }`

`POST /logout` → `{ "ok": true }`  (admin menu 4)

---

## 2. Products — `managing_product()` (admin) and `product.txt`

`GET /products`  — option 1 "View all products". Admin; cashier needs it read-only for the sale screen.
```json
{ "ok": true, "products": [
  { "id": "0001", "name": "bread", "price": 2, "stock": 10 }
] }
```

`POST /products` — option 2 "Add a new product" (admin only)
```json
{ "id": "0152", "name": "orange_juice", "price": 1.5, "stock": 20 }
```
Rules the backend applies: max **150** products (`MAX_PRODUCTS`), values read
with `cin >>` (no spaces — use `_`), file is comma-separated (no commas).
Response `{ "ok": true, "message": "Product added successfully!" }`
Errors: `409 "Inventory is full! Cannot add more products."`, `409` duplicate ID, `400` invalid value.

`PUT /products/{id}` — option 3 "Update existing product stock/price" (admin only)
```json
{ "price": 2.5, "stock": 30 }
```
Only price and stock can change (that's all option 3 supports).
Response `{ "ok": true, "message": "Product updated successfully!" }`
Errors: `404 "Product ID not found."`

There is **no delete endpoint**: the backend has no delete option, so the
frontend doesn't offer one.

---

## 3. Sales history — `view_sales_history()` (admin)

`GET /sales`
```json
{ "ok": true, "sales": [
  { "number": 1, "lines": [ { "name": "bread", "quantity": 10 } ], "totalUsd": 20,
    "raw": "================ RECEIPT ================\nbread x10\nTOTAL_USD:20\n=====..." },
  { "number": 3, "lines": [ { "name": "bread", "quantity": 3 } ], "totalUsd": 6,
    "raw": "--- NEW SALE ---\n3x bread\nTOTAL_USD:6\n----------------" }
] }
```
`sales_history.txt` contains two formats (old `RECEIPT / name xQty`, new
`--- NEW SALE --- / Qtyx name`). The server should return both as the JSON above;
`raw` is the block exactly as stored and is shown on the Sales History page.
`number` = position in the file (1 = oldest). There are no dates in the file.

---

## 4. Daily summary — `view_daily_summary()` (admin)

`GET /summary`
```json
{ "ok": true, "transactions": 2, "revenueUsd": 52, "revenueKhr": 208000 }
```
When the history file doesn't exist:
`{ "ok": true, "transactions": 0, "revenueUsd": 0, "revenueKhr": 0, "message": "No sales data available to summarize." }`

---

## 5. Sale — `cashier_mainMenu()` (cashier)

`POST /sales/checkout`
```json
{
  "items":   [ { "id": "0001", "quantity": 3 }, { "id": "0100", "quantity": 2 } ],
  "payment": { "currency": "USD", "amount": 20 }
}
```
`currency` is `"USD"` (money type 1) or `"KHR"` (money type 2; `amount` in whole riels).
The backend must, in this order: look up each ID, check stock
(`quantity <= stock`, `> 0`), compute the total, check the money given covers
the total, then reduce stock in `product.txt` and append the sale to
`sales_history.txt`. If any step fails, **nothing is saved**.

Response — the numbers the backend printed on its receipt:
```json
{
  "ok": true,
  "receipt": {
    "lines": [ { "id": "0001", "name": "bread", "quantity": 3, "price": 2, "subtotal": 6 },
               { "id": "0100", "name": "strawberries", "quantity": 2, "price": 5, "subtotal": 10 } ],
    "totalUsd": 16, "totalKhr": 64000
  },
  "change": { "usd": 4, "khr": 16000 },
  "saleNumber": 4
}
```
Errors:
- `404 "Error: Product ID '9999' not found. Try again."`
- `409 "Error: Not enough stock! You requested 99, but only 40 are available."`
- `400 "Not enough money: total is $16.00."` (the console backend does not check this
  today; the HTTP layer must, or reject before saving)
- `400 "Cart limit reached! Cannot add more items."` (more than 100 lines, `MAX_CART_ITEMS`)

---

## How to provide this API without rewriting the backend

Two options, both need your approval first:

1. **Bridge program (backend untouched).** A small local server that runs your
   compiled `smart_backend` and answers its menus (the same technique as the
   earlier Qt version). Your `.cpp` and `.txt` files stay exactly as they are.
2. **Add HTTP to the backend.** Add a small HTTP library to `main.cpp` and move
   the menu logic into functions the endpoints call. This changes your backend.

The frontend works with either, as long as the responses match this contract.
