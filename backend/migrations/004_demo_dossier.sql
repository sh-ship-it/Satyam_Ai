-- Demo-only dossier tables. FULLY ISOLATED from the synthetic dataset.
-- No FKs to persons/cases. No RLS. Only read via the admin dossier endpoint.
-- Safe to drop & reseed without affecting any production/synthetic table.

CREATE TABLE IF NOT EXISTS demo_dossier_persons (
    demo_id          SERIAL PRIMARY KEY,
    slug             TEXT UNIQUE NOT NULL,
    full_name        TEXT NOT NULL,
    aliases          TEXT[]  DEFAULT '{}',
    gender           TEXT,
    dob              DATE,
    age              INT,
    height_cm        INT,
    build            TEXT,
    complexion       TEXT,
    identifying_marks TEXT,
    blood_group      TEXT,
    nationality      TEXT DEFAULT 'Indian',
    risk_level       TEXT,
    wanted_status    TEXT,
    primary_phone    TEXT,
    secondary_phone  TEXT,
    email            TEXT,
    home_address     TEXT,
    district         TEXT,
    pincode          TEXT,
    photo_front      TEXT,
    photo_left       TEXT,
    photo_right      TEXT,
    summary          TEXT,
    created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS demo_dossier_family (
    id          SERIAL PRIMARY KEY,
    demo_id     INT NOT NULL REFERENCES demo_dossier_persons(demo_id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    relation    TEXT NOT NULL,
    age         INT,
    phone       TEXT,
    occupation  TEXT,
    address     TEXT,
    notes       TEXT
);

CREATE TABLE IF NOT EXISTS demo_dossier_bank_accounts (
    id            SERIAL PRIMARY KEY,
    demo_id       INT NOT NULL REFERENCES demo_dossier_persons(demo_id) ON DELETE CASCADE,
    bank_name     TEXT NOT NULL,
    account_no    TEXT NOT NULL,
    ifsc          TEXT,
    branch        TEXT,
    account_type  TEXT,
    balance_inr   NUMERIC(14,2),
    status        TEXT DEFAULT 'Active',
    opened_on     DATE,
    flagged       BOOLEAN DEFAULT false,
    flag_reason   TEXT
);

CREATE TABLE IF NOT EXISTS demo_dossier_crimes (
    id            SERIAL PRIMARY KEY,
    demo_id       INT NOT NULL REFERENCES demo_dossier_persons(demo_id) ON DELETE CASCADE,
    case_ref      TEXT NOT NULL,
    crime_type    TEXT NOT NULL,
    sections      TEXT,
    role          TEXT,
    status        TEXT,
    occurred_on   DATE,
    station       TEXT,
    district      TEXT,
    sentence      TEXT,
    narrative     TEXT
);

CREATE TABLE IF NOT EXISTS demo_dossier_contacts (
    id            SERIAL PRIMARY KEY,
    demo_id       INT NOT NULL REFERENCES demo_dossier_persons(demo_id) ON DELETE CASCADE,
    label         TEXT,
    name          TEXT,
    relation      TEXT,
    phone         TEXT,
    notes         TEXT
);

CREATE INDEX IF NOT EXISTS ix_demo_family_pid   ON demo_dossier_family(demo_id);
CREATE INDEX IF NOT EXISTS ix_demo_bank_pid     ON demo_dossier_bank_accounts(demo_id);
CREATE INDEX IF NOT EXISTS ix_demo_crimes_pid   ON demo_dossier_crimes(demo_id);
CREATE INDEX IF NOT EXISTS ix_demo_contacts_pid ON demo_dossier_contacts(demo_id);
