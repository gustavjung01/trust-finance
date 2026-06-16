const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { Pool } = require('pg');

const DEFAULT_STORE = {
  finance_leads: [],
  settings: {},
  nextLeadId: 1
};

const LEAD_FIELDS = [
  'lead_code',
  'full_name',
  'phone',
  'id_number',
  'date_of_birth',
  'normalized_phone',
  'product_type',
  'province',
  'loan_amount',
  'message',
  'source',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'cta_position',
  'page_url',
  'chat_session_id',
  'is_hot',
  'hot_reasons',
  'status',
  'admin_note',
  'telegram_sent',
  'telegram_hot_sent',
  'created_at',
  'updated_at'
];

let cache = null;
let loadPromise = null;
let writeLock = Promise.resolve();
let pool = null;
let schemaPromise = null;

function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

function makeDatabaseUrlMissingError() {
  const err = new Error('DATABASE_URL missing on Vercel. Add Heroku Postgres DATABASE_URL in Vercel Environment Variables and redeploy.');
  err.code = 'DATABASE_URL_MISSING';
  return err;
}

function assertPersistentStorageAvailable() {
  if (isVercelRuntime() && !hasDatabaseUrl()) {
    throw makeDatabaseUrlMissingError();
  }
}

function getStorageInfo() {
  if (hasDatabaseUrl()) {
    return {
      mode: 'postgres',
      persistent: true,
      databaseUrlConfigured: true,
      vercel: isVercelRuntime(),
      message: 'Using PostgreSQL via DATABASE_URL.'
    };
  }

  if (isVercelRuntime()) {
    return {
      mode: 'missing_database_url',
      persistent: false,
      databaseUrlConfigured: false,
      vercel: true,
      message: 'DATABASE_URL missing on Vercel. Server storage is disabled to prevent fake saves.'
    };
  }

  return {
    mode: 'local_file',
    persistent: true,
    databaseUrlConfigured: false,
    vercel: false,
    path: getStorePath(),
    message: 'Using local JSON file storage for development only.'
  };
}

function getStorePath() {
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), 'shbfinance-store.json');
  }

  return path.join(__dirname, '../../data/shbfinance-store.json');
}

function getPgSslConfig() {
  if (!hasDatabaseUrl()) return false;

  const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
  if (sslMode === 'disable') return false;

  return { rejectUnauthorized: false };
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: getPgSslConfig()
    });

    pool.on('error', err => {
      console.error('[pg] unexpected error:', err.message);
    });
  }

  return pool;
}

async function ensureDatabaseSchema() {
  if (!hasDatabaseUrl()) return;

  if (!schemaPromise) {
    schemaPromise = (async () => {
      const client = await getPool().connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await client.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');

        await client.query(`
          CREATE TABLE IF NOT EXISTS finance_leads (
            id BIGSERIAL PRIMARY KEY,
            lead_code TEXT NOT NULL,
            full_name TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL DEFAULT '',
            id_number TEXT NOT NULL DEFAULT '',
            date_of_birth TEXT NOT NULL DEFAULT '',
            normalized_phone TEXT NOT NULL DEFAULT '',
            product_type TEXT NOT NULL DEFAULT 'consulting',
            province TEXT NOT NULL DEFAULT '',
            loan_amount TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'unknown',
            utm_source TEXT NOT NULL DEFAULT '',
            utm_medium TEXT NOT NULL DEFAULT '',
            utm_campaign TEXT NOT NULL DEFAULT '',
            cta_position TEXT NOT NULL DEFAULT '',
            page_url TEXT NOT NULL DEFAULT '',
            chat_session_id TEXT NOT NULL DEFAULT '',
            is_hot INTEGER NOT NULL DEFAULT 0,
            hot_reasons TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'new',
            admin_note TEXT NOT NULL DEFAULT '',
            telegram_sent INTEGER NOT NULL DEFAULT 0,
            telegram_hot_sent INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL DEFAULT ''
          )
        `);

        await client.query('CREATE INDEX IF NOT EXISTS finance_leads_chat_session_id_idx ON finance_leads (chat_session_id)');
        await client.query('CREATE INDEX IF NOT EXISTS finance_leads_created_at_idx ON finance_leads (created_at)');
        await client.query('CREATE INDEX IF NOT EXISTS finance_leads_normalized_phone_idx ON finance_leads (normalized_phone)');
        await client.query('CREATE INDEX IF NOT EXISTS finance_leads_status_idx ON finance_leads (status)');
        await client.query('CREATE INDEX IF NOT EXISTS finance_leads_product_type_idx ON finance_leads (product_type)');
      } finally {
        client.release();
      }
    })().catch(err => {
      schemaPromise = null;
      throw err;
    });
  }

  return schemaPromise;
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function normalizeStore(raw = {}) {
  return {
    finance_leads: Array.isArray(raw.finance_leads) ? raw.finance_leads : [],
    settings: raw.settings && typeof raw.settings === 'object' ? raw.settings : {},
    nextLeadId: Number.isFinite(raw.nextLeadId) && raw.nextLeadId > 0
      ? raw.nextLeadId
      : ((Array.isArray(raw.finance_leads) ? raw.finance_leads.length : 0) + 1)
  };
}

async function loadStoreFromDisk() {
  assertPersistentStorageAvailable();
  const storePath = getStorePath();
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    return normalizeStore(JSON.parse(raw));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[store] load failed, using empty store:', err.message);
    }
    return normalizeStore(DEFAULT_STORE);
  }
}

async function getStore() {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = loadStoreFromDisk().then(store => {
      cache = store;
      return store;
    });
  }
  return loadPromise;
}

async function persistStore(store) {
  assertPersistentStorageAvailable();
  const storePath = getStorePath();
  await ensureDir(storePath);
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), 'utf8');
}

async function withWriteLock(task) {
  const previous = writeLock;
  let release;
  writeLock = new Promise(resolve => {
    release = resolve;
  });

  await previous;

  try {
    return await task();
  } finally {
    release();
  }
}

function normalizeSettingValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return '';
  return String(value);
}

function toIntFlag(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  return 0;
}

function safeText(value, fallback = '') {
  if (value == null) return fallback;
  return String(value);
}

function cloneLead(lead) {
  return { ...lead };
}

function applyLeadUpdates(lead, updates = {}) {
  const aliases = {
    telegramSent: 'telegram_sent',
    telegramHotSent: 'telegram_hot_sent',
    isHot: 'is_hot',
    chatSessionId: 'chat_session_id',
    dateOfBirth: 'date_of_birth'
  };

  for (const [key, value] of Object.entries(updates)) {
    const field = aliases[key] || key;
    if (value === undefined || value === null) continue;

    if (field === 'is_hot' || field === 'telegram_sent' || field === 'telegram_hot_sent') {
      lead[field] = toIntFlag(value);
      continue;
    }

    lead[field] = value;
  }

  lead.updated_at = safeText(updates.updated_at, new Date().toISOString());
  return lead;
}

function makeLeadCodeFallback() {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `FIN-${ymd}-${String(Date.now() % 1000000).padStart(6, '0')}`;
}

function normalizeLeadRecord(row = {}) {
  return {
    id: Number(row.id) || 0,
    lead_code: safeText(row.lead_code),
    full_name: safeText(row.full_name),
    phone: safeText(row.phone),
    id_number: safeText(row.id_number),
    date_of_birth: safeText(row.date_of_birth),
    normalized_phone: safeText(row.normalized_phone),
    product_type: safeText(row.product_type, 'consulting'),
    province: safeText(row.province),
    loan_amount: safeText(row.loan_amount),
    message: safeText(row.message),
    source: safeText(row.source, 'unknown'),
    utm_source: safeText(row.utm_source),
    utm_medium: safeText(row.utm_medium),
    utm_campaign: safeText(row.utm_campaign),
    cta_position: safeText(row.cta_position),
    page_url: safeText(row.page_url),
    chat_session_id: safeText(row.chat_session_id),
    is_hot: toIntFlag(row.is_hot),
    hot_reasons: safeText(row.hot_reasons),
    status: safeText(row.status, 'new'),
    admin_note: safeText(row.admin_note),
    telegram_sent: toIntFlag(row.telegram_sent),
    telegram_hot_sent: toIntFlag(row.telegram_hot_sent),
    created_at: safeText(row.created_at),
    updated_at: safeText(row.updated_at)
  };
}

function leadRecordFromData(leadData = {}, existing = {}) {
  const now = new Date().toISOString();
  return normalizeLeadRecord({
    ...existing,
    ...leadData,
    lead_code: leadData.lead_code || existing.lead_code || makeLeadCodeFallback(),
    full_name: leadData.full_name ?? existing.full_name ?? '',
    phone: leadData.phone ?? existing.phone ?? '',
    id_number: leadData.id_number ?? existing.id_number ?? '',
    date_of_birth: leadData.date_of_birth ?? existing.date_of_birth ?? '',
    normalized_phone: leadData.normalized_phone ?? existing.normalized_phone ?? '',
    product_type: leadData.product_type ?? existing.product_type ?? 'consulting',
    province: leadData.province ?? existing.province ?? '',
    loan_amount: leadData.loan_amount ?? existing.loan_amount ?? '',
    message: leadData.message ?? existing.message ?? '',
    source: leadData.source ?? existing.source ?? 'unknown',
    utm_source: leadData.utm_source ?? existing.utm_source ?? '',
    utm_medium: leadData.utm_medium ?? existing.utm_medium ?? '',
    utm_campaign: leadData.utm_campaign ?? existing.utm_campaign ?? '',
    cta_position: leadData.cta_position ?? existing.cta_position ?? '',
    page_url: leadData.page_url ?? existing.page_url ?? '',
    chat_session_id: leadData.chat_session_id ?? existing.chat_session_id ?? '',
    is_hot: toIntFlag(leadData.is_hot ?? existing.is_hot ?? 0),
    hot_reasons: leadData.hot_reasons ?? existing.hot_reasons ?? '',
    status: leadData.status ?? existing.status ?? 'new',
    admin_note: leadData.admin_note ?? existing.admin_note ?? '',
    telegram_sent: toIntFlag(leadData.telegram_sent ?? existing.telegram_sent ?? 0),
    telegram_hot_sent: toIntFlag(leadData.telegram_hot_sent ?? existing.telegram_hot_sent ?? 0),
    created_at: leadData.created_at ?? existing.created_at ?? now,
    updated_at: leadData.updated_at ?? existing.updated_at ?? now
  });
}

async function dbQuery(text, params = []) {
  await ensureDatabaseSchema();
  return getPool().query(text, params);
}

async function getSettingsFromDb() {
  const result = await dbQuery('SELECT key, value FROM app_settings ORDER BY key ASC');
  const settings = {};
  for (const row of result.rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

async function setSettingsInDb(settings = {}) {
  await ensureDatabaseSchema();
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(settings)) {
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, normalizeSettingValue(value)]
      );
    }
    await client.query('COMMIT');
    return getSettingsFromDb();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function listLeadsFromDb() {
  const result = await dbQuery(
    'SELECT * FROM finance_leads ORDER BY created_at DESC, id DESC'
  );
  return result.rows.map(row => normalizeLeadRecord(row));
}

async function insertLeadInDb(lead) {
  const values = LEAD_FIELDS.map(field => lead[field]);
  const placeholders = LEAD_FIELDS.map((_, index) => `$${index + 1}`).join(', ');
  const columns = LEAD_FIELDS.join(', ');
  const result = await dbQuery(
    `INSERT INTO finance_leads (${columns}) VALUES (${placeholders}) RETURNING *`,
    values
  );
  return normalizeLeadRecord(result.rows[0]);
}

async function replaceLeadInDb(lead) {
  const values = LEAD_FIELDS.map(field => lead[field]);
  values.push(lead.id);
  const setClause = LEAD_FIELDS.map((field, index) => `${field} = $${index + 1}`).join(', ');
  const result = await dbQuery(
    `UPDATE finance_leads SET ${setClause} WHERE id = $${LEAD_FIELDS.length + 1} RETURNING *`,
    values
  );
  if (!result.rows[0]) return null;
  return normalizeLeadRecord(result.rows[0]);
}

async function findLeadByChatSessionIdFromDb(chatSessionId) {
  const sessionId = String(chatSessionId || '').trim();
  if (!sessionId) return null;

  const result = await dbQuery(
    'SELECT * FROM finance_leads WHERE chat_session_id = $1 ORDER BY id DESC LIMIT 1',
    [sessionId]
  );
  return result.rows[0] ? normalizeLeadRecord(result.rows[0]) : null;
}

async function updateLeadInDb(id, updates = {}) {
  const result = await dbQuery('SELECT * FROM finance_leads WHERE id = $1 LIMIT 1', [id]);
  if (!result.rows[0]) return { changes: 0 };

  const current = normalizeLeadRecord(result.rows[0]);
  const merged = leadRecordFromData(updates, current);
  const saved = await replaceLeadInDb(merged);

  return {
    changes: 1,
    lead: saved || merged
  };
}

async function updateLeadStatusInDb(id, status) {
  return updateLeadInDb(id, { status });
}

async function updateLeadTelegramFlagsInDb(id, { telegramSent, telegramHotSent }) {
  const updates = {};
  if (telegramSent != null) updates.telegram_sent = telegramSent ? 1 : 0;
  if (telegramHotSent != null) updates.telegram_hot_sent = telegramHotSent ? 1 : 0;
  return updateLeadInDb(id, updates);
}

async function getSettings() {
  if (hasDatabaseUrl()) {
    return getSettingsFromDb();
  }

  const store = await getStore();
  return { ...store.settings };
}

async function getSetting(key) {
  const settings = await getSettings();
  return settings[key];
}

async function setSettings(settings = {}) {
  if (hasDatabaseUrl()) {
    return withWriteLock(async () => setSettingsInDb(settings));
  }

  return withWriteLock(async () => {
    const store = await getStore();
    for (const [key, value] of Object.entries(settings)) {
      store.settings[key] = normalizeSettingValue(value);
    }
    await persistStore(store);
    return { ...store.settings };
  });
}

async function listLeads() {
  if (hasDatabaseUrl()) {
    return listLeadsFromDb();
  }

  const store = await getStore();
  return store.finance_leads
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .map(cloneLead);
}

async function createLead(leadData = {}) {
  if (hasDatabaseUrl()) {
    return withWriteLock(async () => {
      const lead = leadRecordFromData(leadData);
      return insertLeadInDb(lead);
    });
  }

  return withWriteLock(async () => {
    const store = await getStore();
    const now = new Date().toISOString();
    const currentId = store.nextLeadId;
    const lead = normalizeLeadRecord({
      id: currentId,
      ...leadData,
      lead_code: leadData.lead_code || `FIN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(currentId).padStart(6, '0')}`,
      full_name: leadData.full_name || '',
      phone: leadData.phone || '',
      id_number: leadData.id_number || '',
      date_of_birth: leadData.date_of_birth || '',
      normalized_phone: leadData.normalized_phone || '',
      product_type: leadData.product_type || 'consulting',
      province: leadData.province || '',
      loan_amount: leadData.loan_amount || '',
      message: leadData.message || '',
      source: leadData.source || 'unknown',
      utm_source: leadData.utm_source || '',
      utm_medium: leadData.utm_medium || '',
      utm_campaign: leadData.utm_campaign || '',
      cta_position: leadData.cta_position || '',
      page_url: leadData.page_url || '',
      chat_session_id: leadData.chat_session_id || '',
      is_hot: toIntFlag(leadData.is_hot),
      hot_reasons: leadData.hot_reasons || '',
      status: leadData.status || 'new',
      admin_note: leadData.admin_note || '',
      telegram_sent: toIntFlag(leadData.telegram_sent),
      telegram_hot_sent: toIntFlag(leadData.telegram_hot_sent),
      created_at: leadData.created_at || now,
      updated_at: leadData.updated_at || now
    });

    store.nextLeadId = currentId + 1;
    store.finance_leads.push(lead);
    await persistStore(store);
    return cloneLead(lead);
  });
}

async function findLeadByChatSessionId(chatSessionId) {
  const sessionId = String(chatSessionId || '').trim();
  if (!sessionId) return null;

  if (hasDatabaseUrl()) {
    return findLeadByChatSessionIdFromDb(sessionId);
  }

  const store = await getStore();
  const lead = store.finance_leads.find(item => String(item.chat_session_id || '') === sessionId);
  return lead ? cloneLead(lead) : null;
}

async function updateLead(id, updates = {}) {
  if (hasDatabaseUrl()) {
    return withWriteLock(async () => updateLeadInDb(id, updates));
  }

  return withWriteLock(async () => {
    const store = await getStore();
    const lead = store.finance_leads.find(item => String(item.id) === String(id));
    if (!lead) return { changes: 0 };

    applyLeadUpdates(lead, updates);
    await persistStore(store);
    return { changes: 1, lead: cloneLead(lead) };
  });
}

async function updateLeadStatus(id, status) {
  if (hasDatabaseUrl()) {
    return withWriteLock(async () => updateLeadStatusInDb(id, status));
  }

  return withWriteLock(async () => {
    const store = await getStore();
    const lead = store.finance_leads.find(item => String(item.id) === String(id));
    if (!lead) return { changes: 0 };

    lead.status = status;
    lead.updated_at = new Date().toISOString();
    await persistStore(store);
    return { changes: 1, lead: cloneLead(lead) };
  });
}

async function updateLeadTelegramFlags(id, { telegramSent, telegramHotSent }) {
  if (hasDatabaseUrl()) {
    return withWriteLock(async () => updateLeadTelegramFlagsInDb(id, { telegramSent, telegramHotSent }));
  }

  return withWriteLock(async () => {
    const store = await getStore();
    const lead = store.finance_leads.find(item => String(item.id) === String(id));
    if (!lead) return { changes: 0 };

    if (telegramSent != null) lead.telegram_sent = telegramSent ? 1 : 0;
    if (telegramHotSent != null) lead.telegram_hot_sent = telegramHotSent ? 1 : 0;
    lead.updated_at = new Date().toISOString();
    await persistStore(store);
    return { changes: 1, lead: cloneLead(lead) };
  });
}

async function resetCacheForTests() {
  cache = null;
  loadPromise = null;
  writeLock = Promise.resolve();
  schemaPromise = null;
}

module.exports = {
  createLead,
  findLeadByChatSessionId,
  getSetting,
  getSettings,
  getStorageInfo,
  listLeads,
  normalizeSettingValue,
  setSettings,
  updateLead,
  updateLeadStatus,
  updateLeadTelegramFlags,
  _resetCacheForTests: resetCacheForTests
};
