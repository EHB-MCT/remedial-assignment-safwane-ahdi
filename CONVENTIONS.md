# Conventions

This document defines the conventions used in this project for **code style, architecture, naming, commits, and simulation logic**.

---

## 1. Project Structure

- **Entry Point**
  - `server.js` — Node.js/Express server.
- **Simulation**
  - `engine.js` — simulation logic (price changes, restocking, events).
- **Data Fetching**
  - `pcppClient.js` — client wrapper for Python proxy.
  - `pcpp_proxy.py` — FastAPI proxy for `pcpartpicker`.
  - `refreshFromPcpp.js` — import & update of PC parts.
- **Models**
  - `Product.js`, `Event.js`, `ProductHistory.js` — Mongoose schemas.

---

## 2. Coding Style

- **Language Choices**
  - Node.js + Express (backend, simulation).
  - Python (FastAPI) as proxy.
- **Formatting**
  - Indentation: **2 spaces**.
  - Use `const` / `let` (never `var`).
  - Always end statements with **semicolons**.
- **Imports**
  - Node.js: `require` syntax.
  - Group all imports at top of file.
- **Error Handling**
  - Use `try/catch` for async ops.
  - Prefix logs with **context tags**.

---

## 3. Environment Variables

- `.env` file required in project root.
- Supported:
  - `PORT` — server port (default: `5000`).
  - `MONGO_URI` — MongoDB connection string.
  - `TICK_MS` — simulation tick interval.
  - `PCPP_PROXY_URL_BASE` — proxy base URL (default: `http://localhost:8081`).
  - `PCPP_REGION` — default region (default: `be`).
  - `PCPP_REFRESH_MINUTES` — scheduled refresh interval (default: `30`).
  - `FULL_REFRESH_ON_BOOT` — drop collection at boot (`true`).
  - `PRESTOCK` — enable random initial stock (`true`).

---

## 4. Simulation Engine

Defined in `engine.js`.

- **Tick Settings**
  - `purchasesPerTick`: 5
  - `coldDropThresholdMs`: 30s
  - `restockChance`: 10%
  - `deltaDebounceMs`: 300ms
- **Price Rules**
  - +10% every 5th sale, clamped by `priceFloor` and `PRICE_CEILING`.
  - Cold products drop ~10% after inactivity.
  - Global events apply price multipliers.
- **Stock Rules**
  - Restock only zero-stock products.
  - Max stock capped by category (`MAX_STOCK`).
- **Events**
  - Types: `Flash Sale`, `Price Surge`, `Supply Chain Disruption`, `Hype Wave`.
  - Chance of new event: 5% per tick.
  - Expired events are auto-cleaned.

---

## 5. Models

### Product (`Product.js`)
- Fields:
  - `name`, `type`, `price`, `stock`, `salesCount`, `lastSoldAt`, `lastEventApplied`, `priceFloor`.
- Indexes:
  - `{ stock: 1 }`
  - `{ lastSoldAt: 1 }`
  - `{ lastEventApplied: 1 }`
  - `{ type: 1 }`
  - `{ updatedAt: -1 }`
- Hook:
  - Ensures `priceFloor` is initialized.

### Event (`Event.js`)
- Fields:  
  `name`, `type`, `targetProduct`, `effect`, `magnitude`, `durationMs`, `startedAt`, `endedAt`, `description`.

### ProductHistory (`ProductHistory.js`)
- Tracks snapshots of product state with `timestamp`.

---

## 6. Data Refresh

Defined in `refreshFromPcpp.js`.

- **Allowed Categories**
  - `cpu`, `video-card`, `motherboard`, `memory`, `power-supply`,  
    `cpu-cooler`, `case`, `case-fan`, `internal-hard-drive`, `solid-state-drive`.
- **Rules**
  - Max 1000 items per category.
  - Skip products with invalid prices.
  - SSD/HDD detection heuristics applied.
  - Initial stock randomized unless `PRESTOCK=false`.

---

## 7. WebSockets

- **Events**
  - `productsUpdated` → full snapshot on connect.
  - `productsDelta` → incremental updates (debounced).
- **Payload**
  - `_id, name, type, price, stock, salesCount, lastSoldAt`.

---

## 8. Logging

- Prefix log entries:
  - `[WS]` → WebSocket
  - `[SIM]` → Simulation loop
  - `[PCPP]` → Proxy/import
  - `[BOOT]` → Startup
  - `[SCHEDULED]` → Periodic tasks
  - `[FATAL]` → Critical errors

---

## 9. Commit Conventions

We use **Conventional Commits**:

- **Types**
  - `feat:` — new feature
  - `fix:` — bug fix
  - `docs:` — documentation only changes
  - `style:` — code style (no logic change)
  - `refactor:` — restructuring without changing behavior
  - `perf:` — performance improvements
  - `test:` — add/update tests
  - `chore:` — maintenance tasks
- **Format**


- **Examples**
- `feat(engine): add cold drop price mechanism`
- `fix(proxy): handle timeout errors correctly`
- `docs: update conventions.md with commit rules`
- `refactor(models): simplify product schema indexes`
