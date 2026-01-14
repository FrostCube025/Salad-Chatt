import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  writeBatch,
  serverTimestamp,
  query,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDrZ-maG46ecU5Fgidqyrws1DdNoEfqeFI",
  authDomain: "salad-chatt.firebaseapp.com",
  projectId: "salad-chatt",
  storageBucket: "salad-chatt.firebasestorage.app",
  messagingSenderId: "841208847669",
  appId: "1:841208847669:web:568e254429166d05c2c07c",
  measurementId: "G-FFF48MW8EL"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const el = (id) => document.getElementById(id);

const nickEl = el("nick");
const codeEl = el("code");
const hintEl = el("hint");
const statusEl = el("status");

const roomCodeEl = el("roomCode");
const youIdEl = el("youId");
const msgsEl = el("messages");

const msgEl = el("msg");
const sendBtn = el("sendBtn");
const joinBtn = el("joinBtn");
const hostBtn = el("hostBtn");
const copyBtn = el("copyBtn");
const leaveBtn = el("leaveBtn");

function setHint(t) { hintEl.textContent = t || ""; }
function setStatus(t) { statusEl.textContent = t || ""; }

function genCode6() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function safeNick() {
  const n = (nickEl.value || "").trim();
  return n.length ? n.slice(0, 20) : "Anonymous";
}
function fmtTime(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

// stable user id for "my messages"
function getOrCreateUserId() {
  const key = "saladchatt_uid_v1";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.getRandomValues(new Uint32Array(2)).join("").slice(0, 10);
    localStorage.setItem(key, id);
  }
  return id;
}
const myUserId = getOrCreateUserId();
youIdEl.textContent = myUserId;

function enableChatUI(enabled) {
  msgEl.disabled = !enabled;
  sendBtn.disabled = !enabled;
  leaveBtn.disabled = !enabled;
  copyBtn.disabled = !enabled;

  joinBtn.disabled = enabled;
  hostBtn.disabled = enabled;
  codeEl.disabled = enabled;
}

function clearMessagesUI() { msgsEl.innerHTML = ""; }
function isNearBottom(container) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < 140;
}
function scrollToBottom(container) { container.scrollTop = container.scrollHeight; }

let currentRoomCode = null;
let unsubMsgs = null;
let unsubPresence = null;
let heartbeatTimer = null;

// reactions
const REACTIONS = ["👍", "😂", "❤️", "🔥"];

// -------- Presence + cleanup (best-effort) --------
function presenceDoc(roomId, userId) {
  return doc(db, "rooms", roomId, "presence", userId);
}
function presenceColl(roomId) {
  return collection(db, "rooms", roomId, "presence");
}

function stopPresence() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function onUnloadCleanup() {
  try {
    if (currentRoomCode) {
      await deleteDoc(presenceDoc(currentRoomCode, myUserId));
    }
  } catch {}
}

async function startPresence(roomId) {
  await setDoc(presenceDoc(roomId, myUserId), {
    userId: myUserId,
    nick: safeNick(),
    lastSeen: serverTimestamp()
  }, { merge: true });

  stopPresence();
  heartbeatTimer = setInterval(async () => {
    if (!currentRoomCode) return;
    try {
      await updateDoc(presenceDoc(currentRoomCode, myUserId), {
        nick: safeNick(),
        lastSeen: serverTimestamp()
      });
    } catch {}
  }, 15000);

  window.addEventListener("beforeunload", onUnloadCleanup, { once: true });
}

async function deleteSubcollection(roomId, subName) {
  while (true) {
    const q = query(collection(db, "rooms", roomId, subName), limit(200));
    const snap = await getDocs(q);
    if (snap.empty) break;

    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

async function clearRoomIfEmpty(roomId) {
  // Check if anyone is still present
  const snap = await getDocs(query(presenceColl(roomId), limit(1)));
  if (!snap.empty) return;

  setHint("Room empty — clearing…");
  try {
    await deleteSubcollection(roomId, "messages");
    await deleteSubcollection(roomId, "presence");
    await deleteDoc(doc(db, "rooms", roomId));
  } catch (e) {
    console.warn("clearRoomIfEmpty failed:", e);
  }
  setHint("");
}

// -------- Join / Leave --------
async function joinRoom(code) {
  const clean = (code || "").trim();
  if (!/^\d{6}$/.test(clean)) {
    setHint("Room code must be 6 digits.");
    return;
  }

  await setDoc(doc(db, "rooms", clean), { createdAt: serverTimestamp() }, { merge: true });

  currentRoomCode = clean;
  roomCodeEl.textContent = clean;
  enableChatUI(true);
  setStatus(`In room ${clean}`);
  setHint("Connected.");

  await startPresence(clean);

  // presence listener (helps cleanup logic)
  if (unsubPresence) unsubPresence();
  unsubPresence = onSnapshot(presenceColl(clean), async (snap) => {
    if (snap.empty) {
      await clearRoomIfEmpty(clean);
    }
  });

  // messages listener
  const msgsRef = collection(db, "rooms", clean, "messages");
  const qMsgs = query(msgsRef, orderBy("createdAt", "asc"), limit(250));

  if (unsubMsgs) unsubMsgs();
  clearMessagesUI();

  unsubMsgs = onSnapshot(qMsgs, (snap) => {
    const keepPinned = !isNearBottom(msgsEl);

    clearMessagesUI();

    snap.forEach((d) => {
      const m = d.data();
      const mine = m.userId === myUserId;

      const row = document.createElement("div");
      row.className = `bubbleRow ${mine ? "me" : "them"}`;

      const bubble = document.createElement("div");
      bubble.className = "bubble";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = m.nick || "Anonymous";
      bubble.appendChild(name);

      const text = document.createElement("div");
      text.className = "text";
      text.textContent = m.text || "";
      bubble.appendChild(text);

      const time = document.createElement("div");
      time.className = "time";
      time.textContent = fmtTime(m.createdAt);
      bubble.appendChild(time);

      const reactionsBar = document.createElement("div");
      reactionsBar.className = "reactions";

      const counts = m.reactions || {};
      REACTIONS.forEach((emoji) => {
        const c = Number(counts[emoji] || 0);
        if (c > 0) {
          const pill = document.createElement("span");
          pill.className = "reactionCount";
          pill.textContent = `${emoji} ${c}`;
          reactionsBar.appendChild(pill);
        }
      });

      REACTIONS.forEach((emoji) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "reactionBtn";
        b.textContent = emoji;
        b.onclick = () => reactToMessage(clean, d.id, emoji);
        reactionsBar.appendChild(b);
      });

      bubble.appendChild(reactionsBar);

      row.appendChild(bubble);
      msgsEl.appendChild(row);
    });

    if (!keepPinned) scrollToBottom(msgsEl);
  });
}

async function leaveRoom() {
  const roomId = currentRoomCode;

  if (unsubMsgs) unsubMsgs();
  unsubMsgs = null;
  if (unsubPresence) unsubPresence();
  unsubPresence = null;

  stopPresence();

  if (roomId) {
    try { await deleteDoc(presenceDoc(roomId, myUserId)); } catch {}
  }

  currentRoomCode = null;
  roomCodeEl.textContent = "—";
  clearMessagesUI();
  enableChatUI(false);
  setStatus("Not connected");
  setHint("");

  if (roomId) {
    await clearRoomIfEmpty(roomId);
  }
}

// -------- Sending --------
async function sendText() {
  if (!currentRoomCode) return;

  const text = (msgEl.value || "").trim();
  if (!text) return;

  msgEl.value = "";

  await addDoc(collection(db, "rooms", currentRoomCode, "messages"), {
    type: "text",
    userId: myUserId,
    nick: safeNick(),
    text,
    reactions: {},
    createdAt: serverTimestamp()
  });
}

async function reactToMessage(roomId, msgId, emoji) {
  const msgRef = doc(db, "rooms", roomId, "messages", msgId);
  const snap = await getDoc(msgRef);
  if (!snap.exists()) return;

  const data = snap.data();
  const reactions = data.reactions || {};
  const current = Number(reactions[emoji] || 0);

  await updateDoc(msgRef, { [`reactions.${emoji}`]: current + 1 });
}

// -------- UI wiring --------
hostBtn.onclick = async () => {
  const code = genCode6();
  codeEl.value = code;
  setHint(`Hosting room: ${code}`);
  await joinRoom(code);
};

joinBtn.onclick = async () => {
  await joinRoom(codeEl.value);
};

copyBtn.onclick = async () => {
  if (!currentRoomCode) return;
  await navigator.clipboard.writeText(currentRoomCode);
  setHint("Room code copied!");
};

leaveBtn.onclick = () => leaveRoom();

sendBtn.onclick = () => sendText();
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendText();
});

// Start state
enableChatUI(false);
setStatus("Not connected");
setHint("Click Host to create a room, or enter a 6-digit code and Join.");
