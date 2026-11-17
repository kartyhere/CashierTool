-- Several vouchers from one person in one entry: the individual amounts, and which voucher each expense line belongs to.
-- Who may change the expense split of a saved voucher (admins always may).
ALTER TABLE entries ADD COLUMN parts_json TEXT;
ALTER TABLE voucher_lines ADD COLUMN voucher_no INTEGER;
ALTER TABLE users ADD COLUMN can_edit INTEGER NOT NULL DEFAULT 1;
