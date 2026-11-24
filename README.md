# Stockyard – Smart Inventory & Warehouse Management (Node + Express + PostgreSQL)

## Run it (Windows)
1. Install Node.js (LTS) from nodejs.org and PostgreSQL from postgresql.org. Make sure the PostgreSQL service is running (Win+R, `services.msc`, start `postgresql-x64-...`).
2. Unzip the project, open the `inventory-app` folder, and double-click **start.bat**.
3. When asked, type your PostgreSQL password. The script finds PostgreSQL, creates the `inventory` database, loads the tables and sample data, saves settings to `db.json`, and starts the app.
4. Your browser opens http://localhost:3000. Keep the black window open while using the app.

Next time, just double-click start.bat again (your data is kept).

Manual alternative: `npm install`, `node setup.js`, `npm start`. To wipe and reload the sample data: `npm run reset`.


