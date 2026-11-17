-- Cash Desk baseline schema (migration 1).
-- All amounts are INTEGER rupees. Dates are YYYY-MM-DD text in local time; times are ISO text.
-- The drawer count and each person's balance are always added up from entries, never stored as totals.
-- Later schema changes go in new migration files (see migrations.js), never in this file.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','cashier')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE denominations (
  id TEXT PRIMARY KEY,
  value INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note','coin')),
  sort INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE departments (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE branches (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE expense_types (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);

CREATE TABLE bank_accounts (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  opening_balance INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id),
  opening_balance INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('opening','voucher','cash_in','bank_deposit','exchange','settle','count_adjust')),
  source TEXT CHECK (source IN ('customer','branch','department','bank_withdrawal','other')),
  person_id INTEGER REFERENCES people(id),
  branch_id INTEGER,
  department_id INTEGER,
  bank_account_id INTEGER,
  party_name TEXT,                              -- customer name, optional
  voucher_amount INTEGER,                       -- voucher: approved total; settle: 0
  cash_delta INTEGER NOT NULL,                  -- signed sum of pieces x value (+ in, - out)
  balance_delta INTEGER NOT NULL DEFAULT 0,     -- change to the person's balance
  bank_delta INTEGER NOT NULL DEFAULT 0,        -- change to the bank account's balance
  reference TEXT,
  remark TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE entry_pieces (
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  denom_id TEXT NOT NULL REFERENCES denominations(id),
  qty INTEGER NOT NULL,                         -- signed: + into the drawer, - out
  PRIMARY KEY (entry_id, denom_id)
);

CREATE TABLE voucher_lines (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  expense_type_id INTEGER NOT NULL REFERENCES expense_types(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  note TEXT,
  sort INTEGER NOT NULL
);

CREATE TABLE day_closes (
  day TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('closed','reopened')),
  counted_json TEXT NOT NULL,
  expected_json TEXT NOT NULL,
  tally_balance INTEGER,
  remark TEXT,
  closed_by INTEGER,
  closed_at TEXT,
  morning_checked_by INTEGER,
  morning_checked_at TEXT
);

CREATE TABLE day_reopens (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  at TEXT NOT NULL,
  reason TEXT NOT NULL
);

CREATE TABLE tally_checks (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  at TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  system_balance INTEGER NOT NULL,
  tally_balance INTEGER NOT NULL,
  counted_json TEXT,
  remark TEXT
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  table_name TEXT,
  row_id INTEGER,
  before_json TEXT,
  after_json TEXT
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE INDEX idx_entries_day ON entries(day);
CREATE INDEX idx_entries_person ON entries(person_id);
CREATE INDEX idx_entry_pieces_entry ON entry_pieces(entry_id);
CREATE INDEX idx_voucher_lines_entry ON voucher_lines(entry_id);
CREATE INDEX idx_audit_log_at ON audit_log(at);

-- Seed: the 11 denominations, largest first.
INSERT INTO denominations (id, value, kind, sort) VALUES
  ('N500', 500, 'note', 1), ('N200', 200, 'note', 2), ('N100', 100, 'note', 3),
  ('N50', 50, 'note', 4), ('N20', 20, 'note', 5), ('N10', 10, 'note', 6),
  ('C20', 20, 'coin', 7), ('C10', 10, 'coin', 8), ('C5', 5, 'coin', 9),
  ('C2', 2, 'coin', 10), ('C1', 1, 'coin', 11);

-- Seed: default settings (the "Decisions locked" table in the Builder spec). All are changed in Settings later.
INSERT INTO settings (key, value) VALUES
  ('theme', 'dark'),
  ('idle_lock_minutes', '10'),
  ('rounding_step', '10'),
  ('balance_limit', '10'),
  ('max_entry_amount', '1000000'),
  ('deposit_limit', '500000'),
  ('deposit_float', '5000'),
  ('deposit_banner_from', '12:00'),
  ('morning_check_time', '09:15'),
  ('morning_repeat_minutes', '30'),
  ('backup_keep', '30');
