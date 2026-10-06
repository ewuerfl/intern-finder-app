// Vercel serverless function: keeps people signed in to Gmail without a Google popup every visit.
// Google hands out a long-lived "refresh token" once; this function encrypts it with TOKEN_KEY,
// and later trades it for short-lived access tokens. The browser only ever holds the encrypted copy.
// Needs these Vercel environment variables: GOOGLE_CLIENT_SECRET (from your Google OAuth client) and TOKEN_KEY (any long random string).
const crypto = require('crypto');
const SECRET = process.env.GOOGLE_CLIENT_SECRET, KEY = process.env.TOKEN_KEY;
const key = () => crypto.createHash('sha256').update(KEY).digest();

function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
function open(blob) {
  const b = Buffer.from(String(blob), 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
async function google(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_secret: SECRET, ...params })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'google_error'); e.status = r.status; throw e; }
  return j;
}

module.exports = async (req, res) => {
  const ok = !!(SECRET && KEY);
  if (req.method === 'GET') return res.status(200).json({ ok });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!ok) return res.status(503).json({ error: 'not_configured' });
  const { action, code, blob, client_id } = req.body || {};
  if (!client_id || !/\.apps\.googleusercontent\.com$/.test(client_id)) return res.status(400).json({ error: 'client_id' });
  try {
    if (action === 'exchange') {
      const j = await google({ code, client_id, redirect_uri: 'postmessage', grant_type: 'authorization_code' });
      return res.status(200).json({ access_token: j.access_token, expires_in: j.expires_in, blob: j.refresh_token ? seal(j.refresh_token) : null });
    }
    if (action === 'refresh') {
      const j = await google({ refresh_token: open(blob), client_id, grant_type: 'refresh_token' });
      return res.status(200).json({ access_token: j.access_token, expires_in: j.expires_in });
    }
    if (action === 'revoke') {
      await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(open(blob)), { method: 'POST' }).catch(() => {});
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'action' });
  } catch (e) {
    // invalid_grant = the person removed access or the token expired; they need to connect again
    return res.status(e.status === 400 ? 401 : 502).json({ error: e.message || 'failed' });
  }
};
