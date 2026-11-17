-- A voucher saved outside the person balance limit (after a second Yes) is flagged, so it shows in the day's entries.
ALTER TABLE entries ADD COLUMN flag TEXT;
