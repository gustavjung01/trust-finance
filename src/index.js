const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const adminAuth = require('./middleware/adminAuth');
const leadStore = require('./services/leadStore');

const publicDir = path.join(__dirname, '../public');
const indexHtmlPath = path.join(publicDir, 'index.html');
const bootVersion = process.env.VERCEL_GIT_COMMIT_SHA || process.env.SOURCE_VERSION || String(Date.now());
const bootBuiltAt = new Date().toISOString();

app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));

function withNoStore(res) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
}

function pwaHeadTags() {
    return `
    <meta name="theme-color" content="#0F3B75">
    <meta name="application-name" content="SHBFinance">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="SHBFinance">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="apple-touch-icon" href="/assets/avatar-chatbot.png">
    <link rel="icon" href="/icons/shbfinance-icon.svg" type="image/svg+xml">`;
}

function pwaBodyScripts() {
    return `
    <script src="/open-external-browser.js" defer></script>
    <script src="/pwa-install-button.js" defer></script>
    <script src="/pwa-update-toast.js" defer></script>
    <script src="/pwa-register.js" defer></script>`;
}

function injectPwa(html) {
    let output = html;

    if (!output.includes('/manifest.webmanifest')) {
        output = output.replace('</head>', `${pwaHeadTags()}\n</head>`);
    }

    if (!output.includes('/pwa-register.js')) {
        output = output.replace('</body>', `${pwaBodyScripts()}\n</body>`);
    }

    return output;
}

function sendLandingPage(req, res) {
    fs.readFile(indexHtmlPath, 'utf8', (err, html) => {
        if (err) {
            res.status(500).send('Cannot load landing page');
            return;
        }

        res.type('html').send(injectPwa(html));
    });
}

app.get(['/', '/index.html'], sendLandingPage);

app.get('/app-version.json', (req, res) => {
    withNoStore(res);
    res.json({
        version: bootVersion,
        git: process.env.VERCEL_GIT_COMMIT_SHA || process.env.SOURCE_VERSION || null,
        builtAt: bootBuiltAt
    });
});

app.get('/service-worker.js', (req, res) => {
    withNoStore(res);
    res.type('application/javascript').sendFile(path.join(publicDir, 'service-worker.js'));
});

app.get('/manifest.webmanifest', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('application/manifest+json').sendFile(path.join(publicDir, 'manifest.webmanifest'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(publicDir, 'admin/index.html'));
});

app.use(express.static(publicDir));

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
