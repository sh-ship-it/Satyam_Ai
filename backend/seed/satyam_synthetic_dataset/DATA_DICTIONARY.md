# Satyam — Synthetic Karnataka Police Crime Dataset

**100,000 synthetic FIR cases** modelled on real Karnataka State Police (KSP) data.
Fully synthetic — **zero real personal data**. Reproducible (fixed seed `20260615`).

## How it was built
Every distribution below is **grounded in the real source data** in `datasets.zip` (1,674,734 real KA FIRs in `FIR_Details_Data.csv`, plus NCRB/KSP crime-review tables, IPC↔BNS section mappings, and Indian name corpora). Each source file was reviewed individually and profiled; the extracted distributions drive the generator:

- **Districts** sampled ∝ real FIR volume per district (41 districts).
- **Crime type | district** sampled from the real district × crime-type matrix (21 core types) plus coverage supplements for ~25 additional crime/SLL types.
- **Sections**: IPC for offences reported before **2024-07-01**, BNS on/after (BNS came into force then). Real IPC↔BNS mapping; sections deleted in BNS (e.g. sedition, unnatural offences) are handled.
- **Stations**: 1,074 real KSP station names with coordinates; case geo-points jittered ±0.03°.
- **Officers**: synthetic KSP rank pyramid (PC/HC/ASI/PSI/PI/CPI/Dy.SP); IO drawn from investigating ranks.
- **Persons/roles, accused counts, group vs individual, heinous share, complaint mode, case status, conviction** all sampled from the real distributions.

## Tables (CSV, UTF-8)

### cases.csv (100,000 rows) — one row per FIR
| column | description |
|---|---|
| case_id | primary key |
| fir_number | FIR no. per station-year, e.g. `0142/2023` |
| fir_year | year of registration |
| station_id → stations.station_id | registering police station |
| station_name, district, range | location + KSP range |
| crime_type | normalized crime head (UPPER CASE, KSP convention) |
| crime_category | `IPC` (cognizable IPC/BNS) or `SLL` (Special & Local Laws) |
| legal_code | `IPC` or `BNS` (by report date) |
| sections | pipe-separated section numbers |
| fir_type | `Heinous` / `Non Heinous` |
| status | case stage (Pending Trial, Convicted, Undetected, Dis/Acq, …) |
| complaint_mode | Written / Sue-moto / Oral / … |
| motive | motive sub-head (grounded in real minor-heads) |
| incident_date, incident_time, report_date | dates (report ≥ incident) |
| latitude, longitude | jittered station coordinates |
| place_of_offence | scene descriptor |
| io_officer_id → officers.officer_id, io_name | investigating officer |
| victim_count, accused_count | counts |
| is_group | 1 if accused_count > 1 (group crime) else 0 |
| arrested_count, charge_sheeted, convicted | outcome flags |

### persons.csv (~410k rows)
`person_id, name, gender (Male/Female/Boy/Girl), age, district`. Synthetic Indian names; victim demographics matched to crime type (women-targeted → female; POCSO → minors).

### case_persons.csv (~410k rows)
`case_id, person_id, role` — role ∈ {Complainant, Victim, Accused, Witness}. The **who-did-what-to-whom** link table.

### narratives.csv (200,000 rows) — bilingual
`narrative_id, case_id, language (en|kn), body`. One English + one **Kannada (ಕನ್ನಡ)** FIR-style narrative per case, grounded in that case's crime type, motive, persons, place and sections — ideal for RAG / embedding / fine-tuning.

### stations.csv (1,074 rows)
`station_id, station_name, district, range, latitude, longitude`.

### officers.csv (~6,900 rows)
`officer_id, name, rank, station_id`.

## Coverage (all verified PASS)
All crime types (46) · group **and** individual · victimless/suo-moto (drugs, gambling, excise) · crimes against women · crimes against children (POCSO) · both IPC **and** BNS regimes · all 4 person roles · bilingual EN+KN narratives · geo-coordinates · IO attribution · FIR numbers + dates.

## Verification vs real data (`verify_dataset.py`)
| metric | synthetic | real |
|---|---|---|
| group-share | 32.5% | 30.9% |
| conviction | 20.4% | 19.2% |
| heinous | 11.1% | 11.4% |
| accused=0 / 1 / 2 | 24.7 / 42.8 / 11.2% | 24.8 / 44.3 / 10.7% |
| complaint Written | 66.5% | 66.4% |
| status Pending Trial | 29.7% | 29.9% |

Regenerate: `python3 generate_dataset.py 100000` · Verify: `python3 verify_dataset.py`

---

## PS4 Extension — district_socio_economic_indicators.csv (41 rows)

District-level synthetic planning indicators. Used **only** for aggregate dashboards and correlation analysis (PS4 Socio-Economic Dashboard, social risk index, correlation scatter charts).

| column | type | description |
|---|---|---|
| district | TEXT (PK) | KSP district name (matches districts in `cases.csv`) |
| population | INTEGER | Synthetic district population estimate |
| literacy_rate | DOUBLE PRECISION | Adult literacy rate (%) |
| urbanization_percent | DOUBLE PRECISION | Urban population share (%) |
| income_index | DOUBLE PRECISION | Relative per-capita income index (0–1) |
| unemployment_proxy | DOUBLE PRECISION | Unemployment proxy rate (0–1) |

> ⚠️ **IMPORTANT:** These fields are aggregate planning data only. They are **never** used for individual offender risk scoring. Using demographic or socio-economic attributes in individual risk scores is an ethics and fairness violation.

---

## PS7 Extension — financial_accounts.csv (~178,517 rows)

Synthetic financial accounts linked to persons in `persons.csv`. Used for PS7 financial crime / money-trail analysis.

| column | type | description |
|---|---|---|
| account_id | BIGINT (PK) | Unique account identifier |
| person_id | INTEGER (FK → persons) | Account holder |
| account_type | TEXT | Bank Account / UPI Handle / Wallet / etc. |
| bank_name | TEXT | Synthetic Karnataka bank name |
| district | TEXT | Account registration district |
| opened_date | DATE | Account opening date |
| kyc_risk_level | TEXT | `Low` / `Medium` / `High` — synthetic KYC risk classification |

---

## PS7 Extension — financial_transactions.csv (~179,185 rows)

Synthetic transactions between financial accounts, optionally linked to criminal cases. Includes rule-based suspicious-pattern flags.

| column | type | description |
|---|---|---|
| transaction_id | BIGINT (PK) | Unique transaction identifier |
| from_account_id | BIGINT (FK → financial_accounts) | Sender account |
| to_account_id | BIGINT (FK → financial_accounts) | Receiver account |
| amount | NUMERIC(14,2) | Transaction amount (INR, ≥ 0) |
| transaction_time | TIMESTAMPTZ | ISO 8601 timestamp |
| channel | TEXT | Cash Deposit / UPI / NEFT / RTGS / Mobile Banking / etc. |
| case_id | INTEGER (FK → cases, nullable) | Linked FIR case when the transaction is tied to a case |
| pattern_flag | TEXT (nullable) | Rule-based suspicious pattern label (see below) |
| is_suspicious | BOOLEAN | `true` when a pattern flag is present |

### Suspicious pattern flags

| flag | meaning |
|---|---|
| `high_value` | Amount > 1 lakh INR |
| `near_incident_date` | Transaction within ±3 days of a linked case's incident date |
| `rapid_repeated` | Multiple transactions between the same account pair within 24 hours |
| `circular_flow` | Funds return to originating account within the same cluster |

> ⚠️ **IMPORTANT:** Pattern flags are **investigative leads only**, not proof of guilt. All data in these tables is fully synthetic. No real financial data was used.
