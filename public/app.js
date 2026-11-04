const socket = io();
const $ = (id) => document.getElementById(id);
const state = {
  roomId: null, roomName: null, alias: null, moderator: false,
  moderatorKey: null, passcode: null, inviteUrl: null, members: [],
  blocked: new Set(), pendingCreated: false
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
  const action = window.prompt(`Participant: ${member.alias}\nType "report" to report, "block" to hide their messages${state.moderator && !member.isModerator ? ', or "remove" to remove them' : ""}.`);
  if (!action) return;
  if (action.toLowerCase() === "block") {
    state.blocked.add(member.alias); showStatus("chatStatus", `${member.alias}'s messages are now hidden.`, false);
  } else if (action.toLowerCase() === "report") {
    $("reportTarget").value = member.id; $("reportDialog").showModal();
  } else if (action.toLowerCase() === "remove" && state.moderator && !member.isModerator) {
    socket.emit("moderation:kick", { targetId: member.id }, result => showStatus("chatStatus", result.ok ? "Participant removed." : result.error, !result.ok));
  }
}
function leaveRoom() {
  socket.disconnect(); socket.connect();
  state.roomId = null; state.alias = null; state.moderator = false; state.moderatorKey = null; state.passcode = null;
  state.members = []; state.blocked.clear();
  history.replaceState({}, "", "/"); showHome();
}
async function copyValue(value, statusId = "chatStatus") {
  try { await navigator.clipboard.writeText(value); showStatus(statusId, "Copied to clipboard.", false); }
  catch { showStatus(statusId, "Copy unavailable. Select and copy the text manually."); }
}

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
if (invitedRoom) { $("roomId").value = invitedRoom; $("joinPass").focus(); }