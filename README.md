# Padma Hostel Finance

Padma Hostel Financial Record App: offline fees, dues, receipts, expenses and reports for all branches.

This is version 3 of **PADMA HOSTEL FINANCE**. It has the same screens, rules and PDF reports as the old desktop app (`PADMA_HOSTEL_FINANCE.exe`), but it is now an **installable web app**:

- **Windows Smart App Control can't block it.** It isn't an `.exe`; it runs inside Microsoft Edge or Google Chrome.
- **It works with no internet** once installed.
- **It updates itself** whenever a new version is uploaded here.
- **Your records never go to GitHub.** They stay on the hostel computer, plus the backup folder you choose.

App address: **https://padma-hostel-finance.vercel.app/**  (hosted free on Vercel, which publishes this GitHub repository automatically)

---

## 1. Install on the hostel PC (one time)

1. Open **Microsoft Edge** or **Google Chrome** and go to the app address above.
2. Click the **Install** icon at the right end of the address bar (a small monitor with a down-arrow, or **⋯ → Apps → Install this site as an app**).
3. The app gets its own **desktop / Start-menu icon** and opens in its own window. From now on, open it from that icon.
4. **First time only:** choose a **username and password** for the app.
   *Write them down somewhere safe.* They are kept only on this computer.

## 2. Bring in the data from the old app (one time)

1. In the new app go to **Settings → Backup file → ⬆ Restore from backup…**
2. Pick the old app's data file. It is in one of these places:
   - `Documents\PADMA HOSTEL FINANCE\Backup\padma-data.json` (written each time you pressed Save in the old app)
   - `C:\Users\<your name>\AppData\Roaming\PADMA HOSTEL FINANCE\padma-data-v3.json` (the old app's live data. Type `%APPDATA%\PADMA HOSTEL FINANCE` in the File Explorer address bar to find it.)
3. The app shows how many students, fees and entries it found. Press **Replace & restore**.

## 3. Connect Google Drive (one time, needs internet)

1. In the app: **Settings → Google Drive → ☁ Connect Google Drive**.
2. Sign in with your Google account and allow access. The app can only see files and folders it creates, or that you pick for it.
3. In Google's folder picker, choose **My Drive → Padma Hostel Finance** and click **Select**.
4. Press **💾 Save**. The data backup and all PDF reports are uploaded into that folder, in the same month-folder layout. Later Saves upload only what changed. While you're signed in, the data backup is also uploaded automatically about 20 seconds after each change.

If the PC is offline, Save keeps everything on the computer and tells you to press Save again when you're online. Google may ask you to sign in again about once an hour; that's one click on Save.

## 3b. (Optional) Also save into a folder on this PC

You only need this if you want a copy in a normal folder too (for example a USB drive, or Google Drive for desktop).
1. In the app: **Settings → 📂 Choose save folder**. Pick (or create) a folder. Click **Allow** / **Edit files** when the browser asks.
2. Press **💾 Save** (or **Ctrl+S**). The app writes everything there, exactly like the old app:

```
PADMA HOSTEL FINANCE\
  Backup\padma-data.json                        ← all data (also refreshed automatically after every change)
  Padma Boys Hostel\2083\08 Mangsir\
      Monthly Fee\  Income Record\  Expenditure Record\
      Admission Forms\  Profit or Loss and Revenue Record\
  Padma Girls Hostel\...
```

After the browser restarts it may ask once more for permission the next time you press Save; click **Allow**.

**Extra safety:** the **⬇ Backup file** button (top right) downloads one file with all data, for a USB stick or email.

## 4. Daily use

Everything works like the old app: Dashboard, Rooms, Admissions, Students, Monthly Fee, Income, Expenditure, Settings, the Boys/Girls switch, and the 💾 Save button.
- Data is saved on the computer **the moment you type it**.
- **💾 Save** makes/updates the PDF reports and the backup in your Google Drive folder.
- The **admission form PDF** opens in a new tab, where you can print it or save it.

## 5. Publishing an update (on your laptop)

1. Change the files in this repository (or upload the new files you were given), using **Add file → Upload files** and then **Commit changes**.
2. In `sw.js`, raise the number in `const VERSION = '3.0.0';`, for example to `'3.0.1'`. **The app only notices updates when this number changes.**
3. Within about a minute Vercel publishes it automatically. The next time the hostel PC is online, the app shows **"A new version of the app is ready → Update now"**. Updating never touches the records.

## Important

- **Don't clear Edge/Chrome "site data / cookies" for this site.** That would erase the records on that computer. If it ever happens, restore the latest `Backup\padma-data.json` from Google Drive (step 2).
- **Keep the address the same.** Don't rename the Vercel project or move the app to another address; the PC would need a fresh install and a restore.
- The app login protects against casual use. It is not a safe; anyone with full access to the Windows account could still reach the browser data.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `tailwind.css`, `js/app.js` | The screens (the same as the old app) |
| `js/core.js` | Business rules, data format and PDF report layouts from the old app |
| `js/padma-web.js` | Storage on the computer, login, PDF making, saving to the folder and to Google Drive |
| `js/bs-data.js` | Nepali calendar (B.S.) month lengths, 2000–2090 |
| `sw.js`, `js/pwa.js`, `manifest.webmanifest` | Offline support, install and automatic updates |
| `vendor/` | html2canvas and jsPDF (MIT licence), used to make the PDF files |

## Google Drive keys in the code

`js/padma-web.js` contains a Google **client ID** and a browser **API key**. These are meant to be public. The client ID only works from `https://padma-hostel-finance.vercel.app`, and the API key only allows the folder picker from that same address. Neither can open anyone's Drive without that person signing in. **Never put a client secret or refresh token in this repository.**
