#!/usr/bin/env python3
"""Sync Dealer Stock from Pentagon Burton.
Website fields (price, mileage, photos, availability) refresh from the site.
Manual team fields (notes, service history, flags) are NEVER wiped by scrape data.
Cars that leave the website move to Sold and keep their notes/history.
"""
import re, json
from html import unescape
from datetime import date
from urllib.request import Request, urlopen
from pathlib import Path

DIR = Path(__file__).resolve().parent
URL = (
    'https://www.pentagon-group.co.uk/inc-ajax-vehicle-results.php'
    '?filter=1&franchise=Group&stockType=physical&vehType=car&payType=cash'
    '&make=any&model=any&grade=any&vehCond=used&budgetType=cash'
    '&minPrice=0&maxPrice=100000&image=with&location=BURTON'
    '&sort=price%20asc&limit=200'
)

# Fields that only the team sets — never taken from the website scrape
MANUAL_FIELDS = (
    'notes', 'service_history', 'service_history_notes',
    'status_flags', 'special_offer',
)

def fix_make(m):
    m = m.replace('-', ' ').strip()
    mapping = {'ds': 'DS', 'byd': 'BYD', 'bmw': 'BMW', 'seat': 'SEAT',
               'mercedes benz': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz'}
    return mapping.get(m.lower(), m.title())

def natural_model_key(model):
    m = model or ''
    nums = re.findall(r'\d+', m)
    return (0, int(nums[0]), m.lower()) if nums else (1, 0, m.lower())

def fetch_live():
    req = Request(URL, headers={
        'User-Agent': 'Mozilla/5.0',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'https://www.pentagon-group.co.uk/used-cars-in-burton',
    })
    html = unescape(urlopen(req, timeout=90).read().decode('utf-8', errors='replace'))
    blocks = re.findall(r'<li data-id="(\d+)"([^>]*)>(.*?)</li>', html, re.S)
    vehicles = []
    for vid, attrs, body in blocks:
        colour_m = re.search(r'data-colour="([^"]*)"', attrs)
        colour = (colour_m.group(1) if colour_m else '').title()
        href_m = re.search(r'href="(/used-cars/[^"]+)"', body)
        href = href_m.group(1) if href_m else ''
        parts = href.strip('/').split('/')
        make = fix_make(parts[1] if len(parts) > 1 else 'Unknown')
        model = (parts[2] if len(parts) > 2 else '').replace('-', ' ').title()
        if model.lower().startswith('ds '):
            model = 'DS ' + model[3:]
        derivative = (parts[4] if len(parts) > 4 else parts[3] if len(parts) > 3 else '').replace('-', ' ')
        reg_m = re.search(r'used-vehicle-photos/\d+/([A-Z0-9]+)-', body)
        if not reg_m:
            continue
        reg = reg_m.group(1)
        img_m = re.search(r'src="(https://pentagon-v4\.imgix\.net/used-vehicle-photos/1/[^"]+)"', body) \
            or re.search(r'src="(https://pentagon-v4\.imgix\.net/used-vehicle-photos/\d+/[^"]+)"', body)
        image_url = ''
        if img_m:
            image_url = img_m.group(1).split('&dpr=')[0]
            if 'w=560' in image_url:
                image_url = image_url.replace('w=560', 'w=400').replace('h=421', 'h=300')
        text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', body))
        price_m = re.search(r'Our Price\s*£\s*([0-9,]+)|(?:^|[^\w])Price\s*£\s*([0-9,]+)', text)
        price = float((price_m.group(1) or price_m.group(2)).replace(',', '')) if price_m else None
        miles_m = re.search(r'([\d,]+)\s*miles', text, re.I)
        miles = int(miles_m.group(1).replace(',', '')) if miles_m else None
        year_m = re.search(r'\|\s*(20\d{2})\b', text)
        year = int(year_m.group(1)) if year_m else None
        fuel = (re.search(r'\b(Petrol|Diesel|Electric|Hybrid|Plug-?in Hybrid)\b', text, re.I) or [None, ''])[1]
        if fuel:
            fuel = fuel.title()
        trans = (re.search(r'\b(Manual|Automatic)\b', text, re.I) or [None, ''])[1]
        if trans:
            trans = trans.title()
        body_type = next((b for b in ('Hatchback', 'Estate', 'Saloon', 'SUV', 'Coupe', 'Convertible', 'MPV')
                          if b.lower() in href.lower() or b.lower() in text.lower()), '')
        dm = re.search(r'(\d)\s*dr', href, re.I)
        doors = int(dm.group(1)) if dm else None
        vehicles.append({
            'id': reg, 'registration': reg, 'make': make, 'model': model,
            'derivative': derivative.title() if derivative else '',
            'mileage': miles, 'doors': doors, 'transmission': trans, 'fuel': fuel,
            'body_type': body_type, 'model_year': year, 'colour': colour,
            'category': 'Stock', 'retail_price': price,
            'bring_into_stock_date': date.today().isoformat(),
            'service_history': '', 'service_history_notes': '',
            'status_flags': [], 'notes': [], 'special_offer': '',
            'image_url': image_url,
            'detail_url': ('https://www.pentagon-group.co.uk' + href) if href else '',
            'source': 'pentagon-burton',
        })
    seen, unique = set(), []
    for v in vehicles:
        if v['registration'] in seen:
            continue
        seen.add(v['registration'])
        unique.append(v)
    return unique

def load_json(path, default):
    p = DIR / path
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text())
    except Exception:
        return default

def apply_manual(vehicle, previous_row, overrides):
    """Restore manual team fields. Priority: overrides.json > previous stock row > leave empty."""
    reg = vehicle.get('registration')
    prev = previous_row or {}
    o = (overrides.get(reg) or overrides.get(vehicle.get('id')) or {})

    for key in MANUAL_FIELDS:
        if key in o and o[key] is not None:
            vehicle[key] = o[key]
        elif prev.get(key):
            vehicle[key] = prev[key]

    # Keep original in-stock date if we already had one
    if prev.get('bring_into_stock_date'):
        vehicle['bring_into_stock_date'] = prev['bring_into_stock_date']

    # Category: Sold/Delivered from previous or override wins over fresh Stock scrape
    if o.get('category') and o['category'] not in ('', 'Stock'):
        if vehicle.get('category') != 'Sold':
            vehicle['category'] = o['category']
    return vehicle

def main():
    live = fetch_live()
    live_by_reg = {v['registration']: v for v in live}
    previous = load_json('vehicles.json', [])
    if isinstance(previous, dict):
        previous = previous.get('vehicles', [])
    overrides = load_json('overrides.json', {})
    if not isinstance(overrides, dict):
        overrides = {}

    result, sold_count = [], 0
    prev_by_reg = {v['registration']: v for v in previous if v.get('registration')}
    live_regs = set(live_by_reg.keys())

    # Cars no longer on the website → Sold (keep all manual data)
    for reg, old in prev_by_reg.items():
        if reg not in live_regs:
            cat = old.get('category') or 'Stock'
            if cat in ('Stock', 'Demonstrators', 'Pre-reg', 'Commercials', 'Arriving Soon'):
                old['category'] = 'Sold'
                old['sold_date'] = date.today().isoformat()
                sold_count += 1
            apply_manual(old, old, overrides)
            result.append(old)

    # Live cars: website fields from scrape, manual fields from overrides/previous
    for reg, v in live_by_reg.items():
        apply_manual(v, prev_by_reg.get(reg), overrides)
        result.append(v)

    result.sort(key=lambda x: (
        0 if x.get('category') == 'Stock' else 1,
        (x.get('make') or '').lower(),
        natural_model_key(x.get('model') or ''),
        x.get('retail_price') if x.get('retail_price') is not None else 999999999,
    ))

    (DIR / 'vehicles.json').write_text(json.dumps(result, separators=(',', ':')))
    imgs = {v['registration']: v['image_url'] for v in result if v.get('image_url')}
    (DIR / 'images_map.json').write_text(json.dumps(imgs, separators=(',', ':')))

    stock_n = sum(1 for v in result if v.get('category') == 'Stock')
    sold_n = sum(1 for v in result if v.get('category') == 'Sold')
    print(f'Synced: {stock_n} in stock, {sold_n} sold (moved {sold_count} this run), total {len(result)}')
    print('Manual fields (notes, service history, flags) preserved from overrides/previous.')

if __name__ == '__main__':
    main()
