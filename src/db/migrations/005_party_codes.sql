-- Free service payment: the code in the monthly file (Service_parent) and the real party name it stands for.
CREATE TABLE party_codes (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
