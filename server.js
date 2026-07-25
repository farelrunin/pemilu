// ════════════════════════════════════════
//  server.js — Entry point (lokal)
// ════════════════════════════════════════
'use strict';
require('dotenv').config();

const express                = require('express');
const path                   = require('path');
const { testConnection }     = require('./db');
const { noCache, csp }       = require('./middleware/httpHeaders');
const { addDatabaseIndexes } = require('./database/createIndexes');
const {
  ensureKoordinatorSchema,
  ensureTPSComparisonSchema,
  ensureRoleEnum,
  ensureNikColumnsFlexible,
} = require('./database/migrations');

const app  = express();
const PORT = process.env.PORT || 3010;

// ── Middleware global ─────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(noCache);
app.use(csp);
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────
app.use('/api',     require('./routes/auth'));
app.use('/api',     require('./routes/kader'));
app.use('/api',     require('./routes/pemilih'));
app.use('/api/tps', require('./routes/tps'));

// ── HTML Page Routes ──────────────────────────────────
app.use('/', require('./routes/pages'));

// ── 404 handler ──────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.path} tidak ditemukan` });
});

// ── Global error handler ─────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Startup ───────────────────────────────────────────
async function start() {
  await testConnection();
  await ensureKoordinatorSchema();
  await ensureTPSComparisonSchema();
  await ensureRoleEnum();
  await ensureNikColumnsFlexible();
  await addDatabaseIndexes();
  app.listen(PORT, () => {
    console.log(`Server berjalan di http://localhost:${PORT}`);
  });
}

start();