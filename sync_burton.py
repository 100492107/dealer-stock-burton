#!/usr/bin/env python3
"""Sync Burton stock. Live = retailable; gone from website = Sold (out of stock)."""
import re, json
from html import unescape
from datetime import date
from urllib.request import Request, urlopen
from pathlib import Path

DIR = Path(__file__).resolve().parent
BASE = 'https://www.pentagon-group.co.uk/inc-ajax-vehicle-results.php'
MANUAL_FIELDS = ('notes', 'service_history', 'service_history_notes', 'status_flags', 'special_offer')

def fix_make(m):
    m = (m or '').replace('-', ' ').strip()
    mapping = {'ds': 'DS', 'byd': 'BYD', 'bmw': 'BMW', 'seat': 'SEAT', 'cupra': 'CUPRA', 'mercedes benz': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz'}
    return mapping.get(m.lower(), m.title())

def clean_model(make, model, derivative):
    m = (model or '').strip()
    mk = (make or '').strip()
    if not m: return m
    if mk and m.lower().startswith(mk.lower() + ' '): m = m[len(mk):].strip()
    parts = m.split()
    out = []
    for p in parts:
        if not out or out[-1].lower() != p.lower(): out.append(p)
    return ' '.join(out)

def natural_model_key(model):
    m = model or ''
    nums = re.findall(r'\d+', m)
    return (0, int(nums[0]), m.lower()) if nums else (1, 0, m.lower())

def tidy_title(title):
    if not title: return ''
    s = re.sub(r'\s+', ' ', title).strip()
    reps = [(r'\bPuretech\b', 'PureTech'), (r'\bTfsi\b', 'TFSI'), (r'\bTsi\b', 'TSI'), (r'\bTdi\b', 'TDI'), (r'\bHdi\b', 'HDi'), (r'\bCrdi\b', 'CRDi'), (r'\bTce\b', 'TCe'), (r'\bMhev\b', 'MHEV'), (r'\bDm I\b', 'DM-i'), (r'\bEat6\b', 'EAT6'), (r'\bEat8\b', 'EAT8'), (r'\bCvt\b', 'CVT'), (r'\bAwd\b', 'AWD'), (r'(\d)\s*kwh\b', r'\1 kWh'), (r'\bPs\b', 'PS'), (r'\bBhp\b', 'BHP'), (r'\bEhybrid\b', 'e-Hybrid'), (r'\bE Tech\b', 'E-Tech')]
    for pat, rep in reps:
        s = re.sub(pat, rep, s, flags=re.I)
    return s

def http_get(params):
    req = Request(BASE + '?' + params, headers={'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest', 'Referer': 'https://www.pentagon-group.co.uk/used-cars-in-burton'})
    return unescape(urlopen(req, timeout=90).read().decode('utf-8', errors='replace'))

def extract_reg(body):
    m = re.search(r'data-reg=["\']([A-Z0-9 ]+)["\']', body, re.I)
    if m: return re.sub(r'\s+', '', m.group(1).upper())
    m = re.search(r'used-vehicle-photos/\d+/([A-Z0-9]+)-', body)
    if m: return m.group(1).upper().replace(' ', '')
    m = re.search(r'id="(?:PCP|LP|HP)PEN([A-Z0-9]{5,8})"', body, re.I)
    if m: return m.group(1).upper()
    text = re.sub(r'<[^>]+>', ' ', body).upper()
    m = re.search(r'\b([A-Z]{2}\d{2}\s*[A-Z]{3})\b', text)
    if m: return re.sub(r'\s+', '', m.group(1))
    return None

def parse_blocks(html, default_category='Stock'):
    blocks = re.findall(r'<li data-id="(\d+)"([^>]*)>(.*?)</li>', html, re.S)
    vehicles = []
    for vid, attrs, body in blocks:
        reg = extract_reg(body)
        if not reg: continue
        colour = ((re.search(r'data-colour="([^"]*)"', attrs) or [None, ''])[1] or '').title()
        href_m = re.search(r'href="(/(?:used-cars|used-vans|new-cars-in-stock)/[^"]+)"', body)
        href = (href_m.group(1) if href_m else '').replace('/print', '')
        parts = href.strip('/').split('/')
        make = fix_make(parts[1] if len(parts) > 1 else '')
        model = (parts[2] if len(parts) > 2 else '').replace('-', ' ').title()
        if model.lower().startswith('ds '): model = 'DS ' + model[3:]
        if 'cupra' in (make or '').lower(): make = 'CUPRA'
        if not make or make == 'Unknown' or not model:
            smalls = re.findall(r'<small[^>]*class="ti-sub"[^>]*>(.*?)</small>', body, re.S)
            labels = [re.sub(r'<[^>]+>', '', s).strip() for s in smalls]
            labels = [x for x in labels if x and x.lower() not in ('pcp from', 'lp from', 'hp from', 'our price')]
            if labels:
                lab = labels[0]
                if not model: model = lab.title()
                if not make or make == 'Unknown':
                    known = {'BYD','BMW','AUDI','PEUGEOT','VAUXHALL','CITROEN','RENAULT','HYUNDAI','KIA','CUPRA','VOLKSWAGEN','VW','TOYOTA','NISSAN','FORD','MERCEDES','SEAT','SKODA','DS','FIAT','MG','TESLA','MINI','MITSUBISHI'}
                    words = lab.replace('-', ' ').split()
                    if words and words[0].upper() in known:
                        make = fix_make(words[0])
                        if len(words) > 1: model = ' '.join(words[1:]).title()
                    else:
                        loc = re.search(r'<b class="ti">([^<]*)</b>', body)
                        if loc:
                            brand = loc.group(1).replace('Burton Upon Trent', '').strip()
                            if brand: make = fix_make(brand.split()[0])
        if not make: make = 'Unknown'
        model = clean_model(make, model or 'Unknown', '') or 'Unknown'
        title_m = re.search(r'<h[34][^>]*>(.*?)</h[34]>', body, re.S)
        title = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', title_m.group(1) if title_m else '')).strip()
        derivative = tidy_title(title)
        img_m = re.search(r'src="(https://pentagon-v4\.imgix\.net/used-vehicle-photos/1/[^"]+)"', body) or re.search(r'src="(https://pentagon-v4\.imgix\.net/used-vehicle-photos/\d+/[^"]+)"', body)
        image_url = ''
        if img_m:
            image_url = img_m.group(1).split('&dpr=')[0]
            if 'w=560' in image_url: image_url = image_url.replace('w=560', 'w=400').replace('h=421', 'h=300')
        text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', body))
        price_m = re.search(r'(?:Our Price|Price)\s*\xa3\s*([0-9,]+)', text, re.I)
        price = float(price_m.group(1).replace(',', '')) if price_m else None
        miles_m = re.search(r'([\d,]+)\s*miles', text, re.I)
        miles = int(miles_m.group(1).replace(',', '')) if miles_m else None
        year_m = re.search(r'\|\s*(20\d{2})\b', text) or re.search(r'\b(20\d{2})\b', text)
        year = int(year_m.group(1)) if year_m else None
        if re.search(r'plug.?in\s+hybrid', text, re.I): fuel = 'Plug-in Hybrid'
        elif re.search(r'\bhybrid\b', text, re.I): fuel = 'Hybrid'
        else:
            ft = re.search(r'\b(Petrol|Diesel|Electric)\b', text, re.I)
            fuel = ft.group(1).title() if ft else ''
        trans = 'Automatic' if re.search(r'\b(Automatic|CVT|S tronic|EAT|DSG|Auto)\b', text, re.I) else ('Manual' if re.search(r'\bManual\b', text, re.I) else '')
        body_type = next((b for b in ('Hatchback','Estate','Saloon','SUV','Coupe','Convertible','MPV','Fastback','Van') if b.lower() in (title or href or text).lower()), '')
        dm = re.search(r'(\d)\s*dr', title or href or '', re.I)
        doors = int(dm.group(1)) if dm else None
        flags = ['Awaiting Prep'] if 'photos available soon' in text.lower() else []
        vehicles.append({'id': reg, 'registration': reg, 'make': make, 'model': model, 'derivative': derivative, 'mileage': miles, 'doors': doors, 'transmission': trans, 'fuel': fuel, 'body_type': body_type, 'model_year': year, 'colour': colour, 'category': default_category, 'retail_price': price, 'bring_into_stock_date': date.today().isoformat(), 'service_history': '', 'service_history_notes': '', 'status_flags': flags, 'notes': [], 'special_offer': '', 'image_url': image_url, 'detail_url': ('https://www.pentagon-group.co.uk' + href) if href else '', 'peg_number': vid, 'source': 'pentagon-burton'})
    return vehicles

def fetch_live():
    queries = [
        ('filter=1&franchise=Group&stockType=physical&vehType=car&payType=cash&make=any&model=any&grade=any&vehCond=used&budgetType=cash&minPrice=0&maxPrice=150000&location=BURTON&sort=price%20asc&limit=300', 'Stock'),
        ('filter=1&franchise=Group&stockType=physical&vehType=car&payType=cash&make=any&model=any&grade=any&vehCond=new&budgetType=cash&minPrice=0&maxPrice=150000&location=BURTON&sort=price%20asc&limit=100', 'Stock'),
        ('filter=1&franchise=Group&stockType=physical&vehType=van&payType=cash&make=any&model=any&grade=any&vehCond=used&budgetType=cash&minPrice=0&maxPrice=150000&location=BURTON&sort=price%20asc&limit=100', 'Commercials'),
    ]
    by_reg = {}
    for params, default_cat in queries:
        try:
            for v in parse_blocks(http_get(params), default_cat):
                prev = by_reg.get(v['registration'])
                if not prev or (v.get('image_url') and not prev.get('image_url')):
                    by_reg[v['registration']] = v
        except Exception as e:
            print('Fetch error', e)
    return list(by_reg.values())

def load_json(path, default):
    p = DIR / path
    if not p.exists(): return default
    try: return json.loads(p.read_text())
    except Exception: return default

def apply_manual(vehicle, previous_row, overrides, *, is_live=True):
    """Notes/service preserved. Live cars never stay Sold; gone cars stay Sold."""
    reg = vehicle.get('registration')
    prev = previous_row or {}
    o = (overrides.get(reg) or overrides.get(vehicle.get('id')) or {})
    for key in MANUAL_FIELDS:
        if key in o and o[key] is not None: vehicle[key] = o[key]
        elif prev.get(key): vehicle[key] = prev[key]
    if prev.get('bring_into_stock_date'): vehicle['bring_into_stock_date'] = prev['bring_into_stock_date']
    if not vehicle.get('status_flags') and prev.get('status_flags'): vehicle['status_flags'] = prev['status_flags']
    if is_live:
        vehicle.pop('sold_date', None)
        manual = o.get('category') or (prev.get('category') if prev.get('category') in ('Demonstrators', 'Pre-reg', 'Commercials', 'Arriving Soon') else None)
        if manual and manual not in ('Sold', 'Delivered'):
            vehicle['category'] = manual
        elif vehicle.get('category') in ('Sold', 'Delivered'):
            vehicle['category'] = 'Stock'
    else:
        if o.get('category') == 'Delivered':
            vehicle['category'] = 'Delivered'
    return vehicle

def main():
    live = fetch_live()
    live_by_reg = {v['registration']: v for v in live}
    previous = load_json('vehicles.json', [])
    if isinstance(previous, dict): previous = previous.get('vehicles', [])
    overrides = load_json('overrides.json', {})
    if not isinstance(overrides, dict): overrides = {}
    result, sold_count, returned_count = [], 0, 0
    prev_by_reg = {v['registration']: v for v in previous if v.get('registration')}
    live_regs = set(live_by_reg.keys())
    for reg, old in prev_by_reg.items():
        if reg not in live_regs:
            cat = old.get('category') or 'Stock'
            if cat not in ('Sold', 'Delivered'):
                old['category'] = 'Sold'
                old['sold_date'] = date.today().isoformat()
                sold_count += 1
            apply_manual(old, old, overrides, is_live=False)
            result.append(old)
    for reg, v in live_by_reg.items():
        prev = prev_by_reg.get(reg)
        if prev and prev.get('category') in ('Sold', 'Delivered'):
            returned_count += 1
        apply_manual(v, prev, overrides, is_live=True)
        if v.get('category') in ('Sold', 'Delivered'):
            v['category'] = 'Stock'
            v.pop('sold_date', None)
        result.append(v)
    result.sort(key=lambda x: (0 if x.get('category') in ('Stock','Demonstrators','Pre-reg','Commercials','Arriving Soon') else 1, (x.get('make') or '').lower(), natural_model_key(x.get('model') or ''), x.get('retail_price') if x.get('retail_price') is not None else 999999999))
    (DIR / 'vehicles.json').write_text(json.dumps(result, separators=(',', ':')))
    imgs = {v['registration']: v['image_url'] for v in result if v.get('image_url')}
    (DIR / 'images_map.json').write_text(json.dumps(imgs, separators=(',', ':')))
    stock_n = sum(1 for v in result if v.get('category') in ('Stock','Demonstrators','Pre-reg','Commercials','Arriving Soon'))
    sold_n = sum(1 for v in result if v.get('category') == 'Sold')
    print(f'Live on site: {len(live)} | In stock views: {stock_n} | Sold: {sold_n} (newly sold: {sold_count}, returned: {returned_count}) | DB total: {len(result)}')

if __name__ == '__main__':
    main()
