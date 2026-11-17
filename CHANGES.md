# Cash Desk changes

## 0.8.0 — Phase 7: polish, roles check, README
- Checked every screen in Dark and Light, including Tally check, Day close, Reports, Settings and Backup. README now has screenshots made from dummy data (`scripts/demo-shots.cjs`).
- A cashier cannot open Settings, change users, restore a backup or reopen a day. This is enforced on the server and tested.
- README rewritten: what each screen does, key map, data and backups, build steps, and what is not built.

## 0.7.0 — Phase 6: settings, users, backups
- Settings (S, admin only) with tabs (Alt+Left / Alt+Right, or Alt+1 to 5): General, Lists, Users, Notes and coins, Backup.
- General: rounding step, balance limit, largest entry, cash kept after a deposit, deposit banner amount and time, morning check time and repeat, idle lock. Each change is checked and written to the audit log with before and after.
- Users: add users (admin or cashier), set a new password, switch on or off. The last active admin cannot be switched off, and you cannot change your own role.
- Notes and coins: hide a note or coin so it is never suggested (payouts, deposits). Pieces already in the drawer are still counted.
- Backup: set a backup password (P), choose a folder (F), back up now (B), restore (select a backup, Enter). A backup is made automatically after each day close and when you quit (skipped if nothing changed). The newest 30 are kept. Backups are sealed with the backup password, so they restore on any PC. A safety copy of the current data is made before every restore. The Gateway warns an admin until a backup password is set.
- A cashier cannot open Settings, users, backups or reopen a day (checked on the server, not only hidden).
- Bank deposit suggestions now respect hidden notes and coins.
- Fixed: Esc inside Lists returns to Settings.
- New packages: exceljs and jspdf are now inside the app (already used by 0.6.0).

## 0.6.0 — Phase 5: reports and exports
- Reports (R): nine reports for one day or a date range, shown on screen and exported as PDF (Alt+P) or Excel (Alt+X). Cash book, Denomination report (with Cashier and Manager signature lines on the PDF), Day entries, Voucher register, Payments by person, Expense summary, Receipts by source, Bank deposits, Person balances.
- Screen, PDF and Excel come from the same tables, so their totals always agree. Excel keeps numbers as numbers. PDF is A4 landscape with page numbers (amounts are written as plain rupees; the PDF font has no rupee sign).
- Files are named like CashDesk-CashBook-2026-11-16.pdf. The save box remembers the last folder.
- Payments by person can be filtered to one person, Bank deposits to one bank. Person balances can be shown as at any date.
- Fixed: the Phase 1 smoke test was out of date (the T key now opens Tally check).

## 0.5.0 — Phase 4: Tally check, morning check, day close
- Tally check (T or Ctrl+T from any screen, except in the middle of a voucher): enter Tally's cash balance, optionally count the drawer. Shows the difference (app − Tally) and keeps a list of today's checks.
- Morning check: from 09:15 a pop-up shows the last working day (opening, receipts, payments and deposits, closing) and asks for Tally's closing balance. Later or Esc asks again after 30 minutes.
- Day close (C): count each note and coin against the books, add Tally's balance and a remark, close. A difference needs a second confirmation and is recorded as an adjustment entry, so the drawer matches the count. A closed day takes no new entries. Alt+E fills the counts from the books.
- Admin can reopen a closed day (Alt+R, a reason is required and logged); the day's adjustment is cancelled.
- Close the earlier day first: new entries on a later day are refused while an earlier day is open. An admin can go on with a written reason, which is logged. The Gateway shows a warning.
- Fixed (affects 0.2.0 to 0.4.0): "Save anyway" prompts (bank below zero, voucher over the limit) never appeared in the real app because the window bridge dropped the error code. It now keeps it.

## 0.4.0 — Phase 3: bank deposit and exchange
- Bank deposit (F4 or D): choose the bank, the notes are suggested (₹500, ₹200, ₹100 only, largest first, never coins, the drawer keeps at least the ₹5,000 float) and can be changed. Reference number and remark are optional. Cash goes down, the bank balance goes up, and the day's Deposits figure moves.
- The Gateway shows a deposit banner when cash reaches ₹5,00,000 and it is past 12:00, with the suggested amount.
- Exchange (X): notes out and notes in, side by side. It can only be saved when both sides are equal and the drawer has what goes out. The drawer total does not change.
- Entries show deposits (with bank and reference) and exchanges. Both can be deleted unless the drawer would go below zero.

## 0.3.0 — Phase 2b: voucher, rounding, people balances, note breakup
- Voucher (F5 or V), all by keyboard: person, amount, payout, notes to give, expense lines, remark, confirmation.
  - Person search ignores case, spaces and dots ("k.ravi" finds "K Ravi") and also finds near spellings. Alt+C adds a new person on the spot.
  - Payout choices are rounded to ₹10 and carry the difference as the person's balance (+ you owe them, − they owe you). The balance is included in the next voucher. Left / Right choose, O types any other amount.
  - Notes to give are suggested from the notes actually in the drawer, using the fewest pieces and avoiding coins. A cycles other breakups. An optional "Back" column takes change back. The net must equal the payout.
  - Expense lines split the voucher amount (a type can repeat); a new type can be added from the list. One voucher is one cash book entry.
  - A balance outside ±₹10 needs a second Yes and is marked "over limit" in Entries.
- People (P): everyone with balance, department and history. S settles (pay what you owe, or collect what they owe), A adds, R renames, Space switches on / off. A new person can be given the balance they have today.
- Entries now show vouchers and settlements. Deleting one gives the notes and the balance back, and is blocked if the drawer would go below zero.
- Database upgrades to version 3 (over-limit flag). Existing data is kept (tested).

## 0.2.0 — Phase 2a: drawer, cash in, entries, lists
- Gateway now shows the drawer by note and coin, today's opening, receipts, payments, deposits and closing, and the bank balances.
- Opening count (key O on the Gateway until it is entered): count all 11 notes and coins once. A mistake is fixed by deleting it in Entries and entering it again.
- Cash in (F6 or I): source customer, branch, department, bank withdrawal or other. Branches and departments can be added on the spot with "+ New…". The amount always comes from the notes and coins counted. A bank withdrawal lowers that bank's balance and asks before taking it below zero. A confirmation is shown before saving.
- Entries (E): everything on a day with the day's figures; Left / Right change the day, Delete removes an entry. Deleting only marks it deleted and is blocked if the drawer would go below zero. Both are written to the audit log.
- Settings (S): add, rename and switch off departments, branches, expense types and bank accounts. Starter expense types and two banks are included.
- Entries cannot go on a closed day, or when the PC date is earlier than the last entry.
- Database upgrades itself to version 2 (starter lists). Existing data is kept.

## 0.1.0 — Phase 1: Skeleton
- App shell (Electron + sql.js), Block design from BOH (Dark and Light), Archivo / Inter / Geist Mono bundled.
- First run creates the admin login. Sign in with username and password or PIN.
- Wrong password: generic message, global counter; the 5th wrong try locks for 1 minute, doubling up to 15 minutes. The lock also blocks the correct password and survives a restart.
- Auto-lock after 10 minutes idle, when Windows locks or sleeps, or with Ctrl+L. Unlock needs the password.
- Database is encrypted on disk (AES-256-GCM, key wrapped by the Windows account). A damaged or unprotected file is never overwritten.
- Gateway menu with Tally-style keys (arrows, letter jump, Enter, Esc to sign out). Menu items are placeholders until their phase.
- Portable .exe build config and GitHub Actions workflow.
