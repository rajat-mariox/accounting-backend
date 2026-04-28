# Account Software — Backend

Node.js + Express + MongoDB + JWT API for the AccounTech / Jubba accounting dashboard. Pairs with the React SPA in [`../account-software`](../account-software/).

## Stack

- Node.js 18+
- Express 4
- MongoDB (via Mongoose 8)
- JWT auth (jsonwebtoken) with bcryptjs password hashing

## Setup

```bash
cd backend
cp .env.example .env       # then edit values
npm install
npm run seed               # optional: load demo data + admin user
npm run dev                # http://localhost:5000
```

`.env` keys:

| Key | Default | Notes |
| --- | --- | --- |
| `PORT` | `5000` | API port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/account_software` | Mongo connection string |
| `JWT_SECRET` | — | **Required.** Long random string |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime |
| `CORS_ORIGIN` | `http://localhost:5173` | Vite dev origin; comma-separate to allow multiple |

After `npm run seed`, log in with **admin@accountech.com / admin1234**.

## API surface

All endpoints are JSON. Protected routes require `Authorization: Bearer <token>`.

### Auth — `/api/auth`
- `POST /register` — `{ name, email, password, phone?, role? }`
- `POST /login` — `{ email, password }` → `{ user, token }`
- `GET /me` *(protected)*

### Users — `/api/users` *(protected; mutations require Administrator)*
- `GET /` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`

### Clients — `/api/clients` *(protected)*
- `GET /` (`?q=` search) · `GET /:id` (returns invoiceHistory) · `POST /` · `PUT /:id` · `DELETE /:id`

### Suppliers — `/api/suppliers` *(protected)*
- `GET /` (with aggregated `activities` + `total`) · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`
- `GET /activities` · `POST /activities`

### Inventory — `/api/inventory` *(protected)*
- `GET /` · `GET /overview` · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`

### Warehouses — `/api/warehouses` *(protected)*
- `GET /` (with aggregated `totalItems` + `totalStock`) · `POST /` · `PUT /:id` · `DELETE /:id`

### Transfers — `/api/transfers` *(protected)*
- `GET /` · `POST /` — `{ item, from, to, qty, date? }`

### Invoices — `/api/invoices` *(protected)*
- `GET /` (`?status=&q=`) · `GET /:id` · `POST /` · `PUT /:id` · `DELETE /:id`
- `PATCH /:id/status` — `{ status: 'paid'|'pending'|'overdue'|'cancelled' }`

### Payments — `/api/payments` *(protected)*
- `GET /` · `POST /` — `{ invoice, amount, mode, reference?, date? }` (auto-marks invoice paid when fully covered)
- `DELETE /:id`

### Audit logs — `/api/audit-logs` *(protected; Administrator/Manager)*
- `GET /` (`?module=&action=&user=&limit=`)

### Settings — `/api/settings` *(protected)*
- `GET /` · `GET /:key` (`company` | `tax`) · `PUT /:key` *(Administrator)*

### Reports — `/api/reports` *(protected)*
- `GET /dashboard` — totals, outstanding, low-stock, recent invoices
- `GET /sales?from=&to=` — monthly sales aggregation
- `GET /top-clients` — top 10 clients by invoiced amount

### Notifications — `/api/notifications` *(protected)*
- `GET /` — list (auto-refreshes derived alerts: low-stock, out-of-stock, overdue invoices). Query params: `?unread=true`, `?category=Invoice|Payment|LowStock|Overdue|System`, `?limit=`
- `GET /unread-count` — `{ count }` for the bell badge
- `POST /:id/read` — mark a notification read
- `POST /read-all` — mark all read
- `DELETE /:id` — delete one
- `DELETE /` — clear all read notifications

Notifications are auto-emitted on invoice creation, invoice paid (PATCH or full payment), and payment recorded. Low-stock / out-of-stock / overdue alerts are derived idempotently on every list call (keyed by item or invoice id, so they don't duplicate). When stock is replenished or an invoice is paid, the corresponding alert is removed.

### Health
- `GET /api/health`

## Project layout

```
src/
  app.js              Express app + middleware + routes
  server.js           Boot + DB connect
  config/db.js        Mongoose connection
  middleware/
    auth.js           JWT protect + role authorize
    audit.js          Writes audit log entries
    errorHandler.js   404 + central error formatter
  models/             Mongoose schemas
  controllers/        Route handlers (express-async-handler)
  routes/             Express routers
  utils/
    generateToken.js  jwt.sign helper
    seed.js           Demo data loader (npm run seed)
```

## Notes

- Passwords are hashed with bcrypt (10 rounds) on save.
- Audit logging is automatic for create/update/delete on most domains and on login.
- Invoices store a denormalized `clientName`; payments store a denormalized `invoiceNumber` so list views avoid joins.
- The transfer handler is a single-warehouse-per-item simplification — extend `InventoryItem` with a per-warehouse stock map if you need split inventory.
