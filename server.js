const express = require('express'), path = require('path'), fs = require('fs'), { Pool } = require('pg');
const cfgFile = path.join(__dirname, 'db.json');
const dbCfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
const pool = new Pool(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : dbCfg);  // db.json is written by setup.js
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const q = (t, p) => pool.query(t, p).then(r => r.rows);
const fail = (m, s = 400) => Object.assign(new Error(m), { status: s });
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  const msg = e.status ? e.message : (e.detail || e.message || e.code || 'Cannot connect to the database. Run setup again (start.bat).');
  res.status(e.status || 400).json({ error: msg });
});
const posInt = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw fail(`${name} must be a positive whole number`); return n; };

// Every stock change runs inside ONE transaction; rows are locked with FOR UPDATE
// so two simultaneous sales cannot both spend the same last unit.
async function tx(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
async function removeStock(c, pid, wid, qty) {
  const r = await c.query('SELECT quantity_on_hand FROM inventory WHERE product_id=$1 AND warehouse_id=$2 FOR UPDATE', [pid, wid]);
  if (!r.rows[0] || r.rows[0].quantity_on_hand < qty) throw fail(`Not enough stock for product ${pid} in warehouse ${wid}`);
  await c.query('UPDATE inventory SET quantity_on_hand=quantity_on_hand-$3, last_updated=now() WHERE product_id=$1 AND warehouse_id=$2', [pid, wid, qty]);
}
async function addStock(c, pid, wid, qty) {
  await c.query(`INSERT INTO inventory(product_id,warehouse_id,quantity_on_hand) VALUES($1,$2,$3)
    ON CONFLICT (product_id,warehouse_id) DO UPDATE SET quantity_on_hand=inventory.quantity_on_hand+$3, last_updated=now()`, [pid, wid, qty]);
  const r = await c.query(`SELECT w.capacity, COALESCE(SUM(i.quantity_on_hand),0) AS used FROM warehouses w
    JOIN inventory i ON i.warehouse_id=w.warehouse_id WHERE w.warehouse_id=$1 GROUP BY w.capacity`, [wid]);
  if (r.rows[0] && Number(r.rows[0].used) > r.rows[0].capacity) throw fail('Warehouse capacity exceeded');
}
const move = (c, pid, src, tgt, type, qty) => c.query(
  'INSERT INTO stock_movements(product_id,source_warehouse_id,target_warehouse_id,movement_type,quantity) VALUES($1,$2,$3,$4,$5)',
  [pid, src, tgt, type, qty]);

// ---- lookups & simple creates
const simple = (route, table, cols, order) => {
  app.get('/api/' + route, wrap(async (_, res) => res.json(await q(`SELECT * FROM ${table} ORDER BY ${order}`))));
  app.post('/api/' + route, wrap(async (req, res) => {
    const vals = cols.map(c => req.body[c] === '' ? null : req.body[c]);
    const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
    res.json((await q(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${ph}) RETURNING *`, vals))[0]);
  }));
};
simple('categories', 'categories', ['category_name', 'description'], 'category_name');
simple('suppliers', 'suppliers', ['supplier_name', 'contact_email', 'phone', 'address'], 'supplier_name');
simple('warehouses', 'warehouses', ['warehouse_name', 'location', 'capacity'], 'warehouse_name');

app.get('/api/products', wrap(async (_, res) => res.json(await q(
  `SELECT p.*, c.category_name FROM products p JOIN categories c USING(category_id) ORDER BY p.product_name`))));
app.post('/api/products', wrap(async (req, res) => {
  const b = req.body;
  res.json((await q(`INSERT INTO products(sku,product_name,category_id,unit_price,reorder_level) VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [b.sku, b.product_name, b.category_id, b.unit_price, b.reorder_level || 10]))[0]);
}));
app.get('/api/inventory', wrap(async (_, res) => res.json(await q(
  `SELECT p.sku, p.product_name, w.warehouse_name, i.quantity_on_hand, p.reorder_level, i.last_updated
   FROM inventory i JOIN products p USING(product_id) JOIN warehouses w USING(warehouse_id)
   ORDER BY p.product_name, w.warehouse_name`))));

// ---- purchasing
app.get('/api/purchase-orders', wrap(async (_, res) => res.json(await q(
  `SELECT po.po_id, po.order_date, po.status, s.supplier_name,
          string_agg(p.product_name||' x'||i.quantity, ', ') AS items, SUM(i.quantity*i.unit_cost) AS total
   FROM purchase_orders po JOIN suppliers s USING(supplier_id)
   JOIN purchase_order_items i USING(po_id) JOIN products p USING(product_id)
   GROUP BY po.po_id, s.supplier_name ORDER BY po.po_id DESC`))));
app.post('/api/purchase-orders', wrap(async (req, res) => {
  const { supplier_id, items } = req.body;
  if (!Array.isArray(items) || !items.length) throw fail('Add at least one item');
  res.json(await tx(async c => {
    const po = (await c.query('INSERT INTO purchase_orders(supplier_id) VALUES($1) RETURNING po_id', [supplier_id])).rows[0];
    for (const it of items)
      await c.query('INSERT INTO purchase_order_items(po_id,product_id,quantity,unit_cost) VALUES($1,$2,$3,$4)',
        [po.po_id, it.product_id, posInt(it.quantity, 'Quantity'), it.unit_cost]);
    return po;
  }));
}));
app.post('/api/purchase-orders/:id/receive', wrap(async (req, res) => {
  const wid = req.body.warehouse_id;
  res.json(await tx(async c => {
    const po = (await c.query('SELECT status FROM purchase_orders WHERE po_id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!po) throw fail('Purchase order not found', 404);
    if (po.status !== 'PENDING') throw fail('Only PENDING orders can be received');
    const items = (await c.query('SELECT product_id, quantity FROM purchase_order_items WHERE po_id=$1', [req.params.id])).rows;
    for (const it of items) { await addStock(c, it.product_id, wid, it.quantity); await move(c, it.product_id, null, wid, 'INBOUND', it.quantity); }
    await c.query("UPDATE purchase_orders SET status='RECEIVED' WHERE po_id=$1", [req.params.id]);
    return { ok: true };
  }));
}));

// ---- sales
app.get('/api/sales', wrap(async (_, res) => res.json(await q(
  `SELECT so.sale_id, so.sale_date, so.customer_name, so.status,
          string_agg(p.product_name||' x'||i.quantity||' ('||w.warehouse_name||')', ', ') AS items,
          SUM(i.quantity*i.unit_price) AS total
   FROM sales_orders so JOIN sales_order_items i USING(sale_id) JOIN products p USING(product_id)
   JOIN warehouses w USING(warehouse_id) GROUP BY so.sale_id ORDER BY so.sale_id DESC`))));
app.post('/api/sales', wrap(async (req, res) => {
  const { customer_name, items } = req.body;
  if (!customer_name) throw fail('Customer name is required');
  if (!Array.isArray(items) || !items.length) throw fail('Add at least one item');
  res.json(await tx(async c => {
    const sale = (await c.query('INSERT INTO sales_orders(customer_name) VALUES($1) RETURNING sale_id', [customer_name])).rows[0];
    for (const it of items) {
      const qty = posInt(it.quantity, 'Quantity');
      const price = (await c.query('SELECT unit_price FROM products WHERE product_id=$1', [it.product_id])).rows[0];
      if (!price) throw fail('Unknown product');
      await removeStock(c, it.product_id, it.warehouse_id, qty);
      await c.query('INSERT INTO sales_order_items(sale_id,product_id,warehouse_id,quantity,unit_price) VALUES($1,$2,$3,$4,$5)',
        [sale.sale_id, it.product_id, it.warehouse_id, qty, price.unit_price]);
      await move(c, it.product_id, it.warehouse_id, null, 'OUTBOUND', qty);
    }
    return sale;
  }));
}));

// ---- transfers & movements
app.post('/api/transfers', wrap(async (req, res) => {
  const { product_id, source_warehouse_id, target_warehouse_id } = req.body;
  const qty = posInt(req.body.quantity, 'Quantity');
  if (source_warehouse_id === target_warehouse_id) throw fail('Source and target must differ');
  res.json(await tx(async c => {
    await removeStock(c, product_id, source_warehouse_id, qty);
    await addStock(c, product_id, target_warehouse_id, qty);
    await move(c, product_id, source_warehouse_id, target_warehouse_id, 'TRANSFER', qty);
    return { ok: true };
  }));
}));
app.get('/api/movements', wrap(async (_, res) => res.json(await q(
  `SELECT m.created_at, p.product_name, m.movement_type, m.quantity, sw.warehouse_name AS from_wh, tw.warehouse_name AS to_wh
   FROM stock_movements m JOIN products p USING(product_id)
   LEFT JOIN warehouses sw ON sw.warehouse_id=m.source_warehouse_id
   LEFT JOIN warehouses tw ON tw.warehouse_id=m.target_warehouse_id
   ORDER BY m.created_at DESC, m.movement_id DESC LIMIT 50`))));

// ---- reports (the three analytical queries from the design)
app.get('/api/reports/low-stock', wrap(async (_, res) => res.json(await q(
  `SELECT p.sku, p.product_name, c.category_name, COALESCE(SUM(i.quantity_on_hand),0) AS total_stock, p.reorder_level,
          GREATEST(p.reorder_level - COALESCE(SUM(i.quantity_on_hand),0), 0) AS shortfall
   FROM products p JOIN categories c USING(category_id) LEFT JOIN inventory i USING(product_id)
   GROUP BY p.product_id, c.category_name
   HAVING COALESCE(SUM(i.quantity_on_hand),0) <= p.reorder_level   -- "at or below" the reorder level
   ORDER BY total_stock`))));
app.get('/api/reports/fast-moving', wrap(async (_, res) => res.json(await q(
  `SELECT p.sku, p.product_name, SUM(soi.quantity) AS units_sold, COUNT(DISTINCT soi.sale_id) AS orders,
          SUM(soi.quantity*soi.unit_price) AS revenue
   FROM sales_order_items soi JOIN products p USING(product_id) JOIN sales_orders so USING(sale_id)
   WHERE so.sale_date >= CURRENT_DATE - INTERVAL '30 days' AND so.status='COMPLETED'
   GROUP BY p.product_id ORDER BY units_sold DESC LIMIT 10`))));
app.get('/api/reports/monthly-movement', wrap(async (_, res) => res.json(await q(
  `WITH monthly AS (
     SELECT DATE_TRUNC('month', created_at) AS month, product_id,
            SUM(quantity) FILTER (WHERE movement_type='INBOUND') AS inflow,
            SUM(quantity) FILTER (WHERE movement_type='OUTBOUND') AS outflow,
            SUM(quantity) FILTER (WHERE movement_type='TRANSFER') AS transferred
     FROM stock_movements GROUP BY 1, 2)
   SELECT to_char(m.month,'Mon YYYY') AS month, p.sku, p.product_name,
          COALESCE(m.inflow,0) AS inflow, COALESCE(m.outflow,0) AS outflow, COALESCE(m.transferred,0) AS transferred,
          COALESCE(m.inflow,0)-COALESCE(m.outflow,0) AS net_change,
          CASE WHEN COALESCE(m.inflow,0)-COALESCE(m.outflow,0) < 0 THEN 'Depleting'
               WHEN COALESCE(m.inflow,0)-COALESCE(m.outflow,0) > 0 THEN 'Accumulating' ELSE 'Balanced' END AS status
   FROM monthly m JOIN products p USING(product_id) ORDER BY m.month DESC, net_change`))));

pool.query('SELECT COUNT(*) FROM products').then(
  () => app.listen(process.env.PORT || 3000, () => console.log('Running on http://localhost:' + (process.env.PORT || 3000))),
  e => { console.error('\nCannot use the database: ' + (e.message || e.code) + '\nRun:  node setup.js   (or double-click start.bat) and try again.'); process.exit(1); });
