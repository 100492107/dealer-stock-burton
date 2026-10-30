/**
 * POST /api/login — { username, password } → { ok, role, name, token }
 * Env (set in Vercel):
 *   MANAGER_USER (default manager)  MANAGER_PASSWORD
 *   SALES_USER   (default sales)    SALES_PASSWORD
 *   AUTH_SECRET  (optional, for token signing)
 */
const crypto = require('crypto');

function usersFromEnv() {
  const list = [];
  const mu = (process.env.MANAGER_USER || 'manager').trim();
  const mp = process.env.MANAGER_PASSWORD || '';
  const su = (process.env.SALES_USER || 'sales').trim();
  const sp = process.env.SALES_PASSWORD || '';
  if (mp) list.push({ username: mu.toLowerCase(), password: mp, role: 'manager', name: 'Manager' });
  if (sp) list.push({ username: su.toLowerCase(), password: sp, role: 'sales', name: 'Sales' });
  try {
    const extra = JSON.parse(process.env.AUTH_USERS_JSON || '[]');
    if (Array.isArray(extra)) {
      for (const u of extra) {
        if (u && u.username && u.password && u.role) {
          list.push({
            username: String(u.username).toLowerCase().trim(),
            password: String(u.password),
            role: u.role === 'manager' ? 'manager' : 'sales',
            name: u.name || u.username,
          });
        }
      }
    }
  } catch (_) {}
  return list;
}

function signToken(payload) {
  const secret = process.env.AUTH_SECRET || process.env.MANAGER_PASSWORD || 'dealer-stock-burton';
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const secret = process.env.AUTH_SECRET || process.env.MANAGER_PASSWORD || 'dealer-stock-burton';
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig !== expect) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (data.exp && Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query && req.query.token);
    const data = verifyToken(token);
    if (!data) return res.status(401).json({ ok: false, error: 'Not signed in' });
    return res.status(200).json({ ok: true, role: data.role, name: data.name, username: data.u });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  body = body || {};
  const username = String(body.username || '').toLowerCase().trim();
  const password = String(body.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const users = usersFromEnv();
  if (!users.length) {
    return res.status(503).json({
      ok: false,
      error: 'Login not configured. Set MANAGER_PASSWORD and SALES_PASSWORD in Vercel env.',
    });
  }

  const match = users.find(u => u.username === username && u.password === password);
  if (!match) return res.status(401).json({ ok: false, error: 'Invalid username or password' });

  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const token = signToken({ u: match.username, role: match.role, name: match.name, exp });
  return res.status(200).json({
    ok: true,
    role: match.role,
    name: match.name,
    username: match.username,
    token,
    exp,
  });
};

module.exports.verifyToken = verifyToken;
