/**
 * POST/GET /api/sync-stock — Pentagon Burton stock + live prices; Sold when gone
 * Features: full equipment list from detail pages + explicit title kit only.
 */
const OWNER = '100492107';
const REPO = 'dealer-stock-burton';
const BRANCH = 'main';
const BASE = 'https://www.pentagon-group.co.uk/inc-ajax-vehicle-results.php';
const FETCH_TIMEOUT_MS = 18000;
const GH_TIMEOUT_MS = 15000;

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
  m = body.match(/id="(?:PCP|LP|HP)PEN([A-Z0-9]{5,8})"/i);
  if (m) candidates.push(m[1].toUpperCase());
  const plain = body.replace(/<[^>]+>/g, ' ').toUpperCase();
  const re = /\b([A-Z]{2}\d{2}\s*[A-Z]{3})\b/g;
  let x; while ((x = re.exec(plain))) candidates.push(x[1].replace(/\s+/g, ''));
  for (const c of candidates) if (isValidUkReg(c)) return c;
  return null;
}
function tidyTitle(title) {
  if (!title) return '';
  let s = title.replace(/\s+/g, ' ').trim();
  [[/\bPuretech\b/gi,'PureTech'],[/\bTfsi\b/g,'TFSI'],[/\bTdi\b/g,'TDI'],[/\bHdi\b/gi,'HDi'],[/\bCrdi\b/gi,'CRDi'],[/\bMhev\b/gi,'MHEV'],[/\bDm I\b/gi,'DM-i'],[/\bEat6\b/gi,'EAT6'],[/\bEat8\b/gi,'EAT8'],[/\bCvt\b/g,'CVT'],[/\bAwd\b/g,'AWD'],[/(\d)\s*kwh\b/gi,'$1 kWh'],[/\bPs\b/g,'PS'],[/\bBhp\b/g,'BHP']].forEach(([p,r]) => { s = s.replace(p,r); });
  return s;
}

const DESIRABLE_RE = [
  /heated\s*(front\s*)?seat/i, /heated\s*steering/i, /heated\s*wheel/i, /heated\s*windscreen/i,
  /ventilated\s*seat/i, /cooled\s*seat/i, /massage\s*seat/i,
  /electric\s*(front\s*)?seat/i, /power\s*(front\s*)?seat/i, /memory\s*seat/i,
  /leather/i, /nappa/i, /alcantara/i, /dakota\s*leather/i, /vernasca/i, /sensatec/i,
  /ambient\s*light/i, /panoramic/i, /\bpan\s*roof/i, /sunroof/i, /glass\s*roof/i,
  /matrix\s*led/i, /adaptive\s*led/i, /\bled\s*head/i,
  /adaptive\s*cruise/i, /active\s*cruise/i,
  /blind\s*spot/i, /cross\s*traffic/i, /lane\s*(?:keep|assist|depart)/i,
  /parking\s*camera/i, /revers(?:e|ing)\s*camera/i, /360|surround\s*camera|bird.?eye/i,
  /park\s*assist/i, /parking\s*sensor/i,
  /keyless/i, /comfort\s*access/i, /hands.?free\s*(?:tailgate|boot)/i, /power\s*tailgate/i, /electric\s*(?:tailgate|boot)/i,
  /wireless\s*charg/i, /apple\s*carplay/i, /android\s*auto/i, /carplay/i,
  /sat\s*nav|navigation|nav\s*system/i, /heads?\s*up|\bHUD\b/i,
  /digital\s*cockpit|virtual\s*cockpit|live\s*cockpit/i,
  /bose|bang\s*&?\s*olufsen|harman|premium\s*sound|meridian|harman\s*kardon/i,
  /climate\s*control|dual[\s-]*zone|tri[\s-]*zone|four[\s-]*zone|automatic\s*air/i,
  /adaptive\s*suspension|air\s*suspension|m\s*sport\s*suspension/i,
  /tow\s*bar|towbar/i, /sport\s*seat/i,
];
const SKIP_FEATURE_RE = /^(isofix|tyre pressure|abs|esp|airbag|immobiliser|remote central locking|electric windows|power steering|dab radio|smartphone interface|electric powertrain|alloy wheels|bluetooth|usb|start.?stop)$/i;

function isDesirableFeature(name) {
  const n = (name || '').trim();
  if (!n || n.length < 3 || n.length > 90) return false;
  if (SKIP_FEATURE_RE.test(n)) return false;
  if (/styling/i.test(n)) return false;
  return DESIRABLE_RE.some(re => re.test(n));
}

function inferTrimFeatures(v) {
  const blob = [v.make, v.model, v.derivative].filter(Boolean).join(' ').toLowerCase();
  const out = [];
  const add = (...items) => items.forEach(i => { if (i && !out.includes(i)) out.push(i); });
  if (/heated\s*(front\s*)?seat/.test(blob)) add('Heated Seats');
  if (/ventilated\s*seat|cooled\s*seat/.test(blob)) add('Ventilated Seats');
  if (/massage\s*seat/.test(blob)) add('Massage Seats');
  if (/electric\s*(front\s*)?seat|memory\s*seat/.test(blob)) add('Electric Seats');
  if (/heated\s*steering|heated\s*wheel/.test(blob)) add('Heated Steering Wheel');
  if (/wireless\s*charg/.test(blob)) add('Wireless Charging');
  if (/panoramic|pan\s*roof|glass\s*roof/.test(blob)) add('Panoramic Roof');
  if (/sunroof|sun\s*roof/.test(blob)) add('Sunroof');
  if (/apple\s*carplay|carplay/.test(blob)) add('Apple CarPlay');
  if (/android\s*auto/.test(blob)) add('Android Auto');
  if (/bose|harman\s*kardon|bang\s*&?\s*olufsen|meridian|premium\s*sound/.test(blob)) add('Premium Audio');
  if (/head[\s-]*up|\bhud\b/.test(blob)) add('Head-Up Display');
  if (/adaptive\s*cruise|active\s*cruise/.test(blob)) add('Adaptive Cruise Control');
  if (/360|surround\s*camera/.test(blob)) add('360 Camera');
  if (/matrix\s*led/.test(blob)) add('Matrix LED Headlights');
  if (/keyless|comfort\s*access/.test(blob)) add('Keyless Entry');
  if (/power\s*tailgate|electric\s*(?:tailgate|boot)/.test(blob)) add('Power Tailgate');
  if (/\bleather\b|nappa|alcantara|dakota|vernasca|sensatec/.test(blob)) add('Leather Seats');
  if (/ambient\s*light/.test(blob)) add('Ambient Lighting');
  if (/parking\s*sensor/.test(blob)) add('Parking Sensors');
  if (/\bled\s*head/.test(blob)) add('LED Headlights');
  return out;
}

function isVagueFeature(name) {
  const n = String(name || '').toLowerCase();
  if (/styling/.test(n)) return true;
  if (/^(electric powertrain|dab radio|smartphone interface|alloy wheels|bluetooth)$/i.test(name)) return true;
  return false;
}

function featurePriority(name) {
  const n = String(name || '').toLowerCase();
  const high = [/heated seat/, /ventilated seat/, /massage seat/, /electric seat/, /leather|nappa|dakota/, /wireless charg/, /panoramic|sunroof/, /carplay|android auto/, /bose|harman|meridian/, /heated steering/, /head-?up/, /360|surround camera/, /matrix led/, /ambient light/, /adaptive cruise/, /power tailgate/];
  if (high.some(re => re.test(n))) return 0;
  return 1;
}

function mergeFeatures(scraped, inferred) {
  const seen = new Set();
  const out = [];
  for (const list of [scraped || [], inferred || []]) {
    for (const f of list) {
      if (isVagueFeature(f)) continue;
      let label = String(f).trim();
      if (/leather|nappa|dakota|vernasca|sensatec|alcantara/i.test(label) && !/seat/i.test(label)) label = 'Leather Seats';
      else if (/heated\s*(front\s*)?seats?/i.test(label)) label = 'Heated Seats';
      else if (/ventilated|cooled\s*seats?/i.test(label)) label = 'Ventilated Seats';
      else if (/apple\s*carplay|carplay/i.test(label)) label = 'Apple CarPlay';
      else if (/android\s*auto/i.test(label)) label = 'Android Auto';
      else if (/wireless\s*charg/i.test(label)) label = 'Wireless Charging';
      else if (/panoramic|glass\s*roof/i.test(label)) label = 'Panoramic Roof';
      const k = label.toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(label);
    }
  }
  out.sort((a, b) => featurePriority(a) - featurePriority(b));
  return out.slice(0, 24);
}

function extractFeaturesFromDetail(html) {
  const found = [];
  const seen = new Set();
  const push = (name) => {
    name = (name || '').replace(/\s+/g, ' ').trim();
    if (!name || seen.has(name.toLowerCase())) return;
    if (!isDesirableFeature(name)) return;
    seen.add(name.toLowerCase());
    found.push(name);
  };
  let m;
  const labelRe = /<label[^>]*class="[^"]*bold[^"]*"[^>]*>([^<]{3,60})<\/label>/gi;
  while ((m = labelRe.exec(html))) push(m[1]);
  const titleRe = /<i[^>]*title="([^"]{3,60})"[^>]*>/gi;
  while ((m = titleRe.exec(html))) push(m[1]);
  const dtRe = /<dt>([^<]{3,90})<\/dt>/gi;
  while ((m = dtRe.exec(html))) push(m[1]);
  return found.slice(0, 20);
}

async function fetchKeyFeatures(detailUrl) {
  if (!detailUrl) return [];
  try {
    const html = await fetchWithRetry(detailUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DealerStockBurton/1.0)' },
    }, 0);
    return extractFeaturesFromDetail(html);
  } catch (_) {
    return [];
  }
}

async function enrichFeatures(liveList, prevByReg, timeBudgetMs) {
  const start = Date.now();
  const need = liveList.filter(v => {
    const prev = prevByReg[v.registration];
    if (prev && Array.isArray(prev.key_features) && prev.key_features.length) {
      v.key_features = prev.key_features;
    }
    return !!v.detail_url;
  });
  const concurrency = 6;
  let i = 0;
  async function worker() {
    while (i < need.length) {
      if (Date.now() - start > timeBudgetMs) break;
      const idx = i++;
      const v = need[idx];
      const feats = await fetchKeyFeatures(v.detail_url);
      if (feats.length) v.key_features = feats;
      else if (!v.key_features) v.key_features = [];
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  for (const v of liveList) {
    if (!v.key_features || !v.key_features.length) {
      const prev = prevByReg[v.registration];
      if (prev && prev.key_features) v.key_features = prev.key_features;
    }
    const inferred = inferTrimFeatures(v);
    v.key_features = mergeFeatures(v.key_features, inferred);
  }
  return liveList;
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
      if (m) reg = m[1].toUpperCase();
      else reg = 'NEW' + vid;
    }
    if (!reg) continue;
    const parts = href.replace(/^\/+|\/+$/g, '').split('/');
    let make = fixMake(parts[1] || '');
    let model = (parts[2] || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (model.toLowerCase().startsWith('ds ')) model = 'DS ' + model.slice(3);
    if ((make || '').toLowerCase().includes('cupra')) make = 'CUPRA';
    if (!make) make = 'Unknown';
    model = cleanModel(make, model || 'Unknown');
    const titleM = body.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/);
    const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
    const derivative = tidyTitle(title);
    let image_url = '';
    const imgM = body.match(/src="(https:\/\/pentagon-v4\.imgix\.net\/used-vehicle-photos\/1\/[^"]+)"/) || body.match(/src="(https:\/\/pentagon-v4\.imgix\.net\/used-vehicle-photos\/\d+\/[^"]+)"/);
    if (imgM) { image_url = imgM[1].split('&dpr=')[0]; if (image_url.includes('w=560')) image_url = image_url.replace('w=560','w=400').replace('h=421','h=300'); }
    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    let price = null;
    let priceAttr = body.match(/data-price=["']([0-9,.]+)["']/i);
    if (!priceAttr) priceAttr = attrs.match(/data-price=["']([0-9,.]+)["']/i);
    if (priceAttr) {
      const n = parseFloat(String(priceAttr[1]).replace(/,/g, ''));
      if (!isNaN(n) && n > 0) price = n;
    }
    if (price == null) {
      let priceM = body.match(/Our Price<\/small>\s*<b[^>]*>[^0-9]*([0-9,]{3,})/i);
      if (!priceM) priceM = body.match(/<b[^>]*>[^0-9]*([0-9,]{4,})[^0-9]*<\/b>/i);
      if (priceM) {
        const n = parseFloat(String(priceM[1]).replace(/,/g, ''));
        if (!isNaN(n) && n > 0) price = n;
      }
    }
    let miles = null;
    let milesAttr = body.match(/data-mileage=["']([0-9,]+)["']/i);
    if (!milesAttr) milesAttr = attrs.match(/data-mileage=["']([0-9,]+)["']/i);
    if (milesAttr && /^[0-9,]+$/.test(milesAttr[1])) miles = parseInt(milesAttr[1].replace(/,/g, ''), 10);
    if (miles == null) {
      const milesM = text.match(/([\d,]+)\s*miles/i);
      if (milesM) miles = parseInt(milesM[1].replace(/,/g, ''), 10);
    }
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
    const is_reserved = /\breserved\b|under\s*offer|deposit\s*taken|sale\s*agreed/i.test(text);
    if (is_reserved) flags.push('Reserved');
    if (isNewCar) flags.push('New');
    const category = isNewCar ? 'New' : defaultCategory;
    vehicles.push({ id: reg, registration: reg, make, model, derivative, mileage: miles, transmission: trans, fuel, model_year: year, colour, category, retail_price: price, bring_into_stock_date: new Date().toISOString().slice(0, 10), service_history: '', service_history_notes: '', status_flags: flags, notes: [], special_offer: '', image_url, detail_url: href ? 'https://www.pentagon-group.co.uk' + href : '', peg_number: '', source_id: vid, source: 'pentagon-burton', key_features: [], is_reserved: !!is_reserved });
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
      if (attempt < retries) await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function fetchLive() {
  const byReg = {};
  const errors = [];
  const results = await Promise.all(
    QUERIES.map(async (q) => {
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
    })
  );
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
      ...opts,
      signal: to.signal,
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

const MANUAL = ['notes', 'service_history', 'service_history_notes', 'status_flags', 'special_offer', 'dealer_peg', 'peg_number', 'prep_status', 'reserved_by', 'reserved_at', 'sold_by', 'previous_price'];
function applyManual(vehicle, prev, overrides, isLive) {
  prev = prev || {};
  const o = overrides[vehicle.registration] || overrides[vehicle.id] || {};
  for (const key of MANUAL) {
    if (o[key] != null) vehicle[key] = o[key];
    else if (prev[key] != null && (key === 'dealer_peg' || key === 'peg_number' || key === 'prep_status' || key === 'reserved_by' || key === 'reserved_at' || key === 'sold_by' || key === 'previous_price')) vehicle[key] = prev[key];
    else if (prev[key]) vehicle[key] = prev[key];
  }
  if (prev.bring_into_stock_date) vehicle.bring_into_stock_date = prev.bring_into_stock_date;
  if ((!vehicle.status_flags || !vehicle.status_flags.length) && prev.status_flags) vehicle.status_flags = prev.status_flags;
  if (prev.key_features && (!vehicle.key_features || !vehicle.key_features.length)) vehicle.key_features = prev.key_features;
  if (isLive) {
    delete vehicle.sold_date;
    const manual = o.category || (['Demonstrators','Pre-reg','Commercials','Arriving Soon','New'].includes(prev.category) ? prev.category : null);
    if (manual && manual !== 'Sold' && manual !== 'Delivered') vehicle.category = manual;
    else if (vehicle.category === 'Sold' || vehicle.category === 'Delivered') vehicle.category = 'Stock';
  } else {
    if (o.category === 'Delivered' || prev.category === 'Delivered') vehicle.category = 'Delivered';
    else vehicle.category = 'Sold';
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

    const { list: liveRaw, scrapeErrors } = await fetchLive();

    const [vehFile, ovFile, soldFile] = await Promise.all([
      readJsonFile('vehicles.json'),
      readJsonFile('overrides.json'),
      readJsonFile('sold_cars.json'),
    ]);
    const previous = Array.isArray(vehFile.data) ? vehFile.data : (vehFile.data && vehFile.data.vehicles) || [];
    const overrides = ovFile.data && typeof ovFile.data === 'object' ? ovFile.data : {};
    const archivedSold = Array.isArray(soldFile.data) ? soldFile.data : [];

    const prevByReg = Object.fromEntries(previous.filter(v => v.registration).map(v => [v.registration, v]));

    const live = await enrichFeatures(liveRaw, prevByReg, 35000);
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
      if (v.category === 'Sold' || v.category === 'Delivered') { v.category = 'Stock'; delete v.sold_date; }
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
    const newN = result.filter(v => v.category === 'New').length;
    const priced = result.filter(v => v.retail_price).length;
    const reservedN = result.filter(v => (v.status_flags || []).includes('Reserved') || (v.reserved_by && String(v.reserved_by).trim())).length;

    return res.status(200).json({
      ok: true,
      live: live.length,
      inStock: stockN,
      newCars: newN,
      sold: soldN,
      newlySold: soldCount,
      newlySoldRegs,
      reserved: reservedN,
      returned: returnedCount,
      priced,
      withFeatures: result.filter(v => v.key_features && v.key_features.length).length,
      total: result.length,
      scrapeErrors: scrapeErrors.length ? scrapeErrors : undefined,
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: String(e.message || e),
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
  }
};
