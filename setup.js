// One-time setup: finds PostgreSQL, creates the database, loads the schema, writes .env
const fs = require('fs'), path = require('path'), readline = require('readline'), { Client } = require('pg');
const ENV = path.join(__dirname, 'db.json'), RESET = process.argv.includes('--reset'), DBNAME = 'inventory';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, d) => new Promise(r => rl.question(d !== undefined ? `${q} [${d}]: ` : `${q}: `, a => r(a.trim() || d || '')));
const log = m => console.log(m);

function readEnv() {
  try { return JSON.parse(fs.readFileSync(ENV, 'utf8')); } catch { return {}; }
}
async function connect(cfg, database) {
  const c = new Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database, connectionTimeoutMillis: 4000 });
  c.on('error', () => {});
  await c.connect();
  return c;
}
async function findServer(cfg) {
  // Try the usual PostgreSQL ports; stop on the first server that answers.
  const ports = cfg.port ? [cfg.port] : [5432, 5433, 5434];
  let lastErr;
  for (const port of ports) {
    try { const c = await connect({ ...cfg, port }, 'postgres'); return { client: c, port }; }
    catch (e) {
      lastErr = e;
      if (e.code === '28P01' || e.code === '28000') { e.port = port; throw e; }   // server found, wrong password
    }
  }
  throw lastErr;
}

(async () => {
  log('\n=== Stockyard setup ===\n');
  const old = readEnv();
  let cfg = { host: old.host || '127.0.0.1', port: old.port ? Number(old.port) : null, user: old.user || 'postgres', password: old.password };
  let found = null;

  for (let attempt = 1; attempt <= 4 && !found; attempt++) {
    if (cfg.password === undefined || attempt > 1 || process.argv.includes('--ask')) {
      cfg.password = await ask('Enter your PostgreSQL password (the one you chose when installing PostgreSQL)');
    }
    try { found = await findServer(cfg); }
    catch (e) {
      if (e.code === '28P01' || e.code === '28000') { log(`\n  X Wrong password for user "${cfg.user}". Try again (${attempt}/4).\n`); cfg.password = undefined; continue; }
      log('\n  X Could not reach PostgreSQL on 127.0.0.1 (ports 5432, 5433, 5434).');
      log('    Fix: press Win+R, type services.msc, find "postgresql-x64-..." and click Start.');
      const p = await ask('    If PostgreSQL uses another port, type it here (or press Enter to quit)', '');
      if (!p) { log('\nSetup stopped. Start the PostgreSQL service and run this again.'); rl.close(); process.exit(1); }
      cfg.port = Number(p); cfg.password = undefined; attempt--;
    }
  }
  if (!found) { log('\nSetup stopped: password not accepted.'); rl.close(); process.exit(1); }
  cfg.port = found.port;
  log(`  OK Connected to PostgreSQL on port ${found.port}`);

  const exists = await found.client.query('SELECT 1 FROM pg_database WHERE datname=$1', [DBNAME]);
  if (!exists.rowCount) { await found.client.query(`CREATE DATABASE ${DBNAME}`); log(`  OK Created database "${DBNAME}"`); }
  else log(`  OK Database "${DBNAME}" already exists`);
  await found.client.end();

  const db = await connect(cfg, DBNAME);
  const has = (await db.query("SELECT to_regclass('public.products') AS t")).rows[0].t;
  if (!has || RESET) {
    await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    log(RESET ? '  OK Database reset and sample data reloaded' : '  OK Created tables and loaded sample data');
  } else log('  OK Tables already exist (your data is kept; use "npm run reset" to wipe it)');
  const n = (await db.query('SELECT COUNT(*) FROM products')).rows[0].count;
  log(`  OK Check passed: ${n} products in database`);
  await db.end();

  fs.writeFileSync(ENV, JSON.stringify({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: DBNAME }, null, 2));
  log('  OK Saved settings to db.json\n\nSetup complete.\n');
  rl.close();
})().catch(e => { console.error('\nSetup failed:', e.message || e.code || e); rl.close(); process.exit(1); });
