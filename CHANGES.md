# Cash Desk changes

## 0.1.0 — Phase 1: Skeleton
- App shell (Electron + sql.js), Block design from BOH (Dark and Light), Archivo / Inter / Geist Mono bundled.
- First run creates the admin login. Sign in with username and password or PIN.
- Wrong password: generic message, global counter; the 5th wrong try locks for 1 minute, doubling up to 15 minutes. The lock also blocks the correct password and survives a restart.
- Auto-lock after 10 minutes idle, when Windows locks or sleeps, or with Ctrl+L. Unlock needs the password.
- Database is encrypted on disk (AES-256-GCM, key wrapped by the Windows account). A damaged or unprotected file is never overwritten.
- Gateway menu with Tally-style keys (arrows, letter jump, Enter, Esc to sign out). Menu items are placeholders until their phase.
- Portable .exe build config and GitHub Actions workflow.
