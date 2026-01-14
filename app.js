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
  serverTimestamp,
  query,
  orderBy,
  limit,
  onSnapshot,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-storage.js";

/* ===== PASTE YOUR FIREBASE CONFIG HERE ===== */
const firebaseConfig = {
  apiKey: "PASTE_HERE",
  authDomain: "PASTE_HERE",
  projectId: "PASTE_HERE",
  storageBucket: "PASTE_HERE",
  messagingSenderId: "PASTE_HERE",
  appId: "PASTE_HERE"
};
/* ========================================== */

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

const el = (id) => document.getElementById(id);

const nickEl = el("nick");
const codeEl = el("code");
const hintEl = el("hint");
const statusEl = el("status");

const roomCodeEl = el("roomCode");
const youIdEl = el("youId");
const msgsEl = el("messages");

const msgEl = el("msg");
const imgEl = el("img");
const imgBtn = el("imgBtn");
const sendBtn = el("sendBtn");
const joinBtn = el("joinBtn");
const hostBtn = el("hostBtn");
const copyBtn = el("copyBtn");
const leaveBtn = el("leaveBtn");

const previewBar = el("previewBar");
const previewImg = el("previewImg");
const previewName = el("previewName");
const cancelImgBtn = el("cancelImgBtn");
const sendImgBtn = el("sendImgBtn");

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
  imgBtn.disabled = !enabled;
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

// Reactions supported
const REACTIONS = ["👍", "😂", "❤️", "🔥"];

let currentRoomCode = null;
let unsubMsgs = null;
let unsubPresence = null;
let heartbeatTimer = null;

// image preview
let pendingFile = null;
function showPreview(file) {
  pendingFile = file;
  previewBar.classList.remove("hidden");
  previewName.textContent = file.name;
  previewImg.src = URL.createObjectURL(file);
}
function hidePreview() {
  if (previewImg.src?.startsWith("blob:")) {
    try { URL.revokeObjectURL(previewImg.src); } catch {}
  }
  previewImg.src = "";
  previewName.textContent = "";
  previewBar.classList.add("hidden");
  pendingFile = null;
}

// ---------- Presence ----------
function presenceRef(roomId, userId) {
  return doc(db, "rooms", roomId, "presence", userId);
}
function presenceColl(roomId) {
  return collection(db, "rooms", roomId, "presence");
}

async function startPresence(roomId) {
  // Create/update our presence doc
  await setDoc(presenceRef(roomId, myUserId), {
    userId: myUserId,
    nick: safeNick(),
    lastSeen: serverTimestamp()
  }, { merge: true });

  // Heartbeat every 15s so we look "online"
  stopPresence();
  heartbeatTimer = setInterval(async () => {
    if (!currentRoomCode) return;
    try {
      await updateDoc(presenceRef(currentRoomCode, myUserId), {
        nick: safeNick(),
        lastSeen: serverTimestamp()
      });
    } catch {
      // ignore (e.g., if room cleared)
    }
  }, 15000);

  // Ensure we try to clean up our presence on unload (best effort)
  window.addEventListener("beforeunload", onUnloadCleanup, { once: true });
}

function stopPresence() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// best-effort on tab close
async function onUnloadCleanup() {
  try {
    if (currentRoomCode) {
      await deleteDoc(presenceRef(currentRoomCode, myUserId));
    }
  } catch {}
}

// ---------- Room cleanup ----------
async function deleteSubcollection(roomId, subName) {
  // Deletes docs in batches (Firestorm batch limit is 500)
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
  // Check presence count right now
  const snap = await getDocs(query(presenceColl(roomId), limit(1)));
  if (!snap.empty) return; // someone is still there

  // Nobody is present: clear messages + presence + room doc
  setHint("Room empty — clearing…");
  try {
    await deleteSubcollection(roomId, "messages");
    await deleteSubcollection(roomId, "presence");
    await deleteDoc(doc(db, "rooms", roomId));
  } catch (e) {
    // If rules block deletes or race conditions happen, ignore
    console.warn("clearRoomIfEmpty failed:", e);
  }
  setHint("");
}

// ---------- Join / Leave ----------
async function joinRoom(code) {
  const clean = (code || "").trim();
  if (!/^\d{6}$/.test(clean)) {
    setHint("Room code must be 6 digits.");
    return;
  }

  // Create room doc if needed
  await setDoc(doc(db, "rooms", clean), { createdAt: serverTimestamp() }, { merge: true });

  currentRoomCode = clean;
  roomCodeEl.textContent = clean;
  enableChatUI(true);
  setStatus(`In room ${clean}`);
  setHint("Connected.");

  // Start presence
  await startPresence(clean);

  // Listen to presence: if it becomes empty (and we are not there), clear it
  if (unsubPresence) unsubPresence();
  unsubPresence = onSnapshot(presenceColl(clean), async (snap) => {
    // If we are the only one left, don’t clear (we’re still in the room)
    // If room is empty (rare while we're connected), we can clear; mostly happens after we leave.
    // We’ll clear only if currentRoomCode is null (i.e., we left) OR if snap is empty.
    if (snap.empty) {
      // If empty while we're still connected, something odd happened; attempt cleanup
      await clearRoomIfEmpty(clean);
    }
  });

  // Messages
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

      if (m.type === "image" && m.imageUrl) {
        const img = document.createElement("img");
        img.className = "img";
        img.src = m.imageUrl;
        img.alt = "image";
        img.loading = "lazy";
        bubble.appendChild(img);
      } else {
        const text = document.createElement("div");
        text.className = "text";
        text.textContent = m.text || "";
        bubble.appendChild(text);
      }

      const time = document.createElement("div");
      time.className = "time";
      time.textContent = fmtTime(m.createdAt);
      bubble.appendChild(time);

      // reactions UI
      const reactionsBar = document.createElement("div");
      reactionsBar.className = "reactions";
      const counts = m.reactions || {};

      // counts
      REACTIONS.forEach((emoji) => {
        const c = Number(counts[emoji] || 0);
        if (c > 0) {
          const pill = document.createElement("span");
          pill.className = "reactionCount";
          pill.textContent = `${emoji} ${c}`;
          reactionsBar.appendChild(pill);
        }
      });

      // buttons
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

  // stop listeners first
  if (unsubMsgs) unsubMsgs();
  unsubMsgs = null;
  if (unsubPresence) unsubPresence();
  unsubPresence = null;

  // stop heartbeat
  stopPresence();

  // delete our presence doc
  if (roomId) {
    try { await deleteDoc(presenceRef(roomId, myUserId)); } catch {}
  }

  // clear UI
  currentRoomCode = null;
  roomCodeEl.textContent = "—";
  clearMessagesUI();
  enableChatUI(false);
  setStatus("Not connected");
  setHint("");
  hidePreview();

  // Best-effort: if that was the last user, clear the room
  if (roomId) {
    await clearRoomIfEmpty(roomId);
  }
}

// ---------- Sending ----------
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

async function sendImage(file) {
  if (!currentRoomCode) return;
  if (!file) return;

  if (file.size > 3 * 1024 * 1024) {
    setHint("Image too large (max 3MB).");
    return;
  }

  setHint("Uploading image…");

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `rooms/${currentRoomCode}/${Date.now()}-${Math.random().toString(16).slice(2)}-${safeName}`;
  const r = ref(storage, path);

  await uploadBytes(r, file);
  const url = await getDownloadURL(r);

  await addDoc(collection(db, "rooms", currentRoomCode, "messages"), {
    type: "image",
    userId: myUserId,
    nick: safeNick(),
    imageUrl: url,
    reactions: {},
    createdAt: serverTimestamp()
  });

  setHint("");
}

// reactions (simple, uses read-modify-write)
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

imgBtn.onclick = () => imgEl.click();
imgEl.addEventListener("change", () => {
  const file = imgEl.files?.[0];
  imgEl.value = "";
  if (!file) return;
  showPreview(file);
});

cancelImgBtn.onclick = () => hidePreview();
sendImgBtn.onclick = async () => {
  if (!pendingFile) return;
  const file = pendingFile;
  hidePreview();
  await sendImage(file);
};

// ---------- Start state ----------
enableChatUI(false);
setStatus("Not connected");
setHint("Click Host to create a room, or enter a 6-digit code and Join.");
hidePreview();
