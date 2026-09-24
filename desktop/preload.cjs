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
  hostTable: (code) => ipcRenderer.invoke('hr:host-table', { code }),
  findTable: (code) => ipcRenderer.invoke('hr:find-table', code),
  invite: () => ipcRenderer.invoke('hr:invite'),
  friends: () => ipcRenderer.invoke('hr:friends'),
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
  onNotice: (cb) => ipcRenderer.on('hr:notice', (_e, msg) => cb(msg)),
});
