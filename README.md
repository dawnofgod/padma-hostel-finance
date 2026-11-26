# Padma Hostel Finance

Offline finance app for Padma Hostel, Lalitpur: rooms, admissions, students, monthly fees, income, expenditure, profit/loss and PDF reports, with Bikram Sambat dates. It installs from the browser (no Play Store, no .exe, no Smart App Control problem) and updates itself.

* **Live app (real data):** branch `main`, on `https://padma-hostel-finance.vercel.app`
* **Test copy:** branch `test`, on `https://padma-hostel-finance-test.vercel.app`. It uses separate test data and the Drive folder "Padma Hostel Finance – TEST".
* **Admin panel:** `/admin.html` on either address. It opens with the admin username + password.

## Logins

* **Admin panel** (`/admin.html`): on the very first visit you create the admin username and password. Only one admin login can exist. You can change it later under ⚙ Settings. 10 wrong passwords lock the login for 15 minutes.
* **Staff**: in the admin panel press **＋ Add person** and choose their name, username and password. They log in with it in the app. The first login on a computer needs internet. After that the same login also works offline. Each person has their own profile and their own backup folder ("<name> (<username>)").
* **Google Drive**: press **Connect Google Drive** in the admin panel once. Every person's backups then go into **Padma Hostel Finance** (or "… – TEST" on the test copy) in that Drive. Until then, data stays on each computer.

## Admin panel

* Each person appears as a card showing:
  * online/offline status
  * when they were last active
  * students and records
  * Drive storage used
  * last backup
  * app version
  * a link to their Drive folder
* **View records** is read-only. It opens their students, monthly fees, income, expenditure, admissions and rooms from the copy the app sends to the server (within about 2 minutes, also without Google Drive).
* **New password** sets a new password and logs the person out everywhere. **Rename** changes their name. **Freeze** locks the app on their computers. **Remove** deletes the login. Their local data and Drive files are kept.

## Publishing updates

1. Change the files and bump `VERSION` in `sw.js` (and `APP_VERSION` in `js/padma-web.js`).
2. Push to the **`test`** branch. The test copy updates, so check it there.
3. When it works, merge `test` into **`main`**. Real users see "Update now".

## Server settings (Vercel → Settings → Environment Variables)

| Name | Where | What |
|---|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Production and Preview | Google OAuth web client, used only for "Connect Google Drive". Redirect URIs: `https://<address>/api/callback` for the live and test addresses |
| `GEMINI_API_KEY` | all | form scanner |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | all | Upstash Redis (added by connecting the database) |
| `APP_ENV` = `test` | **Preview only** | makes the test copy use separate data (`padma-test:` keys, Drive "Padma Hostel Finance – TEST") |

Never put keys or secrets in the code; this repository is public.

`js/core.js` is generated from `tools/core-src/*.js` with `python3 tools/build-core.py`.
