#!/usr/bin/env python3
"""Satyam synthetic KSP crime dataset generator.
Grounded in real Karnataka distributions extracted from the source zip.
100% synthetic — zero real PII. Fixed seed for reproducibility."""
import json, csv, random, sys, os, datetime as dt
R='/data/ref'; OUT='/data/synthetic'; os.makedirs(OUT,exist_ok=True)
SEED=20260615; random.seed(SEED)
N=int(sys.argv[1]) if len(sys.argv)>1 else 100000

cr=json.load(open(f'{R}/crime_ref.json'))
catalog=cr['catalog']; dist_matrix=cr['dist_matrix']; M2C=cr['matrix_to_crime']; EXTRA=cr['extra_crimes']
sections=json.load(open(f'{R}/sections.json'))
names=json.load(open(f'{R}/names.json'))
params=json.load(open(f'{R}/params.json'))
stations_rows=list(csv.DictReader(open(f'{R}/fir_stations.csv')))

# ---------------- district -> range ----------------
RANGE={
'Commissionerates':['Bengaluru City','Mysuru City','Hubballi Dharwad City','Mangaluru City','Belagavi City','Kalaburagi City'],
'Central Range':['Bengaluru Dist','Ramanagara','Tumakuru','Kolar','Chickballapura','K.G.F'],
'Eastern Range':['Chitradurga','Davanagere','Shivamogga','Haveri'],
'Western Range':['Dakshina Kannada','Udupi','Chikkamagaluru','Uttara Kannada'],
'Northern Range':['Belagavi Dist','Bagalkot','Vijayapur','Dharwad','Gadag'],
'North Eastern Range':['Kalaburagi','Bidar','Yadgir'],
'Southern Range':['Mysuru Dist','Mandya','Chamarajanagar','Hassan','Kodagu'],
'Ballari Range':['Ballari','Koppal','Raichur','Vijayanagara'],
'Other Units':['Karnataka Railways','Coastal Security Police','CID']}
D2R={d:rng for rng,ds in RANGE.items() for d in ds}

# ---------------- weighted sampler ----------------
def wsample(d):
    ks=list(d.keys()); ws=[float(d[k]) for k in ks]
    return random.choices(ks,weights=ws,k=1)[0]
def wsample_n(d,n):
    ks=list(d.keys()); ws=[float(d[k]) for k in ks]
    return random.choices(ks,weights=ws,k=n)

# ---------------- build crime-type catalog union (matrix + extras) ----------------
# canonical crime types we will emit, with section info pulled from catalog where possible
def find_cat(key):
    if key in catalog: return catalog[key]
    for k,v in catalog.items():
        if key.split('(')[0].strip() in k or k in key: return v
    return None
CRIMES={}
for mcol,ckey in M2C.items():
    c=find_cat(ckey) or {}
    CRIMES[ckey]={'name':c.get('crime_type',ckey.title()),'ipc':c.get('ipc',[]),'bns':c.get('bns',[]),'bns_deleted':c.get('bns_deleted',False),'motives':c.get('motives',{}),'matrix_col':mcol}
for ckey in EXTRA:
    c=find_cat(ckey) or {}
    CRIMES.setdefault(ckey,{'name':c.get('crime_type',ckey.title()),'ipc':c.get('ipc',[]),'bns':c.get('bns',[]),'bns_deleted':c.get('bns_deleted',False),'motives':c.get('motives',{}),'matrix_col':None})

# fallback sections for crimes missing parsed sections
FALLBACK_IPC={'NDPS (DRUGS)':['20','21','22'],'KARNATAKA EXCISE ACT':['32','34'],'MISSING PERSON':['—'],'GAMBLING':['78','87'],'CYBER CRIME':['66','66C','66D'],'SC/ST (ATROCITIES)':['3'],'DOWRY PROHIBITION ACT':['3','4'],'POCSO':['8','12'],'POCSO RAPE':['4','6'],'ARMS ACT 1959':['25','27']}
FALLBACK_BNS={'CYBER CRIME':['318','319','336'],'GAMBLING':['—'],'MISSING PERSON':['—']}

# ---------------- per-district crime weights (matrix + extras spread by district size) ----------------
dist_counts=params['district_counts']
def district_crime_weights(d):
    w={}
    mrow=dist_matrix.get(d,{})
    for mcol,ckey in M2C.items():
        if mcol in mrow: w[ckey]=mrow[mcol]
    # spread extra (mostly SLL + minor IPC) proportional to district share
    share=dist_counts.get(d,1)/sum(dist_counts.values())
    for ckey,tot in EXTRA.items():
        w[ckey]=w.get(ckey,0)+tot*share
    if not w:  # tiny units
        w={'THEFT':5,'CASES OF HURT':3,'MISSING PERSON':3,'CYBER CRIME':2}
    return w
DCW={d:district_crime_weights(d) for d in dist_counts}

# stations grouped by district
from collections import defaultdict
st_by_dist=defaultdict(list)
for s in stations_rows:
    st_by_dist[s['District_Name']].append(s)

# ---------------- officers ----------------
RANKS=[('PC',8),('HC',14),('ASI',16),('PSI',26),('PI',24),('CPI',9),('Dy.SP',3)]
IO_RANKS=['ASI','PSI','PI','CPI']
def rand_name(gender=None):
    g=gender or random.choice(['m','f'])
    first=random.choice(names['male_first'] if g=='m' else names['female_first'])
    if random.random()<0.85:
        return f"{first} {random.choice(names['surnames'])}", g
    return first, g
officers=[]; oid=0; st_officers=defaultdict(list); station_index={}
sid=0; stations_out=[]
def clean_coord(la,lo):
    try: a=float(la); o=float(lo)
    except: return '',''
    inka=lambda x,y: 11.0<=x<=19.5 and 73.0<=y<=79.5
    if inka(a,o): return round(a,6),round(o,6)
    if inka(o,a): return round(o,6),round(a,6)  # lat/lon swapped in source
    return '',''
for d,sts in st_by_dist.items():
    rng=D2R.get(d,'Other Units')
    for s in sts:
        sid+=1
        lat,lon=clean_coord(s['lat'],s['lon'])
        stations_out.append({'station_id':sid,'station_name':s['UnitName'],'district':d,'range':rng,'latitude':lat,'longitude':lon})
        station_index[sid]={'name':s['UnitName'],'district':d,'lat':lat,'lon':lon,'rng':rng,'n':float(s['n'] or 1)}
        nof=random.randint(4,9)
        for _ in range(nof):
            oid+=1; rk=random.choices([r for r,_ in RANKS],weights=[w for _,w in RANKS])[0]
            nm,_g=rand_name()
            officers.append({'officer_id':oid,'name':nm.upper(),'rank':rk,'station_id':sid})
            if rk in IO_RANKS: st_officers[sid].append((oid,nm.upper(),rk))
        if not st_officers[sid]:
            oid+=1; nm,_=rand_name(); officers.append({'officer_id':oid,'name':nm.upper(),'rank':'PSI','station_id':sid}); st_officers[sid].append((oid,nm.upper(),'PSI'))
print('stations',len(stations_out),'officers',len(officers))

# ---------------- crime category semantics ----------------
WOMEN_CRIMES={'RAPE','MOLESTATION','CRUELTY BY HUSBAND','DOWRY DEATHS','INSULTING MODESTY OF WOMEN (EVE TEASING)','ASSAULT OR USE OF CRIMINAL FORCE TO DISROBE WOMEN','OFFENCES RELATED TO MARRIAGE','DOWRY PROHIBITION ACT'}
CHILD_CRIMES={'POCSO','POCSO RAPE'}
PROPERTY_CRIMES={'THEFT','BURGLARY - DAY','BURGLARY - NIGHT','ROBBERY','DACOITY','CHEATING','CYBER CRIME','CRIMINAL BREACH OF TRUST','CRIMINAL MISAPPROPRIATION','RECEIVING OF STOLEN PROPERTY','FORGERY','COUNTERFEITING','MISCHIEF'}
VICTIMLESS={'GAMBLING','NDPS (DRUGS)','KARNATAKA EXCISE ACT','ARMS ACT 1959','PUBLIC SAFETY','AFFRAY','RIOTS'}
MISSING={'MISSING PERSON'}
GENERIC_MOTIVES={'Sudden provocation':3,'Previous enmity':3,'Monetary gain':4,'Property dispute':2,'Family dispute':2,'Under influence of alcohol':1,'Personal vendetta':2,'Not yet ascertained':2}
import re as _re
def clean_motives(m):
    out={}
    for k,v in m.items():
        if not isinstance(k,str): continue
        if _re.search(r'Act|IPC|BNS|Sec\.|\d{3}|Class|Total|Other Items|Not Included',k): continue
        if len(k)>45: continue
        out[k]=v
    return out
# natural English verb phrase per crime type for narrative realism
CRIME_PHRASE={'MURDER':'committed the murder of the victim','ATTEMPT TO MURDER':'attempted to murder the victim','RAPE':'committed rape','THEFT':'committed theft of valuables','ROBBERY':'committed robbery','DACOITY':'committed dacoity','BURGLARY - DAY':'committed house-breaking and theft by day','BURGLARY - NIGHT':'committed house-breaking and theft by night','CASES OF HURT':'voluntarily caused hurt to the victim','RIOTS':'were involved in rioting and unlawful assembly','CHEATING':'cheated and dishonestly induced delivery of property','CYBER CRIME':'committed online fraud / a cyber offence','MOLESTATION':'outraged the modesty of the victim','KIDNAPPING AND ABDUCTION':'kidnapped/abducted the victim','CRUELTY BY HUSBAND':'subjected the victim to cruelty','DOWRY DEATHS':'caused a dowry-related death','MOTOR VEHICLE ACCIDENTS FATAL':'caused a fatal road accident by rash and negligent driving','MOTOR VEHICLE ACCIDENTS NON-FATAL':'caused a road accident by rash and negligent driving','POCSO':'committed a sexual offence against a child','POCSO RAPE':'committed aggravated sexual assault on a child','NDPS (DRUGS)':'were found in possession of narcotic substances','GAMBLING':'were found gambling in a public place','CRIMINAL INTIMIDATION':'criminally intimidated the complainant','SC/ST (ATROCITIES)':'committed atrocities against the victim','KARNATAKA EXCISE ACT':'were found in possession of illicit liquor','CRIMINAL TRESPASS':'committed criminal trespass','NEGLIGENT ACT':'committed a negligent act endangering life','SUICIDE':'abetted the suicide of the victim','ARSON':'committed arson','DEATHS DUE TO RASHNESS/NEGLIGENCE':'caused death by a rash and negligent act','INSULTING MODESTY OF WOMEN (EVE TEASING)':'insulted the modesty of the victim','ASSAULT OR USE OF CRIMINAL FORCE TO DISROBE WOMEN':'assaulted the victim with intent to disrobe','CRIMINAL BREACH OF TRUST':'committed criminal breach of trust','RECEIVING OF STOLEN PROPERTY':'were found in possession of stolen property','FORGERY':'committed forgery','MISCHIEF':'committed mischief causing damage to property'}
def crime_phrase(ckey,name):
    return CRIME_PHRASE.get(ckey,'committed '+name.lower())
ONLINE={'CYBER CRIME','CHEATING','FORGERY','COUNTERFEITING'}

# ---------------- Kannada lexicon ----------------
KN={'MURDER':'ಕೊಲೆ','ATTEMPT TO MURDER':'ಕೊಲೆ ಯತ್ನ','RAPE':'ಅತ್ಯಾಚಾರ','THEFT':'ಕಳ್ಳತನ','ROBBERY':'ದರೋಡೆ','DACOITY':'ಡಕಾಯಿತಿ','BURGLARY - DAY':'ಹಗಲು ಮನೆಗಳ್ಳತನ','BURGLARY - NIGHT':'ರಾತ್ರಿ ಮನೆಗಳ್ಳತನ','CASES OF HURT':'ಹಲ್ಲೆ/ಗಾಯ','RIOTS':'ಗಲಭೆ','CHEATING':'ವಂಚನೆ','CYBER CRIME':'ಸೈಬರ್ ಅಪರಾಧ','MOLESTATION':'ವಿನಯಭಂಗ','KIDNAPPING AND ABDUCTION':'ಅಪಹರಣ','CRUELTY BY HUSBAND':'ಪತಿಯಿಂದ ಕ್ರೌರ್ಯ','DOWRY DEATHS':'ವರದಕ್ಷಿಣೆ ಸಾವು','MOTOR VEHICLE ACCIDENTS FATAL':'ಮಾರಣಾಂತಿಕ ವಾಹನ ಅಪಘಾತ','MOTOR VEHICLE ACCIDENTS NON-FATAL':'ವಾಹನ ಅಪಘಾತ','POCSO':'ಮಕ್ಕಳ ಮೇಲಿನ ಲೈಂಗಿಕ ದೌರ್ಜನ್ಯ','POCSO RAPE':'ಮಕ್ಕಳ ಮೇಲಿನ ಅತ್ಯಾಚಾರ','NDPS (DRUGS)':'ಮಾದಕ ವಸ್ತು ಪ್ರಕರಣ','GAMBLING':'ಜೂಜಾಟ','MISSING PERSON':'ಕಾಣೆಯಾದ ವ್ಯಕ್ತಿ','CRIMINAL INTIMIDATION':'ಬೆದರಿಕೆ','SC/ST (ATROCITIES)':'ಎಸ್ಸಿ/ಎಸ್ಟಿ ದೌರ್ಜನ್ಯ','KARNATAKA EXCISE ACT':'ಅಬಕಾರಿ ಪ್ರಕರಣ','CRIMINAL TRESPASS':'ಅಕ್ರಮ ಪ್ರವೇಶ','NEGLIGENT ACT':'ನಿರ್ಲಕ್ಷ್ಯದ ಕೃತ್ಯ','SUICIDE':'ಆತ್ಮಹತ್ಯೆ','ARSON':'ಬೆಂಕಿ ಹಚ್ಚಿದ ಪ್ರಕರಣ'}
KN_STATUS={'Pending Trial':'ವಿಚಾರಣೆ ಬಾಕಿ','Convicted':'ಶಿಕ್ಷೆಯಾಗಿದೆ','Undetected':'ಪತ್ತೆಯಾಗಿಲ್ಲ','Dis/Acq':'ವಜಾ/ಖುಲಾಸೆ','Under Investigation':'ತನಿಖೆ ಪ್ರಗತಿಯಲ್ಲಿದೆ','Traced':'ಪತ್ತೆಯಾಗಿದೆ','False Case':'ಸುಳ್ಳು ಪ್ರಕರಣ','Charge Sheeted':'ಆರೋಪಪಟ್ಟಿ ಸಲ್ಲಿಸಲಾಗಿದೆ'}
PLACE_EN=['residence','main road','market area','bus stand','agricultural land','shop','highway','vacant site','school premises','bank ATM','temple street','apartment complex','petrol bunk','village outskirts','railway station']
TIME_BUCKETS=['00:30','02:15','05:45','08:20','10:30','12:45','14:10','16:35','18:50','20:15','22:40','23:55']

status_map=params['firstage_counts']
mode_map=params['complaintmode_counts']
type_map=params['firtype_counts']
month_map={int(k):v for k,v in params['month_counts'].items()}
accused_dist={int(k):v for k,v in params['accused_dist'].items()}
HEINOUS={'MURDER','ATTEMPT TO MURDER','RAPE','DACOITY','ROBBERY','DOWRY DEATHS','POCSO','POCSO RAPE','KIDNAPPING AND ABDUCTION','CULPABLE HOMICIDE NOT AMOUNTING TO MUDER'}

def pick_sections(ckey,legal):
    info=CRIMES[ckey]
    cl=lambda x:[s for s in (x or []) if s and s!='—']
    if legal=='BNS':
        secs=cl(info['bns']) or cl(FALLBACK_BNS.get(ckey)) or cl(FALLBACK_IPC.get(ckey)) or cl(info['ipc'])
    else:
        secs=cl(info['ipc']) or cl(FALLBACK_IPC.get(ckey))
    if not secs: secs=['—']
    k=min(len(secs),random.choice([1,1,1,2,2,3]))
    return secs[:k]

def make_person(role,ckey,age=None,gender=None):
    if ckey in CHILD_CRIMES and role=='Victim':
        age=random.randint(4,17); gender=random.choice(['Girl','Boy'])
        g='f' if gender=='Girl' else 'm'
    elif ckey in WOMEN_CRIMES and role=='Victim':
        age=age or random.randint(18,55); g='f'; gender='Female'
    else:
        g=gender or random.choice(['m','m','f'])
        age=age or random.randint(18,70)
        gender='Male' if g=='m' else 'Female'
    nm,_=rand_name(g)
    return {'name':nm.title(),'gender':gender,'age':age}

# ---------------- generate ----------------
fc=open(f'{OUT}/cases.csv','w',newline=''); cw=csv.writer(fc)
cw.writerow(['case_id','fir_number','fir_year','station_id','station_name','district','range','crime_type','crime_category','legal_code','sections','fir_type','status','complaint_mode','motive','incident_date','incident_time','report_date','latitude','longitude','place_of_offence','io_officer_id','io_name','victim_count','accused_count','is_group','arrested_count','charge_sheeted','convicted'])
fp=open(f'{OUT}/persons.csv','w',newline=''); pw=csv.writer(fp); pw.writerow(['person_id','name','gender','age','district'])
fcp=open(f'{OUT}/case_persons.csv','w',newline=''); cpw=csv.writer(fcp); cpw.writerow(['case_id','person_id','role'])
fn=open(f'{OUT}/narratives.csv','w',newline=''); nw=csv.writer(fn); nw.writerow(['narrative_id','case_id','language','body'])

districts=list(dist_counts.keys())
dist_weights=[dist_counts[d] for d in districts]
pid=0; nid=0; fir_ctr=defaultdict(int)
SLL={'GAMBLING','NDPS (DRUGS)','KARNATAKA EXCISE ACT','ARMS ACT 1959','DOWRY PROHIBITION ACT','SC/ST (ATROCITIES)','POCSO','POCSO RAPE','CYBER CRIME','PUBLIC SAFETY'}

for cid in range(1,N+1):
    d=random.choices(districts,weights=dist_weights)[0]
    ckey=wsample(DCW[d])
    info=CRIMES[ckey]
    sts=st_by_dist.get(d) or st_by_dist[random.choice(list(st_by_dist))]
    # weight station by its real FIR volume
    s=random.choices(sts,weights=[float(x['n'] or 1) for x in sts])[0]
    sid_sel=[k for k,v in station_index.items() if v['name']==s['UnitName'] and v['district']==d]
    sid_sel=sid_sel[0] if sid_sel else random.choice(list(station_index))
    sinfo=station_index[sid_sel]
    # dates
    yr=random.choices([2021,2022,2023,2024,2025],weights=[18,20,24,22,16])[0]
    mo=random.choices(list(month_map),weights=list(month_map.values()))[0]
    day=random.randint(1,28)
    inc=dt.date(yr,mo,day)
    rep=inc+dt.timedelta(days=random.choices([0,0,1,2,5,15,40],weights=[40,20,15,10,8,4,3])[0])
    if rep>dt.date(2025,12,31): rep=dt.date(2025,12,31)
    legal='BNS' if rep>=dt.date(2024,7,1) else 'IPC'
    secs=pick_sections(ckey,legal)
    fir_type='Heinous' if ckey in HEINOUS and random.random()<0.85 else ('Heinous' if random.random()<0.05 else 'Non Heinous')
    status=wsample(status_map); status=status.split(':')[0].strip()
    mode=wsample(mode_map)
    motives=clean_motives(info['motives']) or GENERIC_MOTIVES
    motive=wsample(motives) if motives else 'Not yet ascertained'
    # accused
    ac=int(wsample({str(k):v for k,v in accused_dist.items()}))
    if ckey in MISSING: ac=0
    if ckey in VICTIMLESS and ac==0: ac=random.randint(1,4)
    convicted=1 if status=='Convicted' else 0
    if convicted and ac==0: ac=random.randint(1,2)
    is_group=1 if ac>1 else 0
    arrested=0 if ac==0 else random.randint(0,ac)
    cs=1 if (status in('Charge Sheeted','Convicted','Pending Trial') and ac>0 and random.random()<0.8) else 0
    if convicted: cs=1; arrested=max(arrested,1)
    # geo jitter
    try:
        lat=round(float(sinfo['lat'])+random.uniform(-0.03,0.03),6) if sinfo['lat'] else ''
        lon=round(float(sinfo['lon'])+random.uniform(-0.03,0.03),6) if sinfo['lon'] else ''
    except: lat=lon=''
    io=random.choice(st_officers[sid_sel]); io_id,io_name,io_rank=io
    fir_ctr[(sid_sel,yr)]+=1; firno=f"{fir_ctr[(sid_sel,yr)]:04d}/{yr}"
    place='an online platform / digital medium' if ckey in ONLINE else random.choice(PLACE_EN)
    ttime=random.choice(TIME_BUCKETS)
    cat='SLL' if ckey in SLL else 'IPC'
    # ---- persons ----
    ppl=[]
    if ckey in MISSING:
        v=make_person('Victim',ckey); ppl.append(('Victim',v)); ppl.append(('Complainant',make_person('Complainant',ckey)))
        vc=1
    elif ckey in VICTIMLESS:
        vc=0
    else:
        vc=1 if ckey in PROPERTY_CRIMES else random.choices([1,1,1,2,3],weights=[60,18,10,7,5])[0]
        comp=make_person('Complainant',ckey); ppl.append(('Complainant',comp))
        for _ in range(vc):
            ppl.append(('Victim',make_person('Victim',ckey)))
    for _ in range(ac):
        ppl.append(('Accused',make_person('Accused',ckey)))
    if random.random()<0.5:
        ppl.append(('Witness',make_person('Witness',ckey)))
    if ckey in VICTIMLESS:
        ppl.insert(0,('Complainant',{'name':io_name.title(),'gender':'Male','age':random.randint(28,55)}))
    person_ids=[]
    for role,p in ppl:
        pid+=1
        pw.writerow([pid,p['name'],p['gender'],p['age'],d])
        cpw.writerow([cid,pid,role])
        person_ids.append((role,p,pid))
    # ---- narratives ----
    comp=next((p for r,p,_ in person_ids if r=='Complainant'),None)
    vics=[p for r,p,_ in person_ids if r=='Victim']
    accs=[p for r,p,_ in person_ids if r=='Accused']
    cname=info['name'].upper()
    comp_nm=comp['name'] if comp else 'the complainant'
    if accs:
        if len(accs)==1: acl=f"the accused {accs[0]['name']} (aged {accs[0]['age']})"
        else: acl=f"{len(accs)} accused persons including {accs[0]['name']}"
    else: acl='unknown person(s)'
    sec_str=f"{legal} {', '.join(secs)}"
    vcl=''
    if vics: vcl=f" The victim {vics[0]['name']} (aged {vics[0]['age']}, {vics[0]['gender']}) sustained the impact of the offence."
    grp=' The offence appears to have been committed by a group.' if is_group else ''
    if ckey in MISSING:
        v=vics[0] if vics else {'name':'the subject','age':random.randint(8,70),'gender':'Male'}
        en=(f"On {inc:%d-%m-%Y}, complainant {comp_nm} reported that {v['name']} (aged {v['age']}, {v['gender']}) "
            f"has been missing since around {ttime} hrs from {place}, within {sinfo['name']} limits, {d} district. "
            f"A missing-person complaint has been registered vide FIR {firno} under {sec_str} and is currently '{status}'. "
            f"Search and investigation are led by {io_rank} {io_name}.")
    elif ckey in VICTIMLESS:
        en=(f"On {inc:%d-%m-%Y} at about {ttime} hrs, during patrolling/raid near {sinfo['name']} limits, {d} district, "
            f"the police booked {acl} who {crime_phrase(ckey,cname)} at {place}. "
            f"A suo-moto case has been registered vide FIR {firno} under {sec_str} and is currently '{status}'.{grp} "
            f"Investigation is led by {io_rank} {io_name}.")
    else:
        en=(f"On {inc:%d-%m-%Y} at about {ttime} hrs, complainant {comp_nm} reported that {acl} {crime_phrase(ckey,cname)} "
            f"at {place}, within {sinfo['name']} limits, {d} district. Motive: {motive.lower()}.{vcl}{grp} "
            f"A case has been registered vide FIR {firno} under {sec_str} and is currently '{status}'. "
            f"Investigation is led by {io_rank} {io_name}.")
    kn_crime=KN.get(ckey,cname); kn_status=KN_STATUS.get(status,status)
    kn=(f"{inc:%d-%m-%Y} ರಂದು ಸುಮಾರು {ttime} ಗಂಟೆಗೆ, ದೂರುದಾರ {comp_nm} ಅವರು {d} ಜಿಲ್ಲೆಯ {sinfo['name']} ವ್ಯಾಪ್ತಿಯಲ್ಲಿ "
        f"{kn_crime} ಪ್ರಕರಣ ನಡೆದಿದೆ ಎಂದು ದೂರು ನೀಡಿದ್ದಾರೆ. ಆರೋಪಿ(ಗಳು): {acl}. "
        f"ಎಫ್‌ಐಆರ್ {firno}, ಕಲಂ {sec_str} ಅಡಿಯಲ್ಲಿ ಪ್ರಕರಣ ದಾಖಲಾಗಿದ್ದು, ಪ್ರಸ್ತುತ ಸ್ಥಿತಿ: {kn_status}. "
        f"ತನಿಖಾಧಿಕಾರಿ: {io_rank} {io_name}.")
    nid+=1; nw.writerow([nid,cid,'en',en])
    nid+=1; nw.writerow([nid,cid,'kn',kn])
    cw.writerow([cid,firno,yr,sid_sel,sinfo['name'],d,sinfo['rng'],cname,cat,legal,'|'.join(secs),fir_type,status,mode,motive,inc,ttime,rep,lat,lon,place,io_id,io_name,vc,ac,is_group,arrested,cs,convicted])
    if cid%20000==0: print('...',cid)

for f in (fc,fp,fcp,fn): f.close()
# stations + officers
with open(f'{OUT}/stations.csv','w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=['station_id','station_name','district','range','latitude','longitude']); w.writeheader(); w.writerows(stations_out)
with open(f'{OUT}/officers.csv','w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=['officer_id','name','rank','station_id']); w.writeheader(); w.writerows(officers)
print('GENERATED cases',N,'persons',pid,'narratives',nid)
