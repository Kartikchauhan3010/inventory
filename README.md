# Stockyard – Smart Inventory & Warehouse Management (Node + Express + PostgreSQL)

## Run it (Windows)
1. Install Node.js (LTS) from nodejs.org and PostgreSQL from postgresql.org. Make sure the PostgreSQL service is running (Win+R, `services.msc`, start `postgresql-x64-...`).
2. Unzip the project, open the `inventory-app` folder, and double-click **start.bat**.
3. When asked, type your PostgreSQL password. The script finds PostgreSQL, creates the `inventory` database, loads the tables and sample data, saves settings to `db.json`, and starts the app.
4. Your browser opens http://localhost:3000. Keep the black window open while using the app.

Next time, just double-click start.bat again (your data is kept).

Manual alternative: `npm install`, `node setup.js`, `npm start`. To wipe and reload the sample data: `npm run reset`.

## Corrections made to the original design
1. Added the missing `purchase_orders` and `purchase_order_items` tables (source of INBOUND stock).
2. Removed `idx_inventory_prod_wh`: the UNIQUE (product_id, warehouse_id) constraint already creates that index.
3. `products.category_id` is NOT NULL, so Query A's join cannot silently drop products.
4. Low-stock rule is "at or below" the reorder level (`<=`) and is described that way everywhere.
5. `sales_order_items.unit_price` is documented as a price snapshot (history, not a 3NF violation).
6. Stock changes happen in one transaction with `SELECT ... FOR UPDATE`, so `inventory` and `stock_movements` never drift apart and two sales cannot oversell the same unit.
7. CHECK constraints on `status` columns, plus `chk_movement_warehouses` (INBOUND has only a target, OUTBOUND only a source, TRANSFER has two different warehouses).
8. Monthly CTE reports transfers in their own column, since they don't change the global total.
9. Extras: warehouse capacity is enforced when stock is added; every column that should be required is NOT NULL.

## Viva talking points
- Why transactions + row locks? (atomicity, isolation, no lost updates)
- Why surrogate keys but still UNIQUE on natural keys (sku, email)?
- 3NF: supplier cost lives in purchase_order_items; price history lives in sales_order_items.
- Where would you add a trigger? (e.g. auto-update `last_updated`, or enforce stock sync inside the DB instead of the app)
