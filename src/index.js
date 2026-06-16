const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const adminAuth = require('./middleware/adminAuth');
const leadStore = require('./services/leadStore');

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.set('store', leadStore);
app.set('db', leadStore);

const MASKED_SETTING_KEYS = new Set(['AI_CREDENTIALS_JSON', 'TELEGRAM_BOT_TOKEN']);

function isBlankOrMaskedSecret(value) {
    const text = String(value || '').trim();
    return !text || text === '********' || /^•+$/.test(text);
}

function getConfigStatus() {
    const storageInfo = typeof leadStore.getStorageInfo === 'function'
        ? leadStore.getStorageInfo()
        : {};

    return {
        adminEmailConfigured: Boolean(process.env.ADMIN_EMAIL),
        adminPassConfigured: Boolean(process.env.ADMIN_PASS),
        databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
        vercel: Boolean(process.env.VERCEL),
        nodeEnv: process.env.NODE_ENV || null,
        commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        storageMode: storageInfo.mode || 'unknown',
        storagePersistent: Boolean(storageInfo.persistent),
        storageMessage: storageInfo.message || ''
    };
}

app.get('/api/admin/config-status', (req, res) => {
    res.json(getConfigStatus());
});

// Routes
const financeLeadsRouter = require('./routes/financeLeads');
app.use('/api', financeLeadsRouter);

app.get('/api/admin/auth-check', adminAuth, (req, res) => {
    res.json({ success: true, ...getConfigStatus() });
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin/index.html'));
});

// Settings API
app.get('/api/admin/settings', adminAuth, async (req, res) => {
    try {
        const settings = await leadStore.getSettings();
        const response = {};
        for (const key in settings) {
            if (MASKED_SETTING_KEYS.has(key)) {
                response[key] = settings[key] ? '********' : '';
            } else {
                response[key] = settings[key];
            }
        }
        res.json(response);
    } catch (err) {
        const status = err.code === 'DATABASE_URL_MISSING' ? 500 : 500;
        res.status(status).json({
            error: err.code || 'settings_load_failed',
            message: err.message
        });
    }
});

app.post('/api/admin/settings', adminAuth, async (req, res) => {
    try {
        const incoming = req.body || {};

        for (const key of MASKED_SETTING_KEYS) {
            if (
                Object.prototype.hasOwnProperty.call(incoming, key) &&
                isBlankOrMaskedSecret(incoming[key])
            ) {
                const existing = await leadStore.getSetting(key).catch(() => '');
                if (existing) {
                    delete incoming[key];
                }
            }
        }

        const saved = await leadStore.setSettings(incoming);
        const storageInfo = typeof leadStore.getStorageInfo === 'function'
            ? leadStore.getStorageInfo()
            : {};
        res.json({
            success: true,
            storageMode: storageInfo.mode || 'unknown',
            storagePersistent: Boolean(storageInfo.persistent),
            keys: Object.keys(incoming),
            savedKeys: Object.keys(saved || {})
        });
    } catch (err) {
        res.status(500).json({
            error: err.code || 'settings_save_failed',
            message: err.message
        });
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
        const info = typeof leadStore.getStorageInfo === 'function'
            ? leadStore.getStorageInfo()
            : {};
        console.log(`[storage] ${info.mode || 'unknown'}${info.message ? ` - ${info.message}` : ''}`);
    });
}

module.exports = app;
