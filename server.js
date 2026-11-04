const express = require("express");
const http = require("http");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Server } = require("socket.io");
const crypto = require("crypto");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 16 * 1024 });
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.socket.io"],
      styleSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: "8kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

const createLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const joinLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const rooms = new Map();
const ROOM_TTL = 6 * 60 * 60 * 1000;
const MAX_PEOPLE = 8;
const MAX_MESSAGE = 500;
const recentReports = new Map();

const adjectives = ["Quiet", "Sunny", "Clever", "Gentle", "Bright", "Cosmic", "Misty", "Curious", "Swift", "Kind"];
const nouns = ["Panda", "Comet", "Otter", "Robin", "Maple", "Orchid", "Fox", "Pixel", "Koala", "Cedar"];

function randomAlias() {
  return `${adjectives[crypto.randomInt(adjectives.length)]}${nouns[crypto.randomInt(nouns.length)]}${crypto.randomInt(10, 99)}`;
}
function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}
function hashSecret(secret, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(secret, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifySecret(secret, stored) {
  if (!stored || typeof secret !== "string") return false;
  const [salt, expected] = stored.split(":");
  const actual = crypto.scryptSync(secret, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}
function cleanText(value, max) {
  return String(value || "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
}
function roomSummary(room) {
  return { id: room.id, name: room.name, count: room.members.size, max: MAX_PEOPLE, expiresAt: room.expiresAt };
}
function safeReason(value) {
  const allowed = ["bullying", "personal information", "inappropriate content", "spam", "other"];
  return allowed.includes(value) ? value : "other";
}
function containsContactInfo(message) {
  const email = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
  const phone = /(?:\+?\d[\d\s().-]{7,}\d)/;
  const url = /\b(?:https?:\/\/|www\.)\S+/i;
  return email.test(message) || phone.test(message) || url.test(message);
}
function destroyRoom(id) {
  const room = rooms.get(id);
  if (!room) return;
  for (const socketId of room.members.keys()) {
    const memberSocket = io.sockets.sockets.get(socketId);
    if (memberSocket) {
      memberSocket.emit("room:closed", { message: "This room has closed or expired." });
      memberSocket.leave(id);
      memberSocket.disconnect(true);
    }
  }
  rooms.delete(id);
  recentReports.delete(id);
}
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.expiresAt <= now || room.members.size === 0) destroyRoom(id);
  }
}, 60_000).unref();

app.post("/api/rooms", createLimiter, (req, res) => {
  const name = cleanText(req.body?.name, 32);
  const passcode = String(req.body?.passcode || "");
  if (!name) return res.status(400).json({ error: "Enter a room name." });
  if (passcode.length < 8 || passcode.length > 64) {
    return res.status(400).json({ error: "Use a room passcode between 8 and 64 characters." });
  }
  if (rooms.size >= 100) return res.status(503).json({ error: "Rooms are temporarily full. Try again later." });

  const id = randomToken(6);
  const moderatorKey = randomToken(24);
  rooms.set(id, {
    id, name, passHash: hashSecret(passcode), moderatorHash: hashSecret(moderatorKey),
    members: new Map(), expiresAt: Date.now() + ROOM_TTL, createdAt: Date.now()
  });
  res.status(201).json({ id, moderatorKey, inviteUrl: `${req.protocol}://${req.get("host")}/?room=${id}` });
});

app.post("/api/rooms/:id/check", joinLimiter, (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room || room.expiresAt <= Date.now()) return res.status(404).json({ error: "Room not found or expired." });
  const passcode = String(req.body?.passcode || "");
  if (!verifySecret(passcode, room.passHash)) return res.status(403).json({ error: "That passcode isn't correct." });
  if (room.members.size >= MAX_PEOPLE) return res.status(409).json({ error: "This room is full." });
  res.json({ ok: true, room: roomSummary(room) });
});

io.on("connection", socket => {
  let joinedRoom = null;
  let alias = null;
  let isModerator = false;
  let lastMessageAt = 0;
  let messageCount = 0;
  let countWindow = Date.now();

  socket.on("room:join", (data = {}, ack = () => {}) => {
    if (joinedRoom) return ack({ ok: false, error: "You are already in a room." });
    const id = cleanText(data.roomId, 32);
    const passcode = String(data.passcode || "");
    const room = rooms.get(id);
    if (!room || room.expiresAt <= Date.now()) return ack({ ok: false, error: "Room not found or expired." });
    if (room.members.size >= MAX_PEOPLE) return ack({ ok: false, error: "This room is full." });
    if (!verifySecret(passcode, room.passHash)) return ack({ ok: false, error: "Incorrect room passcode." });

    alias = randomAlias();
    const moderatorKey = String(data.moderatorKey || "");
    isModerator = moderatorKey ? verifySecret(moderatorKey, room.moderatorHash) : false;
    joinedRoom = id;
    room.members.set(socket.id, { alias, isModerator });
    socket.join(id);
    ack({ ok: true, alias, isModerator, room: roomSummary(room) });
    io.to(id).emit("room:members", [...room.members.entries()].map(([socketId, member]) => ({
      id: socketId, alias: member.alias, isModerator: member.isModerator
    })));
    socket.to(id).emit("chat:notice", { text: `${alias} joined the room.` });
  });

  socket.on("chat:message", (data = {}, ack = () => {}) => {
    if (!joinedRoom) return ack({ ok: false, error: "Join a room first." });
    const room = rooms.get(joinedRoom);
    if (!room) return ack({ ok: false, error: "Room is no longer available." });
    const now = Date.now();
    if (now - lastMessageAt < 900) return ack({ ok: false, error: "Please slow down." });
    if (now - countWindow > 60_000) { countWindow = now; messageCount = 0; }
    if (++messageCount > 25) return ack({ ok: false, error: "Message limit reached. Please wait a minute." });
    const text = cleanText(data.text, MAX_MESSAGE);
    if (!text) return ack({ ok: false, error: "Write a message first." });
    if (containsContactInfo(text)) return ack({ ok: false, error: "For privacy, don't share phone numbers, email addresses, links or contact details." });
    lastMessageAt = now;
    io.to(joinedRoom).emit("chat:message", { id: randomToken(8), alias, text, at: now });
    ack({ ok: true });
  });

  socket.on("chat:report", (data = {}, ack = () => {}) => {
    if (!joinedRoom) return ack({ ok: false, error: "Join a room first." });
    const room = rooms.get(joinedRoom);
    if (!room) return ack({ ok: false, error: "Room not found." });
    const targetId = cleanText(data.targetId, 80);
    if (!room.members.has(targetId) || targetId === socket.id) return ack({ ok: false, error: "Choose another participant." });
    const reason = safeReason(data.reason);
    const reports = recentReports.get(joinedRoom) || [];
    reports.push({ targetId, reason, reporter: alias, at: Date.now() });
    recentReports.set(joinedRoom, reports.slice(-100));
    const moderatorIds = [...room.members.entries()].filter(([, m]) => m.isModerator).map(([sid]) => sid);
    moderatorIds.forEach(sid => io.to(sid).emit("moderation:report", { targetAlias: room.members.get(targetId)?.alias || "Participant", reason }));
    ack({ ok: true, message: "Report sent to the room moderator, if present." });
  });

  socket.on("moderation:kick", (data = {}, ack = () => {}) => {
    if (!joinedRoom || !isModerator) return ack({ ok: false, error: "Only the room moderator can do that." });
    const room = rooms.get(joinedRoom);
    const targetId = cleanText(data.targetId, 80);
    const target = room?.members.get(targetId);
    if (!target || target.isModerator || targetId === socket.id) return ack({ ok: false, error: "That participant can't be removed." });
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.emit("room:removed", { message: "The room moderator removed you." });
      targetSocket.disconnect(true);
    }
    ack({ ok: true });
  });

  socket.on("moderation:close", (ack = () => {}) => {
    if (!joinedRoom || !isModerator) return ack({ ok: false, error: "Only the room moderator can close this room." });
    const id = joinedRoom;
    ack({ ok: true });
    destroyRoom(id);
  });

  socket.on("disconnect", () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    room.members.delete(socket.id);
    io.to(joinedRoom).emit("room:members", [...room.members.entries()].map(([socketId, member]) => ({
      id: socketId, alias: member.alias, isModerator: member.isModerator
    })));
    if (room.members.size) io.to(joinedRoom).emit("chat:notice", { text: `${alias || "A participant"} left the room.` });
    else destroyRoom(joinedRoom);
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

server.listen(PORT, () => console.log(`QuietRoom listening on ${PORT}`));