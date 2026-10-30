/**
 * Fast stock sync — Pentagon Burton. No per-car detail scrapes (avoids 504).
 */
const OWNER = '100492107';
const REPO = 'dealer-stock-burton';
const BRANCH = 'main';
const BASE = 'https://www.pentagon-group.co.uk/inc-ajax-vehicle-results.php';
const FETCH_TIMEOUT_MS = 10000;
const GH_TIMEOUT_MS = 10000;

const QUERIES = [
  { params: 'filter=1&franchise=Group&stockType=physical&vehType=car&payType=cash&make=any&model=any&grade=any&vehCond=used&budgetType=cash&minPrice=0&maxPrice=150000&location=BURTON&sort=price%20asc&limit=300', category: 'Stock' },
  { params: 'filter=1&franchise=Group&stockType=physical&vehType=car&payType=cash&make=any&model=any&grade=any&vehCond=new&budgetType=cash&minPrice=0&maxPrice=150000&location=BURTON&sort=price%20asc&limit=100', category: 'New' },
  { params: 'filter=1&franchise=Group&stockType=physical&vehType=van&payType=cash&make=any&model=any&grade=any&vehCond=used&budgetType=cash&minPrice=0&maxPrice=150000&location=BURTON&sort=price%20asc&limit=100', category: 'Commercials' },
];

function fixMake(m) {
  m = (m || '').replace(/-/g, ' ').trim();
  const map = { ds: 'DS', byd: 'BYD', bmw: 'BMW', seat: 'SEAT', cupra: 'CUPRA', 'mercedes benz': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz' };
  return map[m.toLowerCase()] || m.replace(/\b\w/g, c => c.toUpperCase());
}
function isValidUkReg(reg) {
  if (!reg) return false;
  const r = reg.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(r) || /^[A-Z]\d{1,3}[A-Z]{3}$/.test(r) || /^[A-Z]{3}\d{1,3}[A-Z]$/.test(r);
}
function extractReg(body) {
  const candidates = [];
  let m = body.match(/data-reg=["']([A-Z0-9 ]+)["']/i);
  if (m) candidates.push(m[1].replace(/\s+/g, '').toUpperCase());
  m = body.match(/used-vehicle-photos\/\d+\/([A-Z0-9]+)-/);
  if (m) candidates.push(m[1].toUpperCase());
  const plain = body.replace(/<[^>]+>/g, ' ').toUpperCase();
  let x; const re = /\b([A-Z]{2}\d{2}\s*[A-Z]{3})\b/g;
  while ((x = re.exec(plain))) candidates.push(x[1].replace(/\s+/g, ''));
  for (const c of candidates) if (isValidUkReg(c)) return c;
  return null;
}
function tidyTitle(title) {
  if (!title) return '';
  return title.replace(/\s+/g, ' ').trim();
}
function cleanModel(make, model) {
  let m = (model || '').trim();
  const mk = (make || '').trim();
  if (mk && m.toLowerCase().startsWith(mk.toLowerCase() + ' ')) m = m.slice(mk.length).trim();
  const out = [];
  m.split(/\s+/).forEach(p => { if (!out.length || out[out.length-1].toLowerCase() !== p.toLowerCase()) out.push(p); });
  return out.join(' ') || 'Unknown';
}
function parseBlocks(html, defaultCategory) {
  const vehicles = [];
  const re = /<li data-id="(\d+)"([^>]*)>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = re.exec(html))) {
    const [, vid, attrs, body] = match;
    const colourM = attrs.match(/data-colour="([^"]*)"/);
    const colour = colourM ? colourM[1].replace(/\b\w/g, c => c.toUpperCase()) : '';
    const hrefM = body.match(/href="(\/(?:used-cars|used-vans|new-cars-in-stock)\/[^"]+)"/);
    const href = hrefM ? hrefM[1].replace(/\/print$/, '') : '';
    const isNewCar = /\/new-cars-in-stock\//.test(href) || defaultCategory === 'New';
    let reg = extractReg(body);
    if (!reg && isNewCar) {
      let m = body.match(/used-vehicle-photos\/\d+\/([A-Z0-9]{6,})-/i);
      reg = m ? m[1].toUpperCase() : 'NEW' + vid;
    }
    if (!reg) continue;
    const parts = href.replace(/^\/+|\/+$/g, '').split('/');
    let make = fixMake(parts[1] || '');
    let model = (parts[2] || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if ((make || '').toLowerCase().includes('cupra')) make = 'CUPRA';
    if (!make) make = 'Unknown';
    model = cleanModel(make, model || 'Unknown');
    const titleM = body.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/);
    const derivative = tidyTitle(titleM ? titleM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '');
    let image_url = '';
    const imgM = body.match(/src="(https:\/\/pentagon-v4\.imgix\.net\/used-vehicle-photos\/\d+\/[^"]+)"/);
    if (imgM) { image_url = imgM[1].split('&dpr=')[0]; }
    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    let price = null;
    let priceAttr = body.match(/data-price=["']([0-9,.]+)["']/i) || attrs.match(/data-price=["']([0-9,.]+)["']/i);
    if (priceAttr) { const n = parseFloat(String(priceAttr[1]).replace(/,/g, '')); if (!isNaN(n) && n > 0) price = n; }
    let miles = null;
    let milesAttr = body.match(/data-mileage=["']([0-9,]+)["']/i) || attrs.match(/data-mileage=["']([0-9,]+)["']/i);
    if (milesAttr && /^[0-9,]+$/.test(milesAttr[1])) miles = parseInt(milesAttr[1].replace(/,/g, ''), 10);
    const yearM = text.match(/\|\s*(20\d{2})\b/) || text.match(/\b(20\d{2})\b/);
    const year = yearM ? parseInt(yearM[1], 10) : null;
    let fuel = '';
    if (/plug.?in\s+hybrid/i.test(text)) fuel = 'Plug-in Hybrid';
    else if (/\bhybrid\b/i.test(text)) fuel = 'Hybrid';
    else { const ft = text.match(/\b(Petrol|Diesel|Electric)\b/i); if (ft) fuel = ft[1].replace(/\b\w/g, c => c.toUpperCase()); }
    let trans = '';
    if (/\b(Automatic|CVT|S tronic|EAT|DSG|Auto)\b/i.test(text)) trans = 'Automatic';
    else if (/\bManual\b/i.test(text)) trans = 'Manual';
    const flags = /photos available soon/i.test(text) ? ['Awaiting Prep'] : [];
    const is_reserved = /\breserved\b|under\s*offer|deposit\s*taken|sale\s*agreed|sold\s*subject|s\.s\.o\.?\b|customer\s*order/i.test(text);
    if (is_reserved) flags.push('Reserved');
    if (/spoticar/i.test(text) || /spoticar/i.test(body)) flags.push('SPOTiCAR');
    if (isNewCar) flags.push('New');
    vehicles.push({
      id: reg, registration: reg, make, model, derivative, mileage: miles, transmission: trans, fuel,
      model_year: year, colour, category: isNewCar ? 'New' : defaultCategory, retail_price: price,
      bring_into_stock_date: new Date().toISOString().slice(0, 10), service_history: '', service_history_notes: '',
      status_flags: flags, notes: [], special_offer: '', image_url,
      detail_url: href ? 'https://www.pentagon-group.co.uk' + href : '', peg_number: '', source_id: vid,
      source: 'pentagon-burton', key_features: [], is_reserved: !!is_reserved,
      spoticar: flags.includes('SPOTiCAR'),
    });
  }
  return vehicles;
}
function withTimeout(ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, clear: () => clearTimeout(t) };
}
async function fetchWithRetry(url, opts = {}, retries = 1) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const to = withTimeout(FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...opts, signal: to.signal });
      to.clear();
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      to.clear();
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}
async function fetchLive() {
  const byReg = {};
  const errors = [];
  const results = await Promise.all(QUERIES.map(async (q) => {
    try {
      const html = await fetchWithRetry(BASE + '?' + q.params, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DealerStockBurton/1.0)',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: 'https://www.pentagon-group.co.uk/used-cars-in-burton',
        },
      }, 1);
      return { category: q.category, html, ok: true };
    } catch (e) {
      errors.push(String(e.message || e));
      return { category: q.category, html: '', ok: false };
    }
  }));
  for (const r of results) {
    if (!r.ok || !r.html) continue;
    for (const v of parseBlocks(r.html, r.category)) {
      const prev = byReg[v.registration];
      if (!prev || (v.image_url && !prev.image_url)) byReg[v.registration] = v;
    }
  }
  const list = Object.values(byReg);
  if (!list.length && errors.length) throw new Error('All Pentagon fetches failed: ' + errors.join('; '));
  return { list, scrapeErrors: errors };
}
async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');
  const to = withTimeout(GH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${path}`, {
      ...opts, signal: to.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
    to.clear();
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch (e) {
    to.clear();
    throw e;
  }
}
async function readJsonFile(path) {
  const file = await gh(`contents/${path}?ref=${BRANCH}`);
  if (file.status !== 200) return { data: path.endsWith('overrides.json') ? {} : [], sha: null };
  const content = Buffer.from(file.data.content || '', 'base64').toString('utf8');
  try { return { data: JSON.parse(content || '[]'), sha: file.data.sha }; }
  catch { return { data: path.endsWith('overrides.json') ? {} : [], sha: file.data.sha }; }
}
async function writeJsonFile(path, obj, sha, message) {
  const content = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  const body = { message, content, branch: BRANCH };
  if (sha) body.sha = sha;
  let result = await gh(`contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
  if (result.status === 409) {
    const fresh = await readJsonFile(path);
    body.sha = fresh.sha;
    result = await gh(`contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
  }
  return result;
}
const MANUAL = ['notes', 'service_history', 'service_history_notes', 'status_flags', 'special_offer', 'dealer_peg', 'peg_number', 'prep_status', 'reserved_by', 'reserved_at', 'sold_by', 'sold_date', 'previous_price', 'spoticar', 'key_features'];
function applyManual(vehicle, prev, overrides, isLive) {
  prev = prev || {};
  const o = overrides[vehicle.registration] || overrides[vehicle.id] || {};
  for (const key of MANUAL) {
    if (o[key] != null) vehicle[key] = o[key];
    else if (prev[key] != null && (key === 'dealer_peg' || key === 'peg_number' || key === 'prep_status' || key === 'reserved_by' || key === 'reserved_at' || key === 'sold_by' || key === 'sold_date' || key === 'previous_price' || key === 'spoticar' || key === 'key_features')) vehicle[key] = prev[key];
    else if (prev[key]) vehicle[key] = prev[key];
  }
  if (prev.bring_into_stock_date) vehicle.bring_into_stock_date = prev.bring_into_stock_date;
  if ((!vehicle.status_flags || !vehicle.status_flags.length) && prev.status_flags) vehicle.status_flags = prev.status_flags;
  if (prev.key_features && (!vehicle.key_features || !vehicle.key_features.length)) vehicle.key_features = prev.key_features;
  if (isLive) {
    if (o.category === 'Sold' || o.category === 'Delivered') {
      vehicle.category = o.category;
      vehicle.sold_date = o.sold_date || prev.sold_date || vehicle.sold_date || new Date().toISOString().slice(0, 10);
      if (o.sold_by) vehicle.sold_by = o.sold_by;
    } else {
      delete vehicle.sold_date;
      const manual = o.category || (['Demonstrators','Pre-reg','Commercials','Arriving Soon','New'].includes(prev.category) ? prev.category : null);
      if (manual && manual !== 'Sold' && manual !== 'Delivered') vehicle.category = manual;
      else if (vehicle.category === 'Sold' || vehicle.category === 'Delivered') vehicle.category = 'Stock';
    }
  } else {
    if (o.category === 'Delivered' || prev.category === 'Delivered') vehicle.category = 'Delivered';
    else vehicle.category = 'Sold';
    if (o.sold_date) vehicle.sold_date = o.sold_date;
    else if (!vehicle.sold_date && prev.sold_date) vehicle.sold_date = prev.sold_date;
  }
  return vehicle;
}
function naturalModelKey(model) {
  const m = model || '';
  const nums = m.match(/\d+/);
  return nums ? [0, parseInt(nums[0], 10), m.toLowerCase()] : [1, 0, m.toLowerCase()];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const started = Date.now();
  try {
    if (!process.env.GITHUB_TOKEN) {
      return res.status(500).json({ ok: false, error: 'GITHUB_TOKEN not set on Vercel' });
    }
    const { list: live, scrapeErrors } = await fetchLive();
    const [vehFile, ovFile, soldFile] = await Promise.all([
      readJsonFile('vehicles.json'),
      readJsonFile('overrides.json'),
      readJsonFile('sold_cars.json'),
    ]);
    const previous = Array.isArray(vehFile.data) ? vehFile.data : (vehFile.data && vehFile.data.vehicles) || [];
    const overrides = ovFile.data && typeof ovFile.data === 'object' ? ovFile.data : {};
    const archivedSold = Array.isArray(soldFile.data) ? soldFile.data : [];
    const prevByReg = Object.fromEntries(previous.filter(v => v.registration).map(v => [v.registration, v]));
    const liveByReg = Object.fromEntries(live.map(v => [v.registration, v]));
    const liveRegs = new Set(Object.keys(liveByReg));
    const today = new Date().toISOString().slice(0, 10);
    const result = [];
    let soldCount = 0, returnedCount = 0;
    const newlySoldRegs = [];
    for (const [reg, old] of Object.entries(prevByReg)) {
      if (!liveRegs.has(reg)) {
        const wasOnSite = !['Sold', 'Delivered'].includes(old.category || 'Stock');
        applyManual(old, old, overrides, false);
        if (old.category !== 'Delivered') {
          if (wasOnSite) {
            old.sold_date = old.sold_date || today;
            soldCount++;
            newlySoldRegs.push(reg);
          }
          old.category = 'Sold';
        }
        old.status_flags = (old.status_flags || []).filter(f => f !== 'Reserved');
        result.push(old);
      }
    }
    for (const [reg, v] of Object.entries(liveByReg)) {
      const prev = prevByReg[reg];
      if (prev && (prev.category === 'Sold' || prev.category === 'Delivered')) returnedCount++;
      applyManual(v, prev, overrides, true);
      if (prev && prev.retail_price != null && v.retail_price != null && Number(prev.retail_price) !== Number(v.retail_price)) {
        v.previous_price = prev.retail_price;
      } else if (prev && prev.previous_price != null) {
        v.previous_price = prev.previous_price;
      }
      if (!v.sold_by && prev && prev.sold_by) v.sold_by = prev.sold_by;
      const ov = overrides[reg] || {};
      if ((v.category === 'Sold' || v.category === 'Delivered') && ov.category !== 'Sold' && ov.category !== 'Delivered') {
        v.category = 'Stock';
        delete v.sold_date;
      }
      if ((v.status_flags || []).includes('New')) {
        if (!['Demonstrators','Pre-reg','Commercials'].includes(v.category)) v.category = 'New';
      }
      const deskReserved = !!(v.reserved_by && String(v.reserved_by).trim());
      if (v.is_reserved || deskReserved) {
        v.status_flags = Array.from(new Set([...(v.status_flags || []).filter(f => f !== 'Reserved'), 'Reserved']));
      } else if (v.status_flags && v.status_flags.length) {
        v.status_flags = v.status_flags.filter(f => f !== 'Reserved');
      }
      delete v.is_reserved;
      const deskSpot = v.spoticar === true || (ov && ov.spoticar === true);
      if (v.spoticar || deskSpot || (v.status_flags || []).some(f => /spoticar/i.test(String(f)))) {
        v.spoticar = true;
        v.status_flags = Array.from(new Set([...(v.status_flags || []).filter(f => !/spoticar/i.test(String(f))), 'SPOTiCAR']));
      }
      result.push(v);
    }
    const have = new Set(result.map(v => v.registration));
    for (const v of archivedSold) {
      if (!v || !v.registration) continue;
      if (have.has(v.registration) || liveRegs.has(v.registration)) continue;
      v.category = 'Sold';
      result.push(v);
      have.add(v.registration);
    }
    result.sort((a, b) => {
      const aOn = ['Stock','Demonstrators','Pre-reg','Commercials','Arriving Soon','New'].includes(a.category) ? 0 : 1;
      const bOn = ['Stock','Demonstrators','Pre-reg','Commercials','Arriving Soon','New'].includes(b.category) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      const mk = (a.make || '').toLowerCase().localeCompare((b.make || '').toLowerCase());
      if (mk) return mk;
      const ka = naturalModelKey(a.model), kb = naturalModelKey(b.model);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      if (ka[2] !== kb[2]) return ka[2].localeCompare(kb[2]);
      return (a.retail_price ?? 1e12) - (b.retail_price ?? 1e12);
    });
    const writeV = await writeJsonFile('vehicles.json', result, vehFile.sha, `Stock sync: ${live.length} live, ${soldCount} newly sold`);
    if (writeV.status !== 200 && writeV.status !== 201) {
      return res.status(500).json({ ok: false, error: 'Failed to write vehicles.json', detail: writeV.data, status: writeV.status });
    }
    try {
      const soldRows = result.filter(v => v.category === 'Sold' || v.category === 'Delivered');
      await writeJsonFile('sold_cars.json', soldRows, soldFile.sha, 'Update sold archive');
    } catch (_) {}
    try {
      const imgs = {};
      for (const v of result) if (v.image_url) imgs[v.registration] = v.image_url;
      const { sha: imgSha } = await readJsonFile('images_map.json');
      await writeJsonFile('images_map.json', imgs, imgSha, 'Update images_map after stock sync');
    } catch (_) {}
    const stockN = result.filter(v => ['Stock','Demonstrators','Pre-reg','Commercials','Arriving Soon','New'].includes(v.category)).length;
    const soldN = result.filter(v => v.category === 'Sold').length;
    const reservedN = result.filter(v => (v.status_flags || []).includes('Reserved') || (v.reserved_by && String(v.reserved_by).trim())).length;
    return res.status(200).json({
      ok: true, live: live.length, inStock: stockN, sold: soldN, newlySold: soldCount, newlySoldRegs,
      reserved: reservedN, returned: returnedCount, total: result.length,
      scrapeErrors: scrapeErrors.length ? scrapeErrors : undefined,
      ms: Date.now() - started, at: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e), ms: Date.now() - started, at: new Date().toISOString() });
  }
};
