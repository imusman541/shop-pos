# Shop POS

A cross-platform desktop Point of Sale app for managing **products, orders, and sales analytics**.
Runs fully offline as a native app on **Windows, macOS, and Linux** — no server, no localhost, no internet required. All data lives in a local SQLite database on the machine.

Built with **Electron + electron-vite + React + better-sqlite3 + Recharts + SheetJS (xlsx)**.

---

## Features

**Dashboard**
- Start / end date range filter
- Line chart with three lines: Sales, Profit, and Items Sold (Items uses a second axis so it stays readable next to money)
- Custom hover tooltip showing the date plus Sales, Profit and Items sold
- KPI cards: Total Sales, Profit, Total Items Sold
- Sales and profit follow payment dates (partial payments count only what was received)
- Cancelled orders are excluded from totals

**Products**
- Filter by name, by status (In Stock / Out of Stock), and by price (greater than / less than / equal to a number)
- Create and Edit products (image, name, quantity, net price, margin/profit, status)
- Image upload (stored with the product)
- Export all products to Excel
- Import products from an Excel/CSV file
- Table with 25 rows per page and pagination
- Every product gets a unique **product number** (shown in the table, filters and exports)

**Orders**
- Filter by Order ID, Product ID, Product name, date range, and status (Paid / Not paid / Partially Paid / Cancelled)
- Create and Edit orders (product, quantity, price, margin/profit, status)
- If you leave price or margin blank, they are pulled automatically from the linked product
- Export all orders to Excel
- Table with 25 rows per page and pagination
- Every order gets a unique **order number**

---

## 1. Prerequisites

Install **Node.js LTS (v18 or v20+)** from https://nodejs.org — this includes `npm`.

`better-sqlite3` is a native module. In most cases a prebuilt binary is downloaded automatically, but if your machine needs to compile it, you also need build tools:

- **Windows:** during the Node.js install, tick **"Tools for Native Modules"** (installs Python + Visual Studio Build Tools). 
- **macOS:** run `xcode-select --install` once.
- **Linux:** install `build-essential` and `python3` (e.g. `sudo apt install build-essential python3`).

---

## 2. Install and run (development)

From the project folder:

```bash
npm install
npm run dev
```

`npm run dev` opens the app in a window with hot-reload. The first launch seeds a few sample products and two weeks of sample orders so the dashboard isn't empty — you can delete them anytime.

> The local database file is created automatically at your OS user-data folder:
> - Windows: `%APPDATA%/shop-pos/pos.db`
> - macOS: `~/Library/Application Support/shop-pos/pos.db`
> - Linux: `~/.config/shop-pos/pos.db`

---

## 3. Build a distributable app

```bash
# builds an installer for your current OS
npm run build:win      # Windows  -> dist/  (.exe installer)
npm run build:mac      # macOS    -> dist/  (.dmg)
npm run build:linux    # Linux    -> dist/  (.AppImage)
```

The output goes to the `dist/` folder. Share that installer with anyone — they don't need Node.js to run it.

---

## 4. Excel import format (Products)

The importer is flexible about column names. A simple sheet like this works:

| name            | quantity | net_price | margin | status        |
|-----------------|----------|-----------|--------|---------------|
| Coca Cola 500ml | 120      | 80        | 20     | in_stock      |
| Nestle Water    | 0        | 70        | 18     | out_of_stock  |

`status` accepts `in_stock` / `out_of_stock` (anything containing "out" becomes out of stock). Tip: use **Export** first to get a template with the right columns.

---

## 5. Push to GitHub

From the project folder:

```bash
git init
git add .
git commit -m "Initial commit: Shop POS"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/shop-pos.git
git push -u origin main
```

`node_modules/`, `out/`, and `dist/` are already excluded via `.gitignore`, so only source is pushed. Anyone who clones it just runs `npm install` then `npm run dev`.

---

## Project structure

```
shop-pos/
├── package.json
├── electron.vite.config.js      # build config (main / preload / renderer)
├── electron-builder.yml         # packaging config for installers
├── src/
│   ├── main/                    # Electron main process (Node)
│   │   ├── index.js             # window creation, app lifecycle
│   │   ├── database.js          # SQLite schema + all queries + Excel I/O + seed
│   │   └── handlers.js          # IPC handlers wiring UI calls to the database
│   ├── preload/
│   │   └── index.js             # safe window.api bridge (contextIsolation)
│   └── renderer/                # React UI
│       ├── index.html
│       └── src/
│           ├── main.jsx
│           ├── App.jsx          # sidebar + page routing
│           ├── index.css        # theme
│           ├── lib/format.js    # currency / date helpers
│           ├── components/      # Modal, Pagination, Toast, icons
│           └── pages/           # Dashboard, Products, Orders
```

---

## Customizing

- **Currency:** edit `CURRENCY` at the top of `src/renderer/src/lib/format.js` (default `Rs `). Use `$`, `£`, `₹`, etc.
- **Rows per page:** change `PAGE_SIZE` in `Products.jsx` / `Orders.jsx`.
- **App name / installer:** edit `productName` and `appId` in `electron-builder.yml`.

---

## Good next steps (not yet included)

- Automatic backup of `pos.db` to a second folder / cloud drive on a schedule (important for a real shop).
- Decrement product stock automatically when a Paid, Not paid, or Partially Paid order is created.
- Receipt printing to a thermal printer (ESC/POS) and barcode-scanner support (scanners type into the focused field, so very little code is needed).
- Login / multiple cashier accounts.

---

## Notes

- Product images are stored inside the database as data URLs for simplicity. This is fine for a small shop; if you store thousands of large images, switch to saving image files on disk and storing only the path.
- This is a local-only app, so it does not set a strict Content-Security-Policy. If you harden it for wider distribution, add a CSP and serve images via a custom protocol.
