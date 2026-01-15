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

/**
 * FIX: per-tab user id (prevents "all messages on right" + presence overwrite)
 */
function getOrCreateUserId() {
  const key = "saladchatt_uid_session_v2";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.getRandomValues(new Uint32Array(2)).join("").slice(0, 10);
    sessionStorage.setItem(key, id);
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
function scrollToBottom(container) {
  container.scrollTop = container.scrollHeight;
}

// reactions
const REACTIONS = ["👍", "😂", "❤️", "🔥"];

let currentRoomCode = null;
let unsubMsgs = null;
let unsubPresence = null;
let heartbeatTimer = null;

// ---------- Presence UI elements (created dynamically; no HTML edits needed) ----------
let presenceUI = null;

function ensurePresenceUI() {
  if (presenceUI) return presenceUI;

  // Try to attach near the top of the chat card
  // We'll insert above messages list if possible
  const container = msgsEl?.parentElement;
  const wrap = document.createElement("div");
  wrap.style.marginTop = "10px";
  wrap.style.marginBottom = "6px";
  wrap.style.fontSize = "12px";
  wrap.style.color = "rgba(238,242,255,.75)";
  wrap.style.display = "flex";
  wrap.style.flexWrap = "wrap";
  wrap.style.gap = "8px";
  wrap.style.alignItems = "center";

  const count = document.createElement("span");
  count.id = "onlineCount";
  count.textContent = "Online: 0";

  const list = document.createElement("span");
  list.id = "onlineList";
  list.style.opacity = "0.9";
  list.textContent = "";

  wrap.appendChild(count);
  wrap.appendChild(document.createTextNode("•"));
  wrap.appendChild(list);

  // Insert just above the messages box
  if (container) {
    container.insertBefore(wrap, msgsEl);
  } else {
    document.body.appendChild(wrap);
  }

  presenceUI = { countEl: count, listEl: list };
  return presenceUI;
}

function renderPresenceList(presences) {
  const ui = ensurePresenceUI();
  const names = presences
    .map(p => (p.nick || "Anonymous").trim() || "Anonymous")
    .slice(0, 20);

  ui.countEl.textContent = `Online: ${presences.length}`;
  ui.listEl.textContent = names.length ? names.join(", ") : "—";
}

// ---------- Presence helpers ----------
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

// ---------- Cleanup helpers ----------
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

// ---------- System message ----------
async function sendSystemMessage(roomId, text) {
  await addDoc(collection(db, "rooms", roomId, "messages"), {
    type: "system",
    userId: "system",
    nick: "system",
    text,
    reactions: {},
    createdAt: serverTimestamp()
  });
}

// ---------- Join / Leave ----------
let lastPresenceMap = new Map(); // userId -> nick

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

  // Presence listener: update online list + send "left" system message
  if (unsubPresence) unsubPresence();
  lastPresenceMap = new Map();

  unsubPresence = onSnapshot(presenceColl(clean), async (snap) => {
    const current = [];
    const currentMap = new Map(); // userId -> nick

    snap.forEach((d) => {
      const p = d.data();
      current.push(p);
      currentMap.set(d.id, p.nick || "Anonymous");
    });

    // Update UI list
    renderPresenceList(current);

    // Detect who left (present before, missing now)
    const leftUsers = [];
    for (const [uid, n] of lastPresenceMap.entries()) {
      if (!currentMap.has(uid)) {
        leftUsers.push({ uid, nick: n || "Anonymous" });
      }
    }

    // Leader election to avoid duplicate "left" messages:
    // leader = smallest userId currently present
    const presentIds = Array.from(currentMap.keys()).sort();
    const leaderId = presentIds.length ? presentIds[0] : null;
    const iAmLeader = leaderId && leaderId === myUserId;

    if (leftUsers.length && iAmLeader) {
      for (const u of leftUsers) {
        // don’t announce ourselves leaving (we do it in leaveRoom)
        if (u.uid === myUserId) continue;
        await sendSystemMessage(clean, `----- ${u.nick} left the chat -----`);
      }
    }

    lastPresenceMap = currentMap;

    // If empty, maybe clear (best-effort)
    if (currentMap.size === 0) {
      await clearRoomIfEmpty(clean);
    }
  });

  // Messages listener
  const msgsRef = collection(db, "rooms", clean, "messages");
  const qMsgs = query(msgsRef, orderBy("createdAt", "asc"), limit(300));

  if (unsubMsgs) unsubMsgs();
  clearMessagesUI();

  unsubMsgs = onSnapshot(qMsgs, (snap) => {
    const keepPinned = !isNearBottom(msgsEl);
    clearMessagesUI();

    snap.forEach((d) => {
      const m = d.data();
      const mine = m.userId === myUserId;

      // SYSTEM message
      if (m.type === "system") {
        const sys = document.createElement("div");
        sys.style.textAlign = "center";
        sys.style.fontSize = "12px";
        sys.style.color = "rgba(238,242,255,.65)";
        sys.style.padding = "6px 0";
        sys.textContent = m.text || "";
        msgsEl.appendChild(sys);
        return;
      }

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

  // Stop listeners
  if (unsubMsgs) unsubMsgs();
  unsubMsgs = null;
  if (unsubPresence) unsubPresence();
  unsubPresence = null;

  // Stop heartbeat
  stopPresence();

  // Announce our leave (best effort)
  if (roomId) {
    try {
      await sendSystemMessage(roomId, `----- ${safeNick()} left the chat -----`);
    } catch {}
  }

  // Delete our presence doc
  if (roomId) {
    try { await deleteDoc(presenceDoc(roomId, myUserId)); } catch {}
  }

  // Clear UI
  currentRoomCode = null;
  roomCodeEl.textContent = "—";
  clearMessagesUI();
  enableChatUI(false);
  setStatus("Not connected");
  setHint("");

  // Delay cleanup slightly to avoid race conditions
  if (roomId) {
    setTimeout(() => clearRoomIfEmpty(roomId), 1500);
  }
}

// ---------- Send / React ----------
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

// ---------- UI wiring ----------
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

// initial state
enableChatUI(false);
setStatus("Not connected");
setHint("Click Host to create a room, or enter a 6-digit code and Join.");
