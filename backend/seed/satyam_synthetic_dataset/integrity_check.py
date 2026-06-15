#!/usr/bin/env python3
"""Deep integrity / error check of the generated synthetic dataset."""
import csv, os, sys, datetime
from collections import Counter
D='/data/synthetic'
errors=[]; warns=[]; info=[]
def E(m): errors.append(m)
def W(m): warns.append(m)
def I(m): info.append(m)

csv.field_size_limit(10**7)
def load(name):
    with open(f'{D}/{name}',encoding='utf-8',newline='') as f:
        return list(csv.DictReader(f))

cases=load('cases.csv'); persons=load('persons.csv'); cp=load('case_persons.csv')
nar=load('narratives.csv'); stations=load('stations.csv'); officers=load('officers.csv')
I(f'rows: cases={len(cases):,} persons={len(persons):,} case_persons={len(cp):,} narratives={len(nar):,} stations={len(stations):,} officers={len(officers):,}')

# ---------- 1. PRIMARY KEY UNIQUENESS ----------
for name,rows,key in [('cases',cases,'case_id'),('persons',persons,'person_id'),('stations',stations,'station_id'),('officers',officers,'officer_id'),('narratives',nar,'narrative_id')]:
    ids=[r[key] for r in rows]
    if len(ids)!=len(set(ids)): E(f'{name}: duplicate {key} ({len(ids)-len(set(ids))} dupes)')
    if any(not x for x in ids): E(f'{name}: empty {key} present')

case_ids=set(c['case_id'] for c in cases)
person_ids=set(p['person_id'] for p in persons)
station_ids=set(s['station_id'] for s in stations)
officer_ids=set(o['officer_id'] for o in officers)

# ---------- 2. REFERENTIAL INTEGRITY ----------
bad=sum(1 for c in cases if c['station_id'] not in station_ids); bad and E(f'cases.station_id: {bad} not in stations')
bad=sum(1 for c in cases if c['io_officer_id'] not in officer_ids); bad and E(f'cases.io_officer_id: {bad} not in officers')
bad=sum(1 for r in cp if r['case_id'] not in case_ids); bad and E(f'case_persons.case_id: {bad} orphan')
bad=sum(1 for r in cp if r['person_id'] not in person_ids); bad and E(f'case_persons.person_id: {bad} orphan')
bad=sum(1 for n in nar if n['case_id'] not in case_ids); bad and E(f'narratives.case_id: {bad} orphan')
bad=sum(1 for o in officers if o['station_id'] not in station_ids); bad and E(f'officers.station_id: {bad} not in stations')

# every case must have >=2 narratives (en+kn) and a complainant
nar_by_case=Counter(n['case_id'] for n in nar)
missing_nar=[c for c in case_ids if nar_by_case.get(c,0)<2]
if missing_nar: E(f'{len(missing_nar)} cases missing en/kn narrative pair')
lang_by_case={}
for n in nar: lang_by_case.setdefault(n['case_id'],set()).add(n['language'])
badlang=sum(1 for c,ls in lang_by_case.items() if ls!={'en','kn'}); badlang and E(f'{badlang} cases without exactly en+kn')
role_by_case={}
for r in cp: role_by_case.setdefault(r['case_id'],Counter())[r['role']]+=1
no_comp=sum(1 for c in case_ids if role_by_case.get(c,{}).get('Complainant',0)<1); no_comp and E(f'{no_comp} cases without a Complainant')

# ---------- 3. VALUE DOMAINS / NULLS ----------
for i,c in enumerate(cases):
    for col in ['case_id','fir_number','station_id','district','crime_type','legal_code','fir_type','status','incident_date','report_date','io_name']:
        if not c.get(col): E(f'cases row {i}: empty {col}'); break
    if c['legal_code'] not in ('IPC','BNS'): E(f"cases {c['case_id']}: bad legal_code {c['legal_code']}")
    if c['fir_type'] not in ('Heinous','Non Heinous'): E(f"cases {c['case_id']}: bad fir_type {c['fir_type']}")
    if c['crime_category'] not in ('IPC','SLL'): E(f"cases {c['case_id']}: bad crime_category {c['crime_category']}")
    for b in ['is_group','convicted']:
        if c[b] not in ('0','1'): E(f"cases {c['case_id']}: {b} not 0/1")
    if len(errors)>40: break

# ---------- 4. LOGICAL CONSISTENCY ----------
bad_dt=0; bad_ipc_bns=0; grp_bad=0; arr_bad=0; conv_bad=0; vc_bad=0; ac_bad=0; geo_bad=0; fut=0
CUT=datetime.date(2024,7,1)
for c in cases:
    try:
        inc=datetime.date.fromisoformat(c['incident_date']); rep=datetime.date.fromisoformat(c['report_date'])
        if rep<inc: bad_dt+=1
        if rep.year>2025: fut+=1
        # legal code must match report date vs BNS cutover
        exp='IPC' if rep<CUT else 'BNS'
        if c['legal_code']!=exp: bad_ipc_bns+=1
    except Exception: bad_dt+=1
    ac=int(c['accused_count']); vc=int(c['victim_count']); arr=int(c['arrested_count']); cs=int(c['charge_sheeted']); cv=int(c['convicted'])
    if (ac>1)!=(c['is_group']=='1'): grp_bad+=1
    if arr>ac: arr_bad+=1
    if cv==1 and cs<1: conv_bad+=1
    if ac<0 or vc<0: vc_bad+=1
    if c['latitude']:
        try:
            la=float(c['latitude']); lo=float(c['longitude'])
            if not(11.0<=la<=19.5 and 73.0<=lo<=79.5): geo_bad+=1
        except: geo_bad+=1
bad_dt and E(f'{bad_dt} cases: report_date<incident_date or unparyable')
bad_ipc_bns and E(f'{bad_ipc_bns} cases: legal_code mismatches BNS 2024-07-01 cutover')
grp_bad and E(f'{grp_bad} cases: is_group inconsistent with accused_count')
arr_bad and E(f'{arr_bad} cases: arrested_count > accused_count')
conv_bad and E(f'{conv_bad} cases: convicted=1 but charge_sheeted<1')
vc_bad and E(f'{vc_bad} cases: negative counts')
geo_bad and W(f'{geo_bad} cases: lat/lon outside Karnataka bounding box')
fut and W(f'{fut} cases: report year >2025')

# fir_number uniqueness within station+year
seen=set(); dup=0
for c in cases:
    k=(c['station_id'],c['fir_number'])
    if k in seen: dup+=1
    seen.add(k)
dup and E(f'{dup} duplicate (station, fir_number) pairs')

# ---------- 5. PERSON / ROLE SANITY ----------
for p in persons:
    if p['gender'] not in ('Male','Female','Boy','Girl'): E(f"persons {p['person_id']}: bad gender {p['gender']}"); break
    try:
        a=int(p['age'])
        if a<0 or a>110: W(f"persons {p['person_id']}: age {a} out of range")
    except: E(f"persons {p['person_id']}: bad age"); break
roles=set(r['role'] for r in cp)
if not {'Complainant','Victim','Accused','Witness'}<=roles: E(f'missing roles, found {roles}')
# minors flagged Boy/Girl should be <18, adults Male/Female >=18
badminor=0; badadult=0
pm={p['person_id']:p for p in persons}
for p in persons:
    a=int(p['age'])
    if p['gender'] in ('Boy','Girl') and a>=18: badminor+=1
    if p['gender'] in ('Male','Female') and a<18: badadult+=1
badminor and W(f'{badminor} persons gender Boy/Girl but age>=18')
badadult and W(f'{badadult} persons gender Male/Female but age<18')

# ---------- 6. ENCODING / NARRATIVE QUALITY ----------
ffd=0; emptyb=0; kn_no_script=0; placeholder=0
for n in nar:
    b=n['body']
    if '\ufffd' in b: ffd+=1
    if not b.strip(): emptyb+=1
    if n['language']=='kn' and not any(0x0C80<=ord(ch)<=0x0CFF for ch in b): kn_no_script+=1
    if 'None' in b or '{' in b or '}' in b: placeholder+=1
ffd and E(f'{ffd} narratives contain replacement char U+FFFD')
emptyb and E(f'{emptyb} narratives empty body')
kn_no_script and E(f'{kn_no_script} kn narratives lack Kannada script')
placeholder and E(f'{placeholder} narratives contain None/unfilled placeholder braces')

# ---------- 7. SECTIONS present ----------
nosec=sum(1 for c in cases if not c['sections'] or c['sections']=='—')
nosec and W(f'{nosec} cases have no section numbers (some SLL/missing legitimately blank)')

print('='*64); print('DEEP INTEGRITY CHECK — SYNTHETIC DATASET'); print('='*64)
for m in info: print('  info  -',m)
print(f'\nERRORS: {len(errors)}')
for m in errors[:60]: print('  [ERROR]',m)
print(f'\nWARNINGS: {len(warns)}')
for m in warns: print('  [warn ]',m)
print('\n'+('✅ NO ERRORS — dataset is internally consistent.' if not errors else '❌ ERRORS FOUND — see above.'))
