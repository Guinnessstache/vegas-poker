# Desktop / Steam build

The desktop app is the same game wrapped in Electron, plus Steam features via
[steamworks.js](https://github.com/ceifa/steamworks.js):

- The UI is served from a private `127.0.0.1` port inside the app (works offline, no fonts/CDN calls).
- Tables are played on the **online server** in `desktop/config.json`, so Steam players and
  browser players can sit at the same table.
- With Steam running: your Steam name is used, a friends-only Steam lobby is created for your
  table, **Invite Steam friends** opens the overlay invite dialog, and accepting an invite
  (or "Join game" in the friends list) takes the friend straight to your table.
- Without Steam the app still runs normally (no invite button).

## Run it in development (Windows)

```powershell
npm install
npm run desktop
```

Keep the Steam client running. `desktop/config.json` uses App ID **480** (Valve's public
"Spacewar" test app), so Steam shows you as playing *Spacewar* — that's expected until you
have your own App ID. To test invites, both PCs need to be running the app.
(Steam's library will also list *Spacewar* as "Running" while the game is open — nothing
extra is launched; that's just how Steam labels a process using App ID 480.)

### Testing the Steam invite window (overlay)

Steam only injects its overlay into programs that **Steam itself launched**. `npm run desktop`
is launched by PowerShell, so the overlay (and the invite window) can't appear — the game
detects this and shows a help dialog instead. To test the real invite flow:

1. `npm run dist:win`
2. Steam → *Games* → *Add a Non-Steam Game to My Library…* → Browse →
   `dist\win-unpacked\HighRoller.exe`
3. Launch **HighRoller** from your Steam library, create a table, click **Invite Steam friends**
   (or press **Shift+Tab**).

Once the game is on Steam under its own App ID this is automatic — buyers always launch it
through Steam.

Keys: **F11** fullscreen, **Shift+Tab** Steam overlay, **Ctrl+Shift+I** dev tools.

## Build the Windows folder you upload to Steam

```powershell
npm run dist:win
```

Output: `dist\win-unpacked\HighRoller.exe` (+ runtime files). That whole folder is the depot.

## Going live checklist

1. Pay the Steam Direct fee, get your **App ID** and **Depot ID**.
2. Put the App ID in `desktop/config.json` (`steamAppId`) and in `steam/app_build.vdf`;
   put the Depot ID in both `.vdf` files.
3. Steamworks → Installation → General: launch option executable `HighRoller.exe`.
4. `npm run dist:win`, then upload with SteamPipe:
   `steamcmd +login <builder_account> +run_app_build <full path>\steam\app_build.vdf +quit`
5. Point `onlineServer` at an always-on server (the free Render tier sleeps when idle).
6. Achievements (next step) are defined in Steamworks → Stats & Achievements, then unlocked
   from the game with `hrDesktop.unlockAchievement('API_NAME')`.
