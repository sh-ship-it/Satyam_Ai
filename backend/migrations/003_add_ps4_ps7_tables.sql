-- ============================================================================
-- Satyam — Migration 003: Add PS4 socio-economic + PS7 financial tables
-- Safe to run on any database that already has 002_schema_v2 applied.
-- Idempotent: uses CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Run order: after 002_schema_v2.sql and after the core dataset is loaded.
-- ============================================================================

-- ===================== PS4 — SOCIO-ECONOMIC INDICATORS =====================
-- Aggregate district-level planning data ONLY.
-- MUST NOT be used for individual offender risk scoring.

CREATE TABLE IF NOT EXISTS district_socio_economic_indicators (
    district              TEXT PRIMARY KEY,
    population            INTEGER,
    literacy_rate         DOUBLE PRECISION,
    urbanization_percent  DOUBLE PRECISION,
    income_index          DOUBLE PRECISION,
    unemployment_proxy    DOUBLE PRECISION
);

CREATE INDEX IF NOT EXISTS idx_socio_district
    ON district_socio_economic_indicators (district);

GRANT SELECT ON district_socio_economic_indicators TO satyam_app;

-- ===================== PS7 — FINANCIAL ACCOUNTS ============================

CREATE TABLE IF NOT EXISTS financial_accounts (
    account_id      BIGINT PRIMARY KEY,
    person_id       INTEGER NOT NULL REFERENCES persons(person_id) ON DELETE CASCADE,
    account_type    TEXT NOT NULL,
    bank_name       TEXT NOT NULL,
    district        TEXT,
    opened_date     DATE,
    kyc_risk_level  TEXT CHECK (kyc_risk_level IN ('Low','Medium','High'))
);

CREATE INDEX IF NOT EXISTS idx_fin_acc_person   ON financial_accounts (person_id);
CREATE INDEX IF NOT EXISTS idx_fin_acc_district ON financial_accounts (district);

GRANT SELECT ON financial_accounts TO satyam_app;

-- ===================== PS7 — FINANCIAL TRANSACTIONS ========================
-- Pattern flags are investigative leads, NOT proof of guilt.

CREATE TABLE IF NOT EXISTS financial_transactions (
    transaction_id     BIGINT PRIMARY KEY,
    from_account_id    BIGINT NOT NULL REFERENCES financial_accounts(account_id) ON DELETE CASCADE,
    to_account_id      BIGINT NOT NULL REFERENCES financial_accounts(account_id) ON DELETE CASCADE,
    amount             NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    transaction_time   TIMESTAMPTZ NOT NULL,
    channel            TEXT NOT NULL,
    case_id            INTEGER REFERENCES cases(case_id) ON DELETE SET NULL,
    pattern_flag       TEXT,
    is_suspicious      BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_fin_txn_from  ON financial_transactions (from_account_id);
CREATE INDEX IF NOT EXISTS idx_fin_txn_to    ON financial_transactions (to_account_id);
CREATE INDEX IF NOT EXISTS idx_fin_txn_case  ON financial_transactions (case_id);
CREATE INDEX IF NOT EXISTS idx_fin_txn_time  ON financial_transactions (transaction_time);
CREATE INDEX IF NOT EXISTS idx_fin_txn_flag  ON financial_transactions (pattern_flag);

GRANT SELECT ON financial_transactions TO satyam_app;
