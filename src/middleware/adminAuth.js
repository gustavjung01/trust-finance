const DEFAULT_ADMIN_EMAIL = 'admin@shb.vn';
const DEFAULT_ADMIN_PASS = 'secret123';

function getAdminCredentials() {
    const email = String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim();
    const pass = String(process.env.ADMIN_PASS || DEFAULT_ADMIN_PASS).trim();
    const usingFallback = !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASS;

    return { email, pass, usingFallback };
}

const adminAuth = async (req, res, next) => {
    const { email: ADMIN_EMAIL, pass: ADMIN_PASS, usingFallback } = getAdminCredentials();

    if (usingFallback && !adminAuth._warnedFallback) {
        adminAuth._warnedFallback = true;
        console.warn('[admin-auth] ADMIN_EMAIL/ADMIN_PASS missing, using fallback credentials for compatibility.');
    }

    const authHeader = req.headers['x-admin-key'];

    if (!authHeader) {
        return res.status(401).json({ error: "invalid_admin_credentials" });
    }

    try {
        const decoded = Buffer.from(authHeader, 'base64').toString('utf8');
        const [email, pass] = decoded.split(':');

        if (email === ADMIN_EMAIL && pass === ADMIN_PASS) {
            return next();
        }
    } catch (e) {
        // Decode failure
    }

    res.status(401).json({ error: "invalid_admin_credentials" });
};

module.exports = adminAuth;
