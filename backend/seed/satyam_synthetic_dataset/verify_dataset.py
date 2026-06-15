#!/usr/bin/env python3
"""Verify synthetic dataset against real source distributions (params.json from FIR_Details_Data.csv)."""
import csv, json
from collections import Counter, defaultdict
R='/data/ref'; OUT='/data/synthetic'
params=json.load(open(f'{R}/params.json'))
cases=list(csv.DictReader(open(f'{OUT}/cases.csv')))
N=len(cases)
print('='*64); print(f'SYNTHETIC DATASET VERIFICATION  (N={N:,} cases)'); print('='*64)

def pct(c,tot): return f'{100*c/tot:5.1f}%'
def cmp_block(title, syn, real):
    print(f'\n--- {title} ---')
    print(f'{"value":32} {"synthetic":>10} {"real":>10}')
    keys=list(dict.fromkeys(list(real.keys())+list(syn.keys())))
    rtot=sum(real.values()) or 1; stot=sum(syn.values()) or 1
    for k in keys[:14]:
        print(f'{str(k)[:32]:32} {pct(syn.get(k,0),stot):>10} {pct(real.get(k,0),rtot):>10}')

# 1. group vs individual
grp=sum(1 for c in cases if c['is_group']=='1')
print(f'\n[1] GROUP vs INDIVIDUAL crime')
print(f'    synthetic group-share: {pct(grp,N)}   |   real (FIR accused>1): {params["group_share"]*100:.1f}%')

# 2. conviction
conv=sum(1 for c in cases if c['convicted']=='1')
print(f'\n[2] CONVICTION rate')
print(f'    synthetic: {pct(conv,N)}   |   real: {params["conv_rate"]*100:.1f}%')

# 3. heinous
hein=sum(1 for c in cases if c['fir_type']=='Heinous')
rh=params['firtype_counts']; rht=sum(rh.values())
rhein=next((v for k,v in rh.items() if 'Heinous' in k and 'Non' not in k),0)
print(f'\n[3] HEINOUS share')
print(f'    synthetic: {pct(hein,N)}   |   real: {pct(rhein,rht)}')

# 4. legal code IPC vs BNS (temporal)
lc=Counter(c['legal_code'] for c in cases)
print(f'\n[4] LEGAL CODE (IPC pre-2024-07-01 / BNS after)')
for k,v in lc.items(): print(f'    {k}: {pct(v,N)}')

# 5. district coverage
sd=Counter(c['district'] for c in cases)
print(f'\n[5] DISTRICT coverage: {len(sd)} districts represented (real: {len(params["district_counts"])})')
cmp_block('Top districts', dict(sd.most_common(10)), params['district_counts'])

# 6. crime-type coverage
sc=Counter(c['crime_type'] for c in cases)
print(f'\n[6] CRIME-TYPE coverage: {len(sc)} distinct crime types')
print('    Top 15 synthetic crime types:')
for k,v in sc.most_common(15): print(f'      {k[:42]:42} {pct(v,N)}')

# 7. complaint mode
cmp_block('Complaint mode', dict(Counter(c['complaint_mode'] for c in cases)), params['complaintmode_counts'])

# 8. status / stage
cmp_block('Case status/stage', dict(Counter(c['status'] for c in cases)), {k.split(':')[0].strip():v for k,v in params['firstage_counts'].items()})

# 9. accused-count distribution
ac=Counter(int(c['accused_count']) for c in cases)
print(f'\n[9] ACCUSED-COUNT distribution (0..6)')
rad={int(k):v for k,v in params['accused_dist'].items()}; radt=sum(rad.values())
for i in range(7): print(f'    {i} accused: syn {pct(ac.get(i,0),N)}  real {pct(rad.get(i,0),radt)}')

# 10. category IPC vs SLL
cat=Counter(c['crime_category'] for c in cases)
print(f'\n[10] CATEGORY IPC vs SLL'); [print(f'    {k}: {pct(v,N)}') for k,v in cat.items()]

# 11. month seasonality presence
mo=Counter(c['incident_date'][5:7] for c in cases)
print(f'\n[11] MONTH coverage: {len(mo)} months present (expect 12)')

# 12. year coverage
yr=Counter(c['fir_year'] for c in cases)
print(f'\n[12] YEAR coverage:', dict(sorted(yr.items())))

# ---- WHO-to-WHO: persons & roles ----
print('\n'+'='*64); print('WHO did it TO WHOM  (persons / roles)'); print('='*64)
cp=list(csv.DictReader(open(f'{OUT}/case_persons.csv')))
role=Counter(r['role'] for r in cp)
print('[13] Role distribution:'); [print(f'    {k}: {v:,}') for k,v in role.most_common()]
persons={p['person_id']:p for p in csv.DictReader(open(f'{OUT}/persons.csv'))}
# victim gender by crime category sanity
vic_g=Counter(); child=0; comp_vic_link=0
for r in cp:
    if r['role']=='Victim':
        p=persons.get(r['person_id'])
        if p:
            vic_g[p['gender']]+=1
            if int(p['age'])<18: child+=1
print('\n[14] Victim gender mix:', dict(vic_g), f'| minors among victims: {child:,}')

# narratives bilingual check
nar=list(csv.DictReader(open(f'{OUT}/narratives.csv')))
lang=Counter(n['language'] for n in nar)
has_kn=any(any(ord(ch)>=0x0C80 and ord(ch)<=0x0CFF for ch in n['body']) for n in nar if n['language']=='kn')
print(f'\n[15] Narratives: {len(nar):,} total | langs {dict(lang)} | Kannada script present: {has_kn}')

# coverage checklist
print('\n'+'='*64); print('COVERAGE CHECKLIST (user requirements)'); print('='*64)
chk=[('All crime types (>=40)', len(sc)>=40),
     ('Group AND individual crimes', grp>0 and (N-grp)>0),
     ('Victimless/suo-moto crimes (drugs/gambling/excise)', any(c['crime_type'].upper() in ('NDPS (DRUGS)','GAMBLING','KARNATAKA EXCISE ACT') for c in cases)),
     ('Crimes against women', any('CRUELTY' in c['crime_type'].upper() or c['crime_type'].upper() in('RAPE','MOLESTATION','DOWRY DEATHS') for c in cases)),
     ('Crimes against children (POCSO)', any('POCSO' in c['crime_type'].upper() for c in cases)),
     ('Both IPC and BNS legal regimes', lc.get('IPC',0)>0 and lc.get('BNS',0)>0),
     ('All 4 roles complainant/victim/accused/witness', len(role)>=4),
     ('Bilingual EN+KN narratives', lang.get('en',0)>0 and lang.get('kn',0)>0 and has_kn),
     ('Geo coordinates present', sum(1 for c in cases if c['latitude'])>0),
     ('Officer/IO attribution', all(c['io_name'] for c in cases[:100])),
     ('FIR numbers + dates', all(c['fir_number'] and c['incident_date'] for c in cases[:100]))]
for name,ok in chk: print(f'    [{"PASS" if ok else "FAIL"}] {name}')
print('\nDONE.')
