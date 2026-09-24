// WebRTC mesh for webcam + mic sharing. Uses the "perfect negotiation" pattern so
// either side can add media at any time. Signaling goes through the game socket.

export class MediaManager {
  constructor(socket, opts = {}) {
    const { onRemoteVideo, onRemoteGone, onLevel, onLocalStream } = opts;
    this.socket = socket;
    this.myPid = null;
    this.peers = new Map(); // pid -> { pc, polite, makingOffer, ignoreOffer, stream, video, analyser }
    this.local = null;
    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.onRemoteVideo = onRemoteVideo;
    this.onRemoteGone = onRemoteGone;
    this.onLevel = onLevel;
    this.onLocalStream = onLocalStream;
    this.camOn = false;
    this.micOn = false;
    this.audioCtx = null;
    this.videoHost = document.createElement('div');
    this.videoHost.className = 'video-host';
    document.body.appendChild(this.videoHost);
    fetch(opts.iceUrl || '/api/ice').then((r) => r.json()).then((j) => { if (j.iceServers) this.iceServers = j.iceServers; }).catch(() => {});

    socket.on('rtc', ({ from, data }) => this.onSignal(from, data));
    socket.on('peerLeft', ({ pid }) => this.closePeer(pid));
    this.levelTimer = setInterval(() => this.pollLevels(), 120);
  }

  setMyPid(pid) { this.myPid = pid; }

  ctx() {
    if (!this.audioCtx) {
      try { this.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ignore */ }
    }
    if (this.audioCtx?.state === 'suspended') this.audioCtx.resume().catch(() => {});
    return this.audioCtx;
  }

  // Keep a connection with every other connected member.
  syncMembers(members) {
    const want = new Set(members.filter((m) => m.connected && m.pid !== this.myPid).map((m) => m.pid));
    for (const pid of want) if (!this.peers.has(pid)) this.createPeer(pid);
    for (const pid of [...this.peers.keys()]) if (!want.has(pid)) this.closePeer(pid);
  }

  createPeer(pid) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { pid, pc, polite: this.myPid < pid, makingOffer: false, ignoreOffer: false, stream: null, video: null, analyser: null };
    this.peers.set(pid, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.send(pid, { description: pc.localDescription });
      } catch (e) { console.warn('negotiation', e); } finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) this.send(pid, { candidate }); };
    pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') pc.restartIce?.(); };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      if (!peer.video) {
        const v = document.createElement('video');
        v.autoplay = true; v.playsInline = true;
        v.dataset.pid = pid;
        this.videoHost.appendChild(v);
        peer.video = v;
      }
      if (peer.video.srcObject !== stream) peer.video.srcObject = stream;
      peer.stream = stream;
      peer.video.play().catch(() => { /* autoplay blocked until user gesture */ });
      if (track.kind === 'audio') this.attachAnalyser(peer, stream);
      this.onRemoteVideo?.(pid, peer.video, stream);
      track.onunmute = () => this.onRemoteVideo?.(pid, peer.video, stream);
    };

    if (this.local) for (const t of this.local.getTracks()) pc.addTrack(t, this.local);
    return peer;
  }

  send(to, data) { this.socket.emit('rtc', { to, data }); }

  async onSignal(from, data) {
    let peer = this.peers.get(from) || this.createPeer(from);
    const pc = peer.pc;
    try {
      if (data.description) {
        const offerCollision = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await pc.setLocalDescription();
          this.send(from, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!peer.ignoreOffer) console.warn(e); }
      }
    } catch (e) { console.warn('signal error', e); }
  }

  closePeer(pid) {
    const peer = this.peers.get(pid);
    if (!peer) return;
    try { peer.pc.close(); } catch { /* ignore */ }
    if (peer.video) { peer.video.srcObject = null; peer.video.remove(); }
    this.peers.delete(pid);
    this.onRemoteGone?.(pid);
  }

  attachAnalyser(target, stream) {
    const ctx = this.ctx();
    if (!ctx || !stream.getAudioTracks().length) return;
    try {
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      target.analyser = an;
      target.levelBuf = new Uint8Array(an.fftSize);
    } catch (e) { console.warn('analyser', e); }
  }

  pollLevels() {
    const measure = (t) => {
      if (!t.analyser) return 0;
      t.analyser.getByteTimeDomainData(t.levelBuf);
      let sum = 0;
      for (const v of t.levelBuf) { const x = (v - 128) / 128; sum += x * x; }
      return Math.min(1, Math.sqrt(sum / t.levelBuf.length) * 6);
    };
    for (const p of this.peers.values()) this.onLevel?.(p.pid, measure(p));
    if (this.localMeter) this.onLevel?.(this.myPid, this.micOn ? measure(this.localMeter) : 0);
  }

  // Start camera and/or mic. Returns {cam, mic} actually obtained.
  async start({ video = true, audio = true } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera/mic need HTTPS (or localhost). Open the game over an https:// link.');
    let stream = null;
    const tries = [
      { video: video ? { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' } : false, audio: audio ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false },
      { video: false, audio: true },
      { video: true, audio: false },
    ];
    let lastErr;
    for (const c of tries) {
      if (!c.video && !c.audio) continue;
      try { stream = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { lastErr = e; }
    }
    if (!stream) throw lastErr || new Error('No camera or microphone available');

    if (this.local) this.stop(false);
    this.local = stream;
    this.camOn = stream.getVideoTracks().length > 0;
    this.micOn = stream.getAudioTracks().length > 0;
    this.localMeter = {};
    this.attachAnalyser(this.localMeter, stream);
    for (const peer of this.peers.values()) {
      for (const t of stream.getTracks()) peer.pc.addTrack(t, stream);
    }
    this.onLocalStream?.(stream);
    this.announce();
    return { cam: this.camOn, mic: this.micOn };
  }

  stop(announce = true) {
    if (!this.local) return;
    for (const peer of this.peers.values()) {
      for (const sender of peer.pc.getSenders()) {
        if (sender.track && this.local.getTracks().includes(sender.track)) {
          try { peer.pc.removeTrack(sender); } catch { /* ignore */ }
        }
      }
    }
    this.local.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.localMeter = null;
    this.camOn = this.micOn = false;
    this.onLocalStream?.(null);
    if (announce) this.announce();
  }

  toggleMic() {
    const t = this.local?.getAudioTracks()[0];
    if (!t) return false;
    t.enabled = !t.enabled;
    this.micOn = t.enabled;
    this.announce();
    return this.micOn;
  }

  toggleCam() {
    const t = this.local?.getVideoTracks()[0];
    if (!t) return false;
    t.enabled = !t.enabled;
    this.camOn = t.enabled;
    this.announce();
    return this.camOn;
  }

  announce() { this.socket.emit('media', { cam: this.camOn, mic: this.micOn }); }

  // Resume playback after a user gesture (browsers block unmuted autoplay).
  unlockPlayback() {
    this.ctx();
    for (const p of this.peers.values()) p.video?.play().catch(() => {});
  }

  videoMap() {
    const m = new Map();
    for (const p of this.peers.values()) if (p.video) m.set(p.pid, p.video);
    return m;
  }

  closeAll() { for (const pid of [...this.peers.keys()]) this.closePeer(pid); this.stop(false); }
}
