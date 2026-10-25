/**
 * POST/GET /api/sync-stock — Scrape Pentagon Burton; missing cars → Sold; push vehicles.json
 * Requires GITHUB_TOKEN with repo contents:write
 */
const OWNER = '100492107';
const REPO = 'dealer-stock-burton';
const BRANCH = 'main';
const BASE = 'https://www.pentagon-group.co.uk/inc-ajax-vehicle-results.php';
const QUERIES = [
  { params: 'filter=1&franchise=Group&stockType=physical&vehType=car&payType=cash&make=any&model=any&grade=any&vehCond=used&budgetType=cash&minPrice=0&maxPrice=150000&location=BURTON&sort=price%20asc&limit=300', category: 'Stock' },
  { params: 'filter=1&franchise=Group&stockType=physical&vehType=car&payType=cash&make=any&model=any&grade=any&vehCond=new&budgetType=cash&minPrice=0&maxPrice=150000&location=BURTON&sort=price%20asc&limit=100', category: 'Stock' },
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
  return /^[A-Z]{2}\d{2}[A-Z]{3}$/.test(r) || /^[A-Z]\d{1,3}[A-Z]{3}$/.test(r) || /^\d{2}[A-Z]\d{6}$/.test(r) || /^\d{2}[A-Z]{2}\d{5}$/.test(r);
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
    const reg = extractReg(body);
    if (!reg) continue;
    const colourM = attrs.match(/data-colour="([^"]*)"/);
    const colour = colourM ? colourM[1].replace(/\b\w/g, c => c.toUpperCase()) : '';
    const hrefM = body.match(/href="(\/(?:used-cars|used-vans|new-cars-in-stock)\/[^"]+)"/);
    const href = hrefM ? hrefM[1].replace(/\/print$/, '') : '';
    const parts = href.replace(/^\/+|\/+$/g, '').split('/');
    let make = fixMake(parts[1] || '');
    let model = (parts[2] || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (model.toLowerCase().startsWith('ds ')) model = 'DS ' + model.slice(3);
    if ((make || '').toLowerCase().includes('cupra')) make = 'CUPRA';
    if (!make || make === 'Unknown' || !model) {
      const smalls = [...body.matchAll(/<small[^>]*class="ti-sub"[^>]*>([\s\S]*?)<\/small>/g)].map(s => s[1].replace(/<[^>]+>/g, '').trim()).filter(x => x && !['pcp from','lp from','hp from','our price'].includes(x.toLowerCase()));
      if (smalls[0]) {
        const lab = smalls[0];
        if (!model) model = lab.replace(/\b\w/g, c => c.toUpperCase());
        if (!make || make === 'Unknown') {
          const words = lab.replace(/-/g, ' ').split(/\s+/);
          const known = new Set(['BYD','BMW','AUDI','PEUGEOT','VAUXHALL','CITROEN','RENAULT','HYUNDAI','KIA','CUPRA','VOLKSWAGEN','VW','TOYOTA','NISSAN','FORD','MERCEDES','SEAT','SKODA','DS','FIAT','MG','MITSUBISHI']);
          if (words[0] && known.has(words[0].toUpperCase())) { make = fixMake(words[0]); if (words.length > 1) model = words.slice(1).join(' ').replace(/\b\w/g, c => c.toUpperCase()); }
        }
      }
    }
    if (!make) make = 'Unknown';
    model = cleanModel(make, model || 'Unknown');
    const titleM = body.match(/<h[34][^>]*>([\s\S]*?)<\/h[34]>/);
    const title = titleM ? titleM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
    const derivative = tidyTitle(title);
    let image_url = '';
    const imgM = body.match(/src="(https:\/\/pentagon-v4\.imgix\.net\/used-vehicle-photos\/1\/[^"]+)"/) || body.match(/src="(https:\/\/pentagon-v4\.imgix\.net\/used-vehicle-photos\/\d+\/[^"]+)"/);
    if (imgM) { image_url = imgM[1].split('&dpr=')[0]; if (image_url.includes('w=560')) image_url = image_url.replace('w=560','w=400').replace('h=421','h=300'); }
    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const priceM = text.match(/(?:Our Price|Price)\s*£\s*([0-9,]+)/i);
    const price = priceM ? parseFloat(priceM[1].replace(/,/g, '')) : null;
    const milesM = text.match(/([\d,]+)\s*miles/i);
    const miles = milesM ? parseInt(milesM[1].replace(/,/g, ''), 10) : null;
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
    vehicles.push({ id: reg, registration: reg, make, model, derivative, mileage: miles, transmission: trans, fuel, model_year: year, colour, category: defaultCategory, retail_price: price, bring_into_stock_date: new Date().toISOString().slice(0, 10), service_history: '', service_history_notes: '', status_flags: flags, notes: [], special_offer: '', image_url, detail_url: href ? 'https://www.pentagon-group.co.uk' + href : '', peg_number: vid, source: 'pentagon-burton' });
  }
  return vehicles;
}
async function fetchLive() {
  const byReg = {};
  for (const q of QUERIES) {
    const res = await fetch(BASE + '?' + q.params, { headers: { 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest', Referer: 'https://www.pentagon-group.co.uk/used-cars-in-burton' } });
    if (!res.ok) continue;
    const html = await res.text();
    for (const v of parseBlocks(html, q.category)) {
      const prev = byReg[v.registration];
      if (!prev || (v.image_url && !prev.image_url)) byReg[v.registration] = v;
    }
  }
  return Object.values(byReg);
}
async function gh(path, opts = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN not set');
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${path}`, { ...opts, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
async function readJsonFile(path) {
  const file = await gh(`contents/${path}?ref=${BRANCH}`);
  if (file.status !== 200) return { data: path.endsWith('overrides.json') ? {} : [], sha: null };
  const content = Buffer.from(file.data.content, 'base64').toString('utf8');
  try { return { data: JSON.parse(content || '[]'), sha: file.data.sha }; } catch { return { data: path.endsWith('overrides.json') ? {} : [], sha: file.data.sha }; }
}
async function writeJsonFile(path, obj, sha, message) {
  const content = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
  const body = { message, content, branch: BRANCH };
  if (sha) body.sha = sha;
  return gh(`contents/${path}`, { method: 'PUT', body: JSON.stringify(body) });
}
const MANUAL = ['notes', 'service_history', 'service_history_notes', 'status_flags', 'special_offer'];
function applyManual(vehicle, prev, overrides, isLive) {
  prev = prev || {};
  const o = overrides[vehicle.registration] || overrides[vehicle.id] || {};
  for (const key of MANUAL) { if (o[key] != null) vehicle[key] = o[key]; else if (prev[key]) vehicle[key] = prev[key]; }
  if (prev.bring_into_stock_date) vehicle.bring_into_stock_date = prev.bring_into_stock_date;
  if ((!vehicle.status_flags || !vehicle.status_flags.length) && prev.status_flags) vehicle.status_flags = prev.status_flags;
  if (isLive) {
    delete vehicle.sold_date;
    const manual = o.category || (['Demonstrators','Pre-reg','Commercials','Arriving Soon'].includes(prev.category) ? prev.category : null);
    if (manual && manual !== 'Sold' && manual !== 'Delivered') vehicle.category = manual;
    else if (vehicle.category === 'Sold' || vehicle.category === 'Delivered') vehicle.category = 'Stock';
  } else if (o.category === 'Delivered') vehicle.category = 'Delivered';
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
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const live = await fetchLive();
    const liveByReg = Object.fromEntries(live.map(v => [v.registration, v]));
    const { data: previousRaw, sha: vehiclesSha } = await readJsonFile('vehicles.json');
    const previous = Array.isArray(previousRaw) ? previousRaw : (previousRaw.vehicles || []);
    const { data: overrides } = await readJsonFile('overrides.json');
    const prevByReg = Object.fromEntries(previous.filter(v => v.registration).map(v => [v.registration, v]));
    const liveRegs = new Set(Object.keys(liveByReg));
    const today = new Date().toISOString().slice(0, 10);
    const result = [];
    let soldCount = 0, returnedCount = 0;
    for (const [reg, old] of Object.entries(prevByReg)) {
      if (!liveRegs.has(reg)) {
        const cat = old.category || 'Stock';
        if (cat !== 'Sold' && cat !== 'Delivered') { old.category = 'Sold'; old.sold_date = today; soldCount++; }
        applyManual(old, old, overrides || {}, false);
        result.push(old);
      }
    }
    for (const [reg, v] of Object.entries(liveByReg)) {
      const prev = prevByReg[reg];
      if (prev && (prev.category === 'Sold' || prev.category === 'Delivered')) returnedCount++;
      applyManual(v, prev, overrides || {}, true);
      if (v.category === 'Sold' || v.category === 'Delivered') { v.category = 'Stock'; delete v.sold_date; }
      result.push(v);
    }
    result.sort((a, b) => {
      const aOn = ['Stock','Demonstrators','Pre-reg','Commercials','Arriving Soon'].includes(a.category) ? 0 : 1;
      const bOn = ['Stock','Demonstrators','Pre-reg','Commercials','Arriving Soon'].includes(b.category) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      const mk = (a.make || '').toLowerCase().localeCompare((b.make || '').toLowerCase());
      if (mk) return mk;
      const ka = naturalModelKey(a.model), kb = naturalModelKey(b.model);
      if (ka[0] !== kb[0]) return ka[0] - kb[0];
      if (ka[1] !== kb[1]) return ka[1] - kb[1];
      if (ka[2] !== kb[2]) return ka[2].localeCompare(kb[2]);
      return (a.retail_price ?? 1e12) - (b.retail_price ?? 1e12);
    });
    const writeV = await writeJsonFile('vehicles.json', result, vehiclesSha, `Stock sync: ${live.length} live, ${soldCount} newly sold`);
    if (writeV.status !== 200 && writeV.status !== 201) return res.status(500).json({ error: 'Failed to write vehicles.json', detail: writeV.data });
    const imgs = {};
    for (const v of result) if (v.image_url) imgs[v.registration] = v.image_url;
    const { sha: imgSha } = await readJsonFile('images_map.json');
    await writeJsonFile('images_map.json', imgs, imgSha, 'Update images_map after stock sync');
    const stockN = result.filter(v => ['Stock','Demonstrators','Pre-reg','Commercials','Arriving Soon'].includes(v.category)).length;
    const soldN = result.filter(v => v.category === 'Sold').length;
    return res.status(200).json({ ok: true, live: live.length, inStock: stockN, sold: soldN, newlySold: soldCount, returned: returnedCount, total: result.length, at: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
