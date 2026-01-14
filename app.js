// Salad Chatt (Firebase Firestore rooms)
// Works on GitHub Pages because Firebase runs in the browser.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, collection, doc, setDoc, addDoc, serverTimestamp,
  query, orderBy, limit, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// --------------- STEP A: Paste your Firebase config here ---------------
const firebaseConfig = {
  // You will fill this in after creating a Firebase project.
  // apiKey: "...",
  // authDomain: "...",
  // projectId: "...",
  // storageBucket: "...",
  // messagingSenderId: "...",
  // appId: "..."
};
// ----------------------------------------------------------------------

const el = (id) => document.getElementById(id);

const nickEl = el("nick");
const codeEl = el("code");
const hintEl = el("hint");
const statusEl = el("status");

const roomCodeEl = el("roomCode");
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
  // 6 digits, numbers only
  return String(Math.floor(100000 + Math.random() * 900000));
}

function safeNick() {
  const n = (nickEl.value || "").trim();
  return n.length ? n.slice(0, 20) : "Anonymous";
}

function clearMessagesUI() {
  msgsEl.innerHTML = "";
}

function addMessageUI({ nick, text, createdAt }) {
  const wrap = document.createElement("div");
  wrap.className = "msg";

  const meta = document.createElement("div");
  meta.className = "meta";

  const when = createdAt?.toDate ? createdAt.toDate() : null;
  meta.textContent = `${nick} • ${when ? when.toLocaleString() : "just now"}`;

  const body = document.createElement("div");
  body.className = "text";
  body.textContent = text;

  wrap.appendChild(meta);
  wrap.appendChild(body);
  msgsEl.appendChild(wrap);

  msgsEl.scrollTop = msgsEl.scrollHeight;
}

let app = null;
let db = null;
let currentRoomCode = null;
let unsub = null;

function firebaseReady() {
  // basic guard so you don't forget config
  return firebaseConfig && firebaseConfig.apiKey;
}

function enableChatUI(enabled) {
  msgEl.disabled = !enabled;
  sendBtn.disabled = !enabled;
  leaveBtn.disabled = !enabled;
  copyBtn.disabled = !enabled;

  // joining/hosting should be disabled while in a room
  joinBtn.disabled = enabled;
  hostBtn.disabled = enabled;
  codeEl.disabled = enabled;
  nickEl.disabled = false; // allow nick change anytime (optional)
}

async function ensureFirebase() {
  if (!firebaseReady()) {
    setStatus("Missing Firebase config");
    setHint("Open app.js and paste your Firebase config (Step 4).");
    throw new Error("Firebase config not set");
  }
  if (!app) {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    setStatus("Firebase ready");
  }
}

function leaveRoom() {
  if (unsub) unsub();
  unsub = null;
  currentRoomCode = null;
  roomCodeEl.textContent = "—";
  clearMessagesUI();
  enableChatUI(false);
  setStatus("Not connected");
  setHint("");
}

async function joinRoom(code) {
  await ensureFirebase();

  const clean = (code || "").trim();
  if (!/^\d{6}$/.test(clean)) {
    setHint("Room code must be 6 digits.");
    return;
  }

  // create room doc if it doesn’t exist (harmless)
  const roomRef = doc(db, "rooms", clean);
  await setDoc(roomRef, { createdAt: serverTimestamp() }, { merge: true });

  currentRoomCode = clean;
  roomCodeEl.textContent = clean;
  enableChatUI(true);
  setStatus(`In room ${clean}`);
  setHint("Connected. Say hi!");

  // listen to last 100 messages
  const msgsRef = collection(db, "rooms", clean, "messages");
  const q = query(msgsRef, orderBy("createdAt", "asc"), limit(100));

  if (unsub) unsub();
  clearMessagesUI();

  unsub = onSnapshot(q, (snap) => {
    clearMessagesUI();
    snap.forEach((d) => addMessageUI(d.data()));
  });
}

async function sendMessage() {
  if (!currentRoomCode) return;
  await ensureFirebase();

  const text = (msgEl.value || "").trim();
  if (!text) return;

  msgEl.value = "";

  const msgsRef = collection(db, "rooms", currentRoomCode, "messages");
  await addDoc(msgsRef, {
    nick: safeNick(),
    text,
    createdAt: serverTimestamp()
  });
}

// UI wiring
hostBtn.onclick = async () => {
  const code = genCode6();
  codeEl.value = code;
  setHint(`Hosting room: ${code} (share this code)`);
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

sendBtn.onclick = () => sendMessage();
msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// Start state
enableChatUI(false);
setStatus("Not connected");
setHint("Tip: Click Host to create a room code, or enter a code and Join.");
