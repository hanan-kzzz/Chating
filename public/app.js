const socket = io();
const $ = (id) => document.getElementById(id);
const state = {
  roomId: null, roomName: null, alias: null, moderator: false,
  moderatorKey: null, passcode: null, inviteUrl: null, members: [],
  blocked: new Set(), pendingCreated: false, activeCallId: null, callMode: null, callScope: null, localStream: null, peerConnections: new Map(), incomingCall: null
};

function showStatus(id, message, isError = true) {
  const el = $(id); el.textContent = message; el.style.color = isError ? "#c05d67" : "#4a9a78";
}
function showHome() { $("homeView").classList.remove("hidden"); $("roomView").classList.add("hidden"); }
function showRoom() { $("homeView").classList.add("hidden"); $("roomView").classList.remove("hidden"); }
function getRoomIdFromUrl() { return new URLSearchParams(location.search).get("room"); }

async function createRoom(event) {
  event.preventDefault();
  showStatus("homeStatus", "Creating your private room…", false);
  const name = $("roomName").value.trim();
  const passcode = $("createPass").value;
  try {
    const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, passcode }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create room.");
    state.roomId = data.id; state.roomName = name; state.moderatorKey = data.moderatorKey;
    state.passcode = passcode; state.inviteUrl = data.inviteUrl; state.pendingCreated = true;
    $("inviteLink").value = data.inviteUrl; $("invitePasscode").value = passcode;
    $("inviteDialog").showModal();
    showStatus("homeStatus", "");
  } catch (error) { showStatus("homeStatus", error.message); }
}

async function joinRoom(roomId, passcode, moderatorKey = null) {
  if (!roomId || !passcode) throw new Error("Enter a room code and passcode.");
  const check = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/check`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passcode })
  });
  const checkData = await check.json();
  if (!check.ok) throw new Error(checkData.error || "Unable to join this room.");
  return new Promise((resolve, reject) => {
    socket.emit("room:join", { roomId, passcode, moderatorKey }, result => {
      if (!result?.ok) return reject(new Error(result?.error || "Unable to join room."));
      state.roomId = roomId; state.roomName = result.room.name; state.alias = result.alias;
      state.moderator = result.isModerator; state.passcode = passcode;
      $("activeRoomName").textContent = state.roomName;
      $("closeRoomButton").classList.toggle("hidden", !state.moderator);
      $("roomExpiry").textContent = "Temporary room";
      $("messages").replaceChildren();
      addNotice(`You joined as ${state.alias}.`);
      showRoom(); renderMembers(result.room);
      history.replaceState({}, "", `/?room=${encodeURIComponent(roomId)}`);
      $("messageInput").focus();
      resolve(result);
    });
  });
}

function addNotice(text) {
  const node = document.createElement("div"); node.className = "notice"; node.textContent = text;
  $("messages").appendChild(node); scrollMessages();
}
function scrollMessages() { $("messages").scrollTop = $("messages").scrollHeight; }
function addMessage(message) {
  if (state.blocked.has(message.alias)) return;
  const wrapper = document.createElement("article");
  wrapper.className = "message" + (message.alias === state.alias ? " mine" : "");
  const meta = document.createElement("div"); meta.className = "message-meta";
  meta.textContent = `${message.alias} · ${new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  const bubble = document.createElement("div"); bubble.className = "bubble"; bubble.textContent = message.text;
  wrapper.append(meta, bubble); $("messages").appendChild(wrapper); scrollMessages();
}
function renderMembers() {
  const list = $("peopleList"); list.replaceChildren();
  const members = state.members;
  $("peopleCount").textContent = `${members.length}/8`;
  members.forEach(member => {
    const row = document.createElement("div"); row.className = "person";
    const avatar = document.createElement("span"); avatar.className = "avatar"; avatar.textContent = member.alias.slice(0, 1);
    const name = document.createElement("span"); name.className = "person-name"; name.textContent = member.alias;
    row.append(avatar, name);
    if (member.id === socket.id) { const you = document.createElement("span"); you.className = "you-tag"; you.textContent = "YOU"; row.append(you); }
    else {
      const report = document.createElement("button"); report.className = "person-menu"; report.textContent = "···"; report.title = "Participant options";
      report.addEventListener("click", () => openParticipantMenu(member));
      row.append(report);
    }
    list.append(row);
  });
}
function openParticipantMenu(member) {
  const action = window.prompt(`Participant: ${member.alias}\nType "report", "block", "voice", or "video"${state.moderator && !member.isModerator ? ', or "remove" to remove them' : ""}.`);
  if (!action) return;
  if (action.toLowerCase() === "block") {
    state.blocked.add(member.alias); showStatus("chatStatus", `${member.alias}'s messages are now hidden.`, false);
  } else if (action.toLowerCase() === "report") {
    $("reportTarget").value = member.id; $("reportDialog").showModal();
  } else if (action.toLowerCase() === "voice" || action.toLowerCase() === "video") { startCall(action.toLowerCase() === "video" ? "video" : "audio", "direct", member.id);
  } else if (action.toLowerCase() === "remove" && state.moderator && !member.isModerator) {
    socket.emit("moderation:kick", { targetId: member.id }, result => showStatus("chatStatus", result.ok ? "Participant removed." : result.error, !result.ok));
  }
}

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
function callStatus(message) { $("callStatus").textContent = message || ""; }
async function startCall(mode, scope, targetId) {
  if (state.activeCallId) return callStatus("You are already in a call.");
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: mode === "video" });
    const result = await new Promise(resolve => socket.emit("call:start", { mode, scope, targetId }, resolve));
    if (!result || !result.ok) throw new Error(result?.error || "Unable to start call.");
    state.activeCallId = result.callId; state.callMode = mode; state.callScope = scope;
    $("callStage").classList.remove("hidden"); $("localVideo").classList.toggle("hidden", mode !== "video");
    $("localVideo").srcObject = mode === "video" ? state.localStream : null;
    callStatus(scope === "group" ? "Group call started. Waiting for participants…" : "Calling participant…");
  } catch (e) { state.localStream?.getTracks().forEach(t => t.stop()); state.localStream = null; callStatus(e.message || "Microphone/camera permission is needed."); }
}
function makePeer(peerId) {
  if (state.peerConnections.has(peerId)) return state.peerConnections.get(peerId);
  const pc = new RTCPeerConnection(rtcConfig);
  state.localStream?.getTracks().forEach(track => pc.addTrack(track, state.localStream));
  pc.onicecandidate = e => { if (e.candidate) socket.emit("call:signal", { callId: state.activeCallId, targetId: peerId, signal: { type: "ice", candidate: e.candidate } }); };
  pc.ontrack = e => {
    let video = document.getElementById("remote-" + peerId);
    if (!video) {
      const tile = document.createElement("div"); tile.className = "remote-tile";
      video = document.createElement("video"); video.id = "remote-" + peerId; video.autoplay = true; video.playsInline = true; video.className = "remote-video";
      const label = document.createElement("span"); label.className = "remote-label"; label.textContent = state.members.find(m => m.id === peerId)?.alias || "Room member";
      tile.append(video, label); $("remoteVideos").append(tile);
    }
    video.srcObject = e.streams[0];
  };
  pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) removePeer(peerId); };
  state.peerConnections.set(peerId, pc); return pc;
}
async function createOffer(peerId) {
  const pc = makePeer(peerId); const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  socket.emit("call:signal", { callId: state.activeCallId, targetId: peerId, signal: { type: "offer", sdp: pc.localDescription } });
}
async function receiveSignal(data) {
  try {
    const pc = makePeer(data.fromId); const signal = data.signal;
    if (signal.type === "offer") { await pc.setRemoteDescription(signal.sdp); const answer = await pc.createAnswer(); await pc.setLocalDescription(answer); socket.emit("call:signal", { callId: state.activeCallId, targetId: data.fromId, signal: { type: "answer", sdp: pc.localDescription } }); }
    else if (signal.type === "answer") await pc.setRemoteDescription(signal.sdp);
    else if (signal.type === "ice" && signal.candidate) await pc.addIceCandidate(signal.candidate);
  } catch (_) { callStatus("Connection failed. Please try again."); }
}
function removePeer(id) { const pc = state.peerConnections.get(id); if (pc) pc.close(); state.peerConnections.delete(id); document.getElementById("remote-" + id)?.closest(".remote-tile")?.remove(); }
function cleanupCall(notify) {
  if (notify && state.activeCallId) socket.emit("call:leave", { callId: state.activeCallId });
  state.peerConnections.forEach(pc => pc.close()); state.peerConnections.clear();
  state.localStream?.getTracks().forEach(t => t.stop()); state.localStream = null; state.activeCallId = null; state.callMode = null; state.callScope = null;
  $("localVideo").srcObject = null; $("localVideo").classList.add("hidden"); $("remoteVideos").replaceChildren(); $("callStage").classList.add("hidden");
  $("muteCallButton").textContent = "Mute mic"; $("cameraCallButton").textContent = "Camera off"; callStatus("");
}
$("groupVoiceButton").addEventListener("click", () => startCall("audio", "group"));
$("groupVideoButton").addEventListener("click", () => startCall("video", "group"));
$("leaveCallButton").addEventListener("click", () => cleanupCall(true));
$("muteCallButton").addEventListener("click", () => { const t = state.localStream?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; $("muteCallButton").textContent = t.enabled ? "Mute mic" : "Unmute mic"; } });
$("cameraCallButton").addEventListener("click", () => { const t = state.localStream?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; $("cameraCallButton").textContent = t.enabled ? "Camera off" : "Camera on"; } });
socket.on("call:incoming", invite => {
  if (state.activeCallId) { socket.emit("call:decline", { callId: invite.callId }); return; }
  state.incomingCall = invite; $("incomingCallTitle").textContent = invite.mode === "video" ? "Incoming video call" : "Incoming voice call";
  $("incomingCallDescription").textContent = invite.callerAlias + " invited you to a " + invite.scope + " call in " + invite.roomName + ".";
  $("incomingCallDialog").showModal();
});
$("declineCallButton").addEventListener("click", () => { if (state.incomingCall) socket.emit("call:decline", { callId: state.incomingCall.callId }); state.incomingCall = null; $("incomingCallDialog").close(); });
$("acceptCallButton").addEventListener("click", async () => {
  const invite = state.incomingCall; if (!invite) return;
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: invite.mode === "video" });
    const result = await new Promise(resolve => socket.emit("call:accept", { callId: invite.callId }, resolve));
    if (!result || !result.ok) throw new Error(result?.error || "Call expired.");
    state.activeCallId = invite.callId; state.callMode = invite.mode; state.callScope = invite.scope;
    $("callStage").classList.remove("hidden"); $("localVideo").classList.toggle("hidden", invite.mode !== "video"); $("localVideo").srcObject = invite.mode === "video" ? state.localStream : null;
    $("incomingCallDialog").close(); state.incomingCall = null; callStatus("Joining call…");
    result.participantIds.filter(id => id !== socket.id).forEach(id => { if (socket.id < id) createOffer(id); else makePeer(id); });
  } catch (e) { state.localStream?.getTracks().forEach(t => t.stop()); state.localStream = null; $("incomingCallDialog").close(); callStatus(e.message); }
});
socket.on("call:participants", data => { if (data.callId === state.activeCallId) data.participantIds.filter(id => id !== socket.id).forEach(id => { if (!state.peerConnections.has(id)) { if (socket.id < id) createOffer(id); else makePeer(id); } }); });
socket.on("call:signal", data => { if (data.callId === state.activeCallId) receiveSignal(data); });
socket.on("call:declined", data => { if (data.callId === state.activeCallId) callStatus(data.alias + " declined the call."); });
socket.on("call:peer-left", data => { if (data.callId === state.activeCallId) removePeer(data.peerId); });
socket.on("call:ended", data => { if (data.callId === state.activeCallId) { cleanupCall(false); callStatus(data.reason || "Call ended."); } });

function leaveRoom() {
  cleanupCall(false);
  socket.disconnect(); socket.connect();
  state.roomId = null; state.alias = null; state.moderator = false; state.moderatorKey = null; state.passcode = null;
  state.members = []; state.blocked.clear();
  history.replaceState({}, "", "/"); showHome();
}
async function copyValue(value, statusId = "chatStatus") {
  try { await navigator.clipboard.writeText(value); showStatus(statusId, "Copied to clipboard.", false); }
  catch { showStatus(statusId, "Copy unavailable. Select and copy the text manually."); }
}

function showHomeChoice(choice) {
  $("homeActions").classList.add("hidden");
  $("createPanel").classList.toggle("hidden", choice !== "create");
  $("joinPanel").classList.toggle("hidden", choice !== "join");
  showStatus("homeStatus", "");
  if (choice === "create") $("roomName").focus();
  if (choice === "join") $("roomId").focus();
}
function showHomeChoices() {
  $("homeActions").classList.remove("hidden");
  $("createPanel").classList.add("hidden");
  $("joinPanel").classList.add("hidden");
  showStatus("homeStatus", "");
}
$("showCreateForm").addEventListener("click", () => showHomeChoice("create"));
$("showJoinForm").addEventListener("click", () => showHomeChoice("join"));
document.querySelectorAll("[data-back-home]").forEach(button => button.addEventListener("click", showHomeChoices));

$("createForm").addEventListener("submit", createRoom);
$("joinForm").addEventListener("submit", async event => {
  event.preventDefault();
  try { await joinRoom($("roomId").value.trim(), $("joinPass").value); showStatus("homeStatus", ""); }
  catch (error) { showStatus("homeStatus", error.message); }
});
$("enterCreatedRoom").addEventListener("click", async () => {
  $("inviteDialog").close();
  try { await joinRoom(state.roomId, state.passcode, state.moderatorKey); }
  catch (error) { showHome(); showStatus("homeStatus", error.message); }
});
$("copyLink").addEventListener("click", () => copyValue($("inviteLink").value, "homeStatus"));
$("copyPass").addEventListener("click", () => copyValue($("invitePasscode").value, "homeStatus"));
$("leaveButton").addEventListener("click", leaveRoom);
$("roomMenuButton").addEventListener("click", () => $("roomMenu").classList.toggle("hidden"));
$("copyInviteButton").addEventListener("click", () => copyValue(`${location.origin}/?room=${state.roomId}\nPasscode: ${state.passcode}`));
$("closeRoomButton").addEventListener("click", () => {
  if (confirm("Close this room for everyone? This cannot be undone.")) socket.emit("moderation:close", result => { if (!result.ok) showStatus("chatStatus", result.error); });
});
$("messageForm").addEventListener("submit", event => {
  event.preventDefault(); const text = $("messageInput").value.trim(); if (!text) return;
  socket.emit("chat:message", { text }, result => {
    if (!result?.ok) showStatus("chatStatus", result?.error || "Message not sent.");
    else { $("messageInput").value = ""; showStatus("chatStatus", "", false); }
  });
});
$("reportForm").addEventListener("submit", event => {
  event.preventDefault();
  socket.emit("chat:report", { targetId: $("reportTarget").value, reason: $("reportReason").value }, result => {
    $("reportDialog").close(); showStatus("chatStatus", result.ok ? result.message : result.error, !result.ok);
  });
});
document.querySelectorAll("[data-close-report]").forEach(button => button.addEventListener("click", () => $("reportDialog").close()));

socket.on("chat:message", addMessage);
socket.on("chat:notice", data => addNotice(data.text));
socket.on("room:members", members => { state.members = members; renderMembers(); });
socket.on("moderation:report", data => {
  if (state.moderator) showStatus("chatStatus", `Report received about ${data.targetAlias}: ${data.reason}.`, false);
});
socket.on("room:removed", data => { alert(data.message); leaveRoom(); });
socket.on("room:closed", data => { alert(data.message); leaveRoom(); });

const invitedRoom = getRoomIdFromUrl();
if (invitedRoom) { $("roomId").value = invitedRoom; showHomeChoice("join"); $("joinPass").focus(); }

// PWA installation. Chrome controls whether its native prompt is available.
let installPromptEvent = null;
const installButton = $("installAppButton");
const isIOSDevice = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

if (!isStandalone) installButton.classList.remove("hidden");

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPromptEvent = event;
  installButton.classList.remove("hidden");
  installButton.innerHTML = 'Install QuietRoom <span>↓</span>';
});

window.addEventListener("appinstalled", () => {
  installPromptEvent = null;
  installButton.classList.add("hidden");
  showStatus("homeStatus", "QuietRoom was added to your home screen.", false);
});

installButton.addEventListener("click", async () => {
  if (installPromptEvent) {
    installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    installPromptEvent = null;
    if (choice?.outcome === "accepted") installButton.classList.add("hidden");
    return;
  }
  if (isIOSDevice) {
    alert('To install QuietRoom on iPhone: tap Share in Safari, then choose "Add to Home Screen".');
  } else {
    alert('To install QuietRoom on Android: open the Chrome menu (⋮) and choose "Install app" or "Add to Home screen". If that option is missing, refresh the page and try again in Chrome.');
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => {
      console.warn("QuietRoom service worker registration failed:", error);
    });
  });
}
