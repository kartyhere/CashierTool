# Cash Desk changes

## 0.15.0 — Service payment: invoice search that copies the UTR
- **Search at the top of the Service payment screen.** After the monthly file and the UTR file are loaded the cursor goes to the Invoice number box. Type any part of the GST lot number (slashes and spaces are ignored); the matching invoices are listed with party, account number, amount to pay and UTR.
- **Up / Down** choose a line. **Enter copies that invoice's UTR** to the clipboard and keeps the cursor in the box with the text selected, so the next invoice number replaces it. The toast shows what was copied.
- **Right arrow** (from the end of the box) moves to the "Copy UTR" button on the chosen line, Enter copies, **Left** goes back to the box. Up / Down on the button move to the next line.
- **Party name filter** is the box beside it (Tab). It can narrow the invoice search or be used alone. Enter in it goes back to the invoice box.
- If an account has a paid and a returned row, the paid UTR is copied. A returned payment, a missing UTR or an unreadable account says so in red and copies nothing.
- Esc clears the box; Esc on an empty box goes back. Alt+F jumps to the search box. P and U shortcuts do not fire while typing in a box; Alt+U loads the UTR file from anywhere.
- Only the UTR text is copied, and only for an invoice in the list; the screen never sends arbitrary text to the clipboard.

## 0.14.0 — Service payment: bank UTR file
- After the monthly report, press U (or the UTR file button) and choose the bank's UTR Excel file. The tool finds the header row and the columns (bank account number, UTR, Status, Amount, Name) by their headings.
- **Heads-up first:** if any row in the UTR file has a Return status, a red line says how many and the total, and a table "RETURNED payments in the UTR file" is listed first: party, name in the UTR file, account number, IFSC, bank, return amount, UTR, status, and whether the account is in this month's list.
- **UTR lookup by bank account:** each bank account in the report gets its UTR number(s), the amount the bank paid and a status: Paid, RETURNED (paid then returned), CHECK STATUS (anything not Paid or Return) or NO UTR. A UTR amount that is different from the amount to pay is flagged. If the bank file has an account number with a missing leading zero, it is still matched and says so.
- The summary also counts accounts with a UTR, without a UTR, and with a return. The Excel and PDF now carry all of it.
- Nothing is saved from the UTR file; it is read, matched, and used for this report only.

## 0.13.2 — Dealer remarks flagged
- Service payment reads the "Service DLR Remarks" column. Every row with a remark is listed under "Things to look at" with its account number and the dealer's words, the remark is shown on the bank account line (DEALER REMARK) and next to the invoice in the detail table and Excel. The tool never edits an account number: you read the remark and decide.

## 0.13.1 — Party codes file
- The party codes Excel is read by its headers "Selling_parent" (code) and "Real Name" (name), on the first sheet that has them.

## 0.13.0 — Service payment (free service payment tool)
- **New Gateway tile: Service payment (F).** Load the party codes Excel once (P), then each month choose the monthly Excel file (Enter). The report shows what to pay each bank account.
- Finds the header row by itself, so rearranged columns, title rows and hidden columns (Tax_Amt) are fine. Party name is looked up from Service_parent in your party codes list.
- Per invoice: Taxable = Lot amount − Tax amount; TDS = 2% of Taxable, always rounded UP to a whole rupee; To pay = Lot amount − TDS. The invoice number is the GST lot number. Status is not filtered.
- Grouped by bank account number only (one party can have many accounts). Account numbers are kept as text, leading zeros kept; IFSC and bank name come from the rows.
- Nothing is left behind: a row with no usable account number (or an account Excel has turned into 1.23E+11) is listed as NOT PAID, and a "Does it add up?" table reconciles every row of the file against the payment list.
- Checks flagged: missing tax, bad or missing IFSC, same account with different IFSC, duplicate GST lot number, party code not found, and differences from the file's own TDS / Payable columns.
- Alt+X saves Excel (two sheets: Pay by account, Invoices), Alt+P saves PDF.
- Database upgrades to version 5 (party codes table; new table only).

## 0.12.0 — Split each voucher, edit the day's entries, restore from a file
- **No limit on vouchers.** After each amount Enter adds the next box; Enter on an empty box, or typing 0, ends the list. The TOTAL (the amount to hand over) shows in large type from the first amount.
- **Split per voucher.** The expense step now shows one section per voucher ("Voucher 2 of 3 · ₹143"). Each voucher's lines must add up to that voucher on its own. The payout, notes and balance still work on the combined total. Lines are saved with their voucher number.
- **Split later (F8).** No time at the window? Press F8 on the split step to save the voucher without a split. A banner on the Gateway counts vouchers not split yet, and Entries marks them "NOT SPLIT YET".
- **Edit the split afterwards.** Entries: choose a voucher, press E, fix the lines and remark, Enter on the remark saves. Only on a day that is not closed. Money, notes and balances are never changed by an edit (to change those, delete the entry and enter it again). Every edit is written to the audit log.
- **Who may edit.** Admins always. For a cashier, Settings → Users → press E on the user to give or take away "May edit entries" (the default is yes).
- **Restore from a backup file.** Settings → Backup has a "Restore from a backup file (O)" button: pick any .cdbak file (USB stick, another PC) and type the backup password. On a brand new PC the first-run screen has the same button (F9), so you can restore before creating any login. After restoring, this PC makes backups with the same password straight away.
- The notes screen now explains Give and Back: Back is notes and coins the person hands back to you.
- Database upgrades to version 4 by itself (new columns only; old vouchers keep working, an old single voucher has its lines as voucher 1).
- Removed: the remark text "Vouchers 120 + 143". The amounts are now stored properly and shown in Entries.

## 0.11.0 — Several vouchers from one person
- Voucher screen: after the first amount, press Enter and a "Voucher 2" box appears below it. Fill it and press Enter for a third, and so on (up to 10). Press Enter on an empty box to carry on. Backspace on an empty box removes it.
- The vouchers are added into one total. You get one payout, one set of notes and one set of expense lines (they start from the total).
- The entry keeps the separate amounts in its remark, for example "Vouchers 120 + 143 · tea". The confirm box lists them too.
- One extra Enter for a single voucher: type the amount, Enter, Enter again on the empty box.
- Brought-by-receiver applies to the total.

## 0.10.0 — Easier navigation
- Gateway is now one vertical list. Up and Down move one line at a time (before, the two columns made the cursor jump sideways).
- Settings opens with the cursor on the tab bar, not in the first box. Left and Right change tab, Down or Enter go into the page, Alt+Up comes back to the tabs. After an action inside a tab (adding a user, backing up) the cursor stays in the page.
- The key-hint line at the bottom of every screen is bold.

## 0.9.0 — Cash brought by the receiver
- Voucher screen has a new box next to the amount: "Brought by receiver (₹)". Press Tab to reach it, Enter in either box carries on. Leave it empty for the usual flow.
- The third payout card is now "Custom": it pays voucher + brought, and the receiver hands the brought cash back. The person's balance does not change. Example: voucher ₹263, receiver brings ₹7, you give ₹270 and take ₹7 back.
- On the notes screen, the Back column is pre-filled with the brought cash (largest notes first). Change it if the receiver gave different notes or coins.
- The confirm box shows "Brought by receiver". Saved entries are unchanged in format: net paid is still given minus received.
- With the box empty, the third card is the exact voucher amount.

## 0.8.1 — Gateway selection is now easy to see
- The tile you are on (keyboard or mouse) now turns into a solid block like the buttons do. Before, its text went pale on a pale background and looked faded, especially in Light.

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
