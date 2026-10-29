/**
 * Shared team edits — notes, service history, flags, PEG, reserved, prep, sold by.
 */
const OWNER = '100492107';
const REPO = 'dealer-stock-burton';
const PATH = 'overrides.json';
const BRANCH = 'main';

async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { status: 500, body: { error: 'GITHUB_TOKEN not set on Vercel' } };
  }
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${path}`, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    const file = await gh(`contents/${PATH}?ref=${BRANCH}`);
    if (file.status !== 200) return res.status(file.status).json(file.data);
    const content = Buffer.from(file.data.content, 'base64').toString('utf8');
    return res.status(200).json(JSON.parse(content || '{}'));
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const reg = (body.registration || body.id || '').toUpperCase().replace(/\s+/g, '');
  if (!reg) return res.status(400).json({ error: 'registration required' });

  const file = await gh(`contents/${PATH}?ref=${BRANCH}`);
  let overrides = {};
  let sha;
  if (file.status === 200) {
    sha = file.data.sha;
    try {
      overrides = JSON.parse(Buffer.from(file.data.content, 'base64').toString('utf8') || '{}');
    } catch { overrides = {}; }
  }

  const prev = overrides[reg] || {};
  const next = { ...prev };
  if (body.service_history !== undefined) next.service_history = body.service_history;
  if (body.service_history_notes !== undefined) next.service_history_notes = body.service_history_notes;
  if (body.status_flags !== undefined) next.status_flags = body.status_flags;
  if (body.special_offer !== undefined) next.special_offer = body.special_offer;
  if (body.category !== undefined) next.category = body.category;
  if (body.peg_number !== undefined) next.peg_number = body.peg_number;
  if (body.dealer_peg !== undefined) next.dealer_peg = body.dealer_peg;
  if (body.prep_status !== undefined) next.prep_status = body.prep_status;
  if (body.reserved_by !== undefined) next.reserved_by = body.reserved_by;
  if (body.reserved_at !== undefined) next.reserved_at = body.reserved_at;
  if (body.sold_by !== undefined) next.sold_by = body.sold_by;
  if (body.sold_date !== undefined) next.sold_date = body.sold_date;
  if (body.notes !== undefined) next.notes = body.notes;
  if (body.add_note) {
    const notes = Array.isArray(next.notes) ? next.notes.slice() : [];
    notes.unshift({
      date: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }),
      text: String(body.add_note),
      by: body.by || 'team',
    });
    next.notes = notes;
  }
  next.updatedAt = new Date().toISOString();
  overrides[reg] = next;

  const content = Buffer.from(JSON.stringify(overrides, null, 2)).toString('base64');
  const put = await gh(`contents/${PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Update overrides for ${reg}`,
      content,
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });

  if (put.status !== 200 && put.status !== 201) {
    return res.status(put.status).json({ error: 'GitHub write failed', detail: put.data });
  }
  return res.status(200).json({ ok: true, registration: reg, override: next });
};
