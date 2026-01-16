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

const onlineCountEl = el("onlineCount");
const onlineListEl = el("onlineList");

const msgsEl = el("messages");

const msgEl = el("msg");
const sendBtn = el("sendBtn");
const joinBtn = el("joinBtn");
const hostBtn = el("hostBtn");
const copyBtn = el("copyBtn");
const leaveBtn = el("leaveBtn");

// reply bar
const replyBar = el("replyBar");
const replyToNameEl = el("replyToName");
const replyPreviewEl = el("replyPreview");
const cancelReplyBtn = el("cancelReplyBtn");

// context menu
const ctxMenu = el("ctxMenu");
const ctxHeader = el("ctxHeader");
const ctxReacts = el("ctxReacts");
const ctxReply = el("ctxReply");
const ctxDelete = el("ctxDelete");
const ctxClose = el("ctxClose");

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
 * Per-tab identity so multi-tab tests behave like different users.
 */
function getOrCreateUserId() {
  const key = "saladchatt_uid_session_v3";
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
function scrollToBottom(container) { container.scrollTop = container.scrollHeight; }

// reactions
const REACTIONS = ["👍", "😂", "❤️", "🔥"];

let currentRoomCode = null;
let unsubMsgs = null;
let unsubPresence = null;
let heartbeatTimer = null;

// reply state
let replyTarget = null; // {id, nick, preview}

// context menu state
let ctxTarget = null; // {roomId, msgId, nick, preview}

// ---------- Presence ----------
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

// ---------- Code formatting (simple parser) ----------
function renderFormattedText(container, rawText) {
  // supports ```code blocks``` and `inline`
  const text = rawText ?? "";
  const parts = text.split("```"); // even = normal, odd = code block
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      // code block
      const block = document.createElement("div");
      block.className = "codeBlock";

      const pre = document.createElement("pre");
      // If user wrote ```js\ncode``` keep it all; we don't highlight, just display.
      pre.textContent = part.replace(/^\n/, "");
      block.appendChild(pre);
      container.appendChild(block);
    } else {
      // normal text with inline `code`
      const inlineParts = part.split("`");
      inlineParts.forEach((seg, j) => {
        if (j % 2 === 1) {
          const c = document.createElement("span");
          c.className = "inlineCode";
          c.textContent = seg;
          container.appendChild(c);
        } else {
          container.appendChild(document.createTextNode(seg));
        }
      });
    }
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

  // Presence listener: show count + list + detect leaves
  if (unsubPresence) unsubPresence();
  lastPresenceMap = new Map();

  unsubPresence = onSnapshot(presenceColl(clean), async (snap) => {
    const currentMap = new Map(); // userId -> nick
    const list = [];

    snap.forEach((d) => {
      const p = d.data();
      const n = (p.nick || "Anonymous").trim() || "Anonymous";
      currentMap.set(d.id, n);
      list.push(n);
    });

    onlineCountEl.textContent = `Online: ${list.length}`;
    onlineListEl.textContent = list.length ? list.slice(0, 25).join(", ") : "—";

    // who left
    const leftUsers = [];
    for (const [uid, n] of lastPresenceMap.entries()) {
      if (!currentMap.has(uid)) leftUsers.push({ uid, nick: n });
    }

    // leader election to avoid duplicate "left" messages
    const presentIds = Array.from(currentMap.keys()).sort();
    const leaderId = presentIds.length ? presentIds[0] : null;
    const iAmLeader = leaderId && leaderId === myUserId;

    if (leftUsers.length && iAmLeader) {
      for (const u of leftUsers) {
        if (u.uid === myUserId) continue;
        await sendSystemMessage(clean, `----- ${u.nick} left the chat -----`);
      }
    }

    lastPresenceMap = currentMap;

    // if empty => clear (best-effort)
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

      // system
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

      bubble.dataset.msgId = d.id;
      bubble.dataset.nick = m.nick || "Anonymous";
      bubble.dataset.preview = (m.deleted ? "Message deleted" : (m.text || "")).slice(0, 140);

      // right click / long press target
      attachContextHandlers(bubble, clean, d.id);

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = m.nick || "Anonymous";
      bubble.appendChild(name);

      // reply chip
      if (m.replyTo && m.replyTo.nick) {
        const chip = document.createElement("div");
        chip.className = "replyChip";

        const rn = document.createElement("div");
        rn.className = "replyNick";
        rn.textContent = `Replying to ${m.replyTo.nick}`;
        chip.appendChild(rn);

        const rt = document.createElement("div");
        rt.className = "replyText";
        rt.textContent = m.replyTo.preview || "";
        chip.appendChild(rt);

        bubble.appendChild(chip);
      }

      // message body
      const body = document.createElement("div");
      body.className = "text";

      if (m.deleted) {
        body.style.opacity = "0.75";
        body.style.fontStyle = "italic";
        body.textContent = "Message deleted";
      } else {
        renderFormattedText(body, m.text || "");
      }
      bubble.appendChild(body);

      // reactions summary (counts only, no bar/buttons)
      if (m.reactions) {
        const counts = m.reactions || {};
        const pills = Object.entries(counts)
          .filter(([, c]) => Number(c) > 0)
          .map(([emoji, c]) => `${emoji} ${c}`)
          .join("  ");
        if (pills) {
          const t = document.createElement("div");
          t.className = "time";
          t.style.textAlign = mine ? "right" : "left";
          t.style.opacity = "0.75";
          t.textContent = pills;
          bubble.appendChild(t);
        }
      }

      const time = document.createElement("div");
      time.className = "time";
      time.textContent = fmtTime(m.createdAt);
      bubble.appendChild(time);

      row.appendChild(bubble);
      msgsEl.appendChild(row);
    });

    if (!keepPinned) scrollToBottom(msgsEl);
  });
}

async function leaveRoom() {
  const roomId = currentRoomCode;

  // stop listeners
  if (unsubMsgs) unsubMsgs();
  unsubMsgs = null;
  if (unsubPresence) unsubPresence();
  unsubPresence = null;

  stopPresence();
  hideReply();
  closeCtxMenu();

  // announce leave (best effort)
  if (roomId) {
    try {
      await sendSystemMessage(roomId, `----- ${safeNick()} left the chat -----`);
    } catch {}
  }

  // delete our presence
  if (roomId) {
    try { await deleteDoc(presenceDoc(roomId, myUserId)); } catch {}
  }

  // clear UI
  currentRoomCode = null;
  roomCodeEl.textContent = "—";
  clearMessagesUI();
  enableChatUI(false);
  setStatus("Not connected");
  setHint("");

  onlineCountEl.textContent = "Online: 0";
  onlineListEl.textContent = "—";

  // delay cleanup slightly
  if (roomId) {
    setTimeout(() => clearRoomIfEmpty(roomId), 1500);
  }
}

// ---------- Send / React / Delete ----------
async function sendText() {
  if (!currentRoomCode) return;

  const text = (msgEl.value || "").trim();
  if (!text) return;

  msgEl.value = "";

  const payload = {
    type: "text",
    userId: myUserId,
    nick: safeNick(),
    text,
    reactions: {},
    createdAt: serverTimestamp()
  };

  if (replyTarget) {
    payload.replyTo = {
      id: replyTarget.id,
      nick: replyTarget.nick,
      preview: replyTarget.preview
    };
    hideReply();
  }

  await addDoc(collection(db, "rooms", currentRoomCode, "messages"), payload);
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

async function softDeleteMessage(roomId, msgId) {
  const msgRef = doc(db, "rooms", roomId, "messages", msgId);
  await updateDoc(msgRef, {
    deleted: true,
    text: "",
    deletedAt: serverTimestamp()
  });
}

// ---------- Reply UI ----------
function showReply(target) {
  replyTarget = target;
  replyBar.classList.remove("hidden");
  replyToNameEl.textContent = target.nick;
  replyPreviewEl.textContent = target.preview;
  msgEl.focus();
}
function hideReply() {
  replyTarget = null;
  replyBar.classList.add("hidden");
  replyToNameEl.textContent = "";
  replyPreviewEl.textContent = "";
}
cancelReplyBtn.onclick = () => hideReply();

// ---------- Context menu (right-click + long press) ----------
let longPressTimer = null;

function attachContextHandlers(node, roomId, msgId) {
  // Right click (desktop)
  node.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openCtxMenuAt(e.clientX, e.clientY, node, roomId, msgId);
  });

  // Long press (mobile)
  node.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    longPressTimer = setTimeout(() => {
      openCtxMenuAt(t.clientX, t.clientY, node, roomId, msgId);
    }, 520);
  }, { passive: true });

  node.addEventListener("touchend", () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  });

  node.addEventListener("touchmove", () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  }, { passive: true });
}

function openCtxMenuAt(x, y, node, roomId, msgId) {
  const nick = node.dataset.nick || "Anonymous";
  const preview = (node.dataset.preview || "").slice(0, 160).replace(/\s+/g, " ").trim();

  ctxTarget = { roomId, msgId, nick, preview };

  ctxHeader.textContent = `Message • ${nick}`;

  // Build emoji buttons
  ctxReacts.innerHTML = "";
  REACTIONS.forEach((emoji) => {
    const b = document.createElement("button");
    b.className = "ctxEmoji";
    b.type = "button";
    b.textContent = emoji;
    b.onclick = async () => {
      await reactToMessage(roomId, msgId, emoji);
      closeCtxMenu();
    };
    ctxReacts.appendChild(b);
  });

  // Position menu within viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  ctxMenu.classList.remove("hidden");

  // temporarily set to measure
  ctxMenu.style.left = "0px";
  ctxMenu.style.top = "0px";

  const rect = ctxMenu.getBoundingClientRect();
  const pad = 10;

  let left = x;
  let top = y;

  if (left + rect.width + pad > vw) left = vw - rect.width - pad;
  if (top + rect.height + pad > vh) top = vh - rect.height - pad;
  if (left < pad) left = pad;
  if (top < pad) top = pad;

  ctxMenu.style.left = `${left}px`;
  ctxMenu.style.top = `${top}px`;
  ctxMenu.setAttribute("aria-hidden", "false");
}

function closeCtxMenu() {
  ctxMenu.classList.add("hidden");
  ctxMenu.setAttribute("aria-hidden", "true");
  ctxTarget = null;
}

ctxClose.onclick = () => closeCtxMenu();

ctxReply.onclick = () => {
  if (!ctxTarget) return;
  showReply({ id: ctxTarget.msgId, nick: ctxTarget.nick, preview: ctxTarget.preview });
  closeCtxMenu();
};

ctxDelete.onclick = async () => {
  if (!ctxTarget) return;
  // soft delete (message text becomes "Message deleted")
  await softDeleteMessage(ctxTarget.roomId, ctxTarget.msgId);
  closeCtxMenu();
};

// Close menu when clicking outside
document.addEventListener("pointerdown", (e) => {
  if (ctxMenu.classList.contains("hidden")) return;
  if (!ctxMenu.contains(e.target)) closeCtxMenu();
});

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
onlineCountEl.textContent = "Online: 0";
onlineListEl.textContent = "—";
hideReply();
closeCtxMenu();
