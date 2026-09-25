// Exposes a small, safe API to the game page as `window.hrDesktop`.
// The web version never has this object, so all desktop features are optional.
const { contextBridge, ipcRenderer } = require('electron');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};

contextBridge.exposeInMainWorld('hrDesktop', {
  isDesktop: true,
  localServer: arg('hr-local'),
  steamInfo: () => ipcRenderer.invoke('hr:steam-info'),
  hostTable: (code, listed) => ipcRenderer.invoke('hr:host-table', { code, listed }),
  updateTable: (info) => ipcRenderer.invoke('hr:update-table', info),
  listTables: () => ipcRenderer.invoke('hr:list-tables'),
  joinLobby: (lobbyId) => ipcRenderer.invoke('hr:join-lobby', lobbyId),
  banPeer: (steamId) => ipcRenderer.invoke('hr:ban-peer', steamId),
  relayPort: () => ipcRenderer.invoke('hr:relay-port'),
  findTable: (code) => ipcRenderer.invoke('hr:find-table', code),
  invite: () => ipcRenderer.invoke('hr:invite'),
  friends: () => ipcRenderer.invoke('hr:friends'),
  inviteInfo: () => ipcRenderer.invoke('hr:invite-info'),
  inviteFriend: (id) => ipcRenderer.invoke('hr:invite-friend', id),
  leaveTable: () => ipcRenderer.invoke('hr:leave-table'),
  unlockAchievement: (name) => ipcRenderer.invoke('hr:achievement', name),
  openOverlay: (dialog) => ipcRenderer.invoke('hr:overlay', dialog),
  toggleFullscreen: (on) => ipcRenderer.invoke('hr:fullscreen', on),
  quit: () => ipcRenderer.invoke('hr:quit'),
  openLog: () => ipcRenderer.invoke('hr:open-log'),
  showKeyboard: (rect) => ipcRenderer.invoke('hr:keyboard', rect),
  onJoinTable: (cb) => ipcRenderer.on('hr:join-table', (_e, target) => cb(target)),
  onHostLost: (cb) => ipcRenderer.on('hr:host-lost', () => cb()),
  onRefused: (cb) => ipcRenderer.on('hr:refused', () => cb()),
  onNotice: (cb) => ipcRenderer.on('hr:notice', (_e, msg) => cb(msg)),
});
