# Cash Desk changes

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
