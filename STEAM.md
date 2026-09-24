# Desktop / Steam build

The desktop app is the same game wrapped in Electron, plus Steam features via
[steamworks.js](https://github.com/ceifa/steamworks.js):

- **No central server.** Every table runs inside the game of the player who created it
  (the same server code as the browser version, on a private `127.0.0.1` port).
- Friends reach the host **through Steam**: the host's table gets a Steam lobby holding the
  table code and the host's Steam ID, and game traffic is tunneled over Steam peer-to-peer
  (`desktop/tunnel.mjs`), relayed through Valve's network when a direct path isn't possible.
  No port forwarding, no IP addresses exchanged, nothing for the developer to run or pay for.
- Joining: **Invite Steam friends** (in-game friends list → invite arrives in Steam chat →
  Accept), or the friend types the **table code** under *Join table* (found via Steam lobby
  search), or *Join Game* from the Steam friends list.
- When the host quits, the table ends and guests are returned to their lobby.
- Without Steam the app still runs; tables are just local to that PC.
- Webcam/mic connect directly between players (WebRTC, using Google's public STUN servers).
- The browser version (GitHub Pages + the Render server) is separate and unaffected.

## Run it in development (Windows)

```powershell
npm install
npm run desktop
```

Keep the Steam client running. `desktop/config.json` uses App ID **480** (Valve's public
"Spacewar" test app), so Steam shows you as playing *Spacewar* — that's expected until you
have your own App ID. To test with a friend, both PCs need to be running the app, signed in
to different Steam accounts.
(Steam's library will also list *Spacewar* as "Running" while the game is open — nothing
extra is launched; that's just how Steam labels a process using App ID 480.)

### Testing two copies on one PC (no Steam needed)

`tools/fake-steam.mjs` is a pretend Steam network for development (not shipped):

```powershell
node tools/fake-steam.mjs 4700
# in two more terminals:
$env:HR_FAKE_STEAM="4700:111:Alice"; $env:HR_USER_DATA="$env:TEMP\hr-a"; npm run desktop
$env:HR_FAKE_STEAM="4700:222:Bob";   $env:HR_USER_DATA="$env:TEMP\hr-b"; npm run desktop
```

Alice creates a table; Bob joins with the code or gets invited from Alice's friends list.

Keys: **F11** fullscreen, **Ctrl+Shift+I** dev tools.

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
5. Achievements: enter the 20 in `steam/ACHIEVEMENTS.md` (names, descriptions, icons in
   `steam/achievements/`) under Steamworks → Stats & Achievements, then Publish.
