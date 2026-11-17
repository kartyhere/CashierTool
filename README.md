# Cash Desk

Portable Windows cashier app (Electron + sql.js). Separate from BOH: own database, own login.

- `npm start` run from source (needs Windows account storage; for tests on other systems see `CASHDESK_TEST_KEYSTORE`).
- `npm test` run the tests.
- `npm run dist:win` build the portable .exe (also built by GitHub Actions on push).
- Data lives in `%APPDATA%\Cash Desk` (encrypted). Do not copy it to another PC: the key belongs to the Windows account.
