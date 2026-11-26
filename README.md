# Padma Hostel Finance

Offline finance app for Padma Hostel, Lalitpur: rooms, admissions, students, monthly fees, income, expenditure, profit/loss and PDF reports, with Bikram Sambat dates. It installs from the browser (no Play Store, no .exe, no Smart App Control problem) and updates itself.

* **Live app (real data):** branch `main`, on `https://padma-hostel-finance.vercel.app`
* **Test copy:** branch `test`, on `https://padma-hostel-finance-test.vercel.app`. It uses separate test data and the Drive folder "Padma Hostel Finance – TEST".
* **Admin panel:** `/admin.html` on either address. Only the admin Gmail can open it.

## How people start

Sign in with Google → profile name → username + password for this computer → app.

Every person who signs in gets their own profile and their own backup folder ("<profile name> (<gmail>)") inside **Padma Hostel Finance** in the admin's Google Drive. Records stay on the computer, so the app works offline. The sign-in screen tells users that the admin can view their records.

## Admin panel

* Each user appears as a profile card with their Google picture, showing:
  * online/offline status
  * when they were last active
  * students and records
  * Drive storage used
  * last backup
  * app version
  * a link to their Drive folder
* **View records** is read-only. It opens their students, monthly fees, income, expenditure, admissions and rooms from their latest backup.
* **Freeze** locks the app on their computers. **Remove** deletes the account, and the app goes back to "Sign in with Google". Their local data and Drive files are kept.

## Publishing updates

1. Change the files and bump `VERSION` in `sw.js` (and `APP_VERSION` in `js/padma-web.js`).
2. Push to the **`test`** branch. The test copy updates, so check it there.
3. When it works, merge `test` into **`main`**. Real users see "Update now".

## Server settings (Vercel → Settings → Environment Variables)

| Name | Where | What |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | all | Google OAuth web client. Redirect URIs: `https://<address>/api/callback` for the live and test addresses |
| `GEMINI_API_KEY` | all | form scanner |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | all | Upstash Redis (added by connecting the database) |
| `APP_ENV` = `test` | **Preview only** | makes the test copy use separate data (`padma-test:` keys, Drive "Padma Hostel Finance – TEST") |
| `ADMIN_EMAIL` | optional | the admin Gmail (default arunpoudel9957@gmail.com) |

Never put keys or secrets in the code; this repository is public.

`js/core.js` is generated from `tools/core-src/*.js` with `python3 tools/build-core.py`.
