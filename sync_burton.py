#!/usr/bin/env python3
"""Sync Dealer Stock Manager from Pentagon Burton Upon Trent public used-car stock."""
import re
import json
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

def fix_make(m):
    m = m.replace('-', ' ').strip()
    mapping = {
        'ds': 'DS', 'byd': 'BYD', 'bmw': 'BMW', 'seat': 'SEAT',
        'mercedes benz': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz',
    }
    return mapping.get(m.lower(), m.title())

def fetch_and_parse():
    req = Request(URL, headers={
        'User-Agent': 'Mozilla/5.0 (compatible; DealerStockSync/1.0)',
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
        text = re.sub(r'<[^>]+>', ' ', body)
        text = re.sub(r'\s+', ' ', text)
        price_m = re.search(r'Our Price\s*£\s*([0-9,]+)|(?:^|[^\w])Price\s*£\s*([0-9,]+)', text)
        price = None
        if price_m:
            price = float((price_m.group(1) or price_m.group(2)).replace(',', ''))
        miles_m = re.search(r'([\d,]+)\s*miles', text, re.I)
        miles = int(miles_m.group(1).replace(',', '')) if miles_m else None
        year_m = re.search(r'\|\s*(20\d{2})\b', text)
        year = int(year_m.group(1)) if year_m else None
        fuel = ''
        ft = re.search(r'\b(Petrol|Diesel|Electric|Hybrid|Plug-?in Hybrid)\b', text, re.I)
        if ft:
            fuel = ft.group(1).title()
        trans = ''
        tr = re.search(r'\b(Manual|Automatic)\b', text, re.I)
        if tr:
            trans = tr.group(1).title()
        body_type = ''
        for b in ('Hatchback', 'Estate', 'Saloon', 'SUV', 'Coupe', 'Convertible', 'MPV'):
            if b.lower() in href.lower() or b.lower() in text.lower():
                body_type = b
                break
        doors = None
        dm = re.search(r'(\d)\s*dr', href, re.I)
        if dm:
            doors = int(dm.group(1))
        vehicles.append({
            'id': reg, 'registration': reg, 'make': make, 'model': model,
            'derivative': derivative.title() if derivative else '', 'engine_cc': None,
            'mileage': miles, 'doors': doors, 'transmission': trans, 'fuel': fuel,
            'body_type': body_type, 'date_of_registration': '', 'model_year': year,
            'num_owners': 1, 'colour': colour, 'chassis_number': '', 'engine_number': '',
            'sales_manager': '', 'peg_number': vid, 'last_service_date': '', 'mot_expiry': '',
            'previous_owner': '', 'service_history': '', 'service_history_notes': '',
            'category': 'Stock', 'vat_qual': 'No', 'retail_price': price,
            'bring_into_stock_date': date.today().isoformat(), 'special_offer': '',
            'status_flags': [], 'accessories': [], 'notes': [], 'source': 'pentagon-burton',
        })
    seen = set()
    unique = []
    for v in vehicles:
        if v['registration'] in seen:
            continue
        seen.add(v['registration'])
        unique.append(v)
    unique.sort(key=lambda x: ((x['make'] or '').lower(), (x['model'] or '').lower(), x.get('retail_price') if x.get('retail_price') is not None else 999999999))
    return unique

def main():
    vehicles = fetch_and_parse()
    payload = json.dumps(vehicles, indent=2)
    (DIR / 'vehicles.json').write_text(payload)
    print(f'Synced {len(vehicles)} vehicles from Pentagon Burton')

if __name__ == '__main__':
    main()
