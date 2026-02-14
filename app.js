import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* ===== PASTE YOUR FIREBASE CONFIG HERE (same as account.html) ===== */
const firebaseConfig = {
  apiKey: "AIzaSyDrZ-maG46ecU5Fgidqyrws1DdNoEfqeFI",
  authDomain: "salad-chatt.firebaseapp.com",
  projectId: "salad-chatt",
  storageBucket: "salad-chatt.firebasestorage.app",
  messagingSenderId: "841208847669",
  appId: "1:841208847669:web:568e254429166d05c2c07c",
  measurementId: "G-FFF48MW8EL"
};
/* ================================================================= */

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const el = (id) => document.getElementById(id);

const statusEl = el("status");
const accountBtn = el("accountBtn");

const meNameEl = el("meName");
const meIdEl = el("meId");

const newChatIdEl = el("newChatId");
const startChatBtn = el("startChatBtn");
const hintEl = el("hint");

const chatListEl = el("chatList");

const chatTitleEl = el("chatTitle");
const chatMetaEl = el("chatMeta");
const deleteChatBtn = el("deleteChatBtn");

const msgsEl = el("messages");
const msgEl = el("msg");
const sendBtn = el("sendBtn");

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

function setHint(t){ hintEl.textContent = t || ""; }
function setStatus(t){ statusEl.textContent = t || ""; }

function loadLocalUser(){
  try { return JSON.parse(localStorage.getItem("salad_user_v1") || "null"); }
  catch { return null; }
}

const user = loadLocalUser();
if (!user?.id || !user?.name){
  // block access until account created
  window.location.replace("./account.html");
}

const myId = user.id;
const myName = user.name;

meNameEl.textContent = myName;
meIdEl.textContent = myId;

accountBtn.onclick = () => window.location.href = "./account.html";

// reactions
const REACTIONS = ["👍","😂","❤️","🔥"];

// current chat state
let currentChatId = null;
let currentChat = null; // chat doc data
let unsubChatList = null;
let unsubMessages = null;

// reply state
let replyTarget = null; // {id, nick, preview}

// context menu target
let ctxTarget = null; // {chatId,msgId,nick,preview}

// ---------- Helpers ----------
function isNearBottom(container){
  return container.scrollHeight - container.scrollTop - container.clientHeight < 140;
}
function scrollToBottom(container){
  container.scrollTop = container.scrollHeight;
}

function fmtTime(ts){
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) : "";
}

// Format code blocks and inline code
function renderFormattedText(container, rawText){
  const text = rawText ?? "";
  const parts = text.split("```");
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const block = document.createElement("div");
      block.className = "codeBlock";
      const pre = document.createElement("pre");
      pre.textContent = part.replace(/^\n/, "");
      block.appendChild(pre);
      container.appendChild(block);
    } else {
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

// deterministic DM chatId
function dmChatId(a,b){
  const [x,y] = [a,b].sort();
  return `dm_${x}_${y}`;
}

// ---------- Chat list ----------
async function ensureUserExists(userId){
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? snap.data() : null;
}

function renderChatItem(chatId, chat){
  // Skip chats user deleted for themselves
  const hiddenFor = chat.hiddenFor || [];
  if (hiddenFor.includes(myId)) return null;

  const div = document.createElement("div");
  div.className = "chatItem" + (chatId === currentChatId ? " active" : "");
  div.dataset.chatId = chatId;

  const title = document.createElement("div");
  title.className = "title";

  // DM title = other person's name (or id)
  let display = chat.title || "Chat";
  if (chat.type === "dm"){
    const other = (chat.members || []).find(m => m !== myId) || "Unknown";
    display = chat.memberNames?.[other] || other;
  }
  title.textContent = display;

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = chat.lastPreview || "No messages yet";

  div.appendChild(title);
  div.appendChild(sub);

  div.onclick = () => openChat(chatId);

  return div;
}

function subscribeChatList(){
  if (unsubChatList) unsubChatList();

  const chatsRef = collection(db, "chats");
  const q = query(chatsRef, where("members", "array-contains", myId), orderBy("lastMessageAt", "desc"), limit(50));

  unsubChatList = onSnapshot(q, (snap) => {
    chatListEl.innerHTML = "";
    snap.forEach((d) => {
      const item = renderChatItem(d.id, d.data());
      if (item) chatListEl.appendChild(item);
    });
  });
}

// ---------- Open chat ----------
async function openChat(chatId){
  currentChatId = chatId;

  // update active highlight
  Array.from(chatListEl.querySelectorAll(".chatItem")).forEach(n => {
    n.classList.toggle("active", n.dataset.chatId === chatId);
  });

  const chatSnap = await getDoc(doc(db,"chats",chatId));
  if (!chatSnap.exists()) return;

  currentChat = chatSnap.data();

  // header info
  if (currentChat.type === "dm"){
    const other = (currentChat.members || []).find(m => m !== myId) || "Unknown";
    const name = currentChat.memberNames?.[other] || other;
    chatTitleEl.textContent = name;
    chatMetaEl.textContent = `DM • ${other}`;
  } else {
    chatTitleEl.textContent = currentChat.title || "Group";
    chatMetaEl.textContent = `Group • ${(currentChat.members||[]).length} members`;
  }

  deleteChatBtn.disabled = false;
  msgEl.disabled = false;
  sendBtn.disabled = false;

  subscribeMessages(chatId);
}

function subscribeMessages(chatId){
  if (unsubMessages) unsubMessages();

  msgsEl.innerHTML = "";

  const msgsRef = collection(db, "chats", chatId, "messages");
  const q = query(msgsRef, orderBy("createdAt","asc"), limit(300));

  unsubMessages = onSnapshot(q, (snap) => {
    const keepPinned = !isNearBottom(msgsEl);
    msgsEl.innerHTML = "";

    snap.forEach((d) => {
      const m = d.data();
      const mine = m.senderId === myId;

      const row = document.createElement("div");
      row.className = `bubbleRow ${mine ? "me" : "them"}`;

      const bubble = document.createElement("div");
      bubble.className = "bubble";

      // data for context menu
      bubble.dataset.msgId = d.id;
      bubble.dataset.nick = m.senderName || "Unknown";
      bubble.dataset.preview = (m.deleted ? "Message deleted" : (m.text || "")).slice(0, 140);

      attachContextHandlers(bubble, chatId, d.id);

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = m.senderName || "Unknown";
      bubble.appendChild(name);

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

      // reactions summary (counts only)
      const counts = m.reactions || {};
      const pills = Object.entries(counts).filter(([,c])=>Number(c)>0).map(([e,c])=>`${e} ${c}`).join("  ");
      if (pills){
        const t = document.createElement("div");
        t.className = "time";
        t.style.textAlign = mine ? "right" : "left";
        t.style.opacity = "0.75";
        t.textContent = pills;
        bubble.appendChild(t);
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

// ---------- Start DM ----------
startChatBtn.onclick = async () => {
  const otherId = (newChatIdEl.value || "").trim();
  if (!/^\d{10}$/.test(otherId)){
    setHint("Friend ID must be 10 digits.");
    return;
  }
  if (otherId === myId){
    setHint("You can’t chat with yourself.");
    return;
  }

  setHint("Checking user…");
  const otherUser = await ensureUserExists(otherId);
  if (!otherUser){
    setHint("No user found with that ID.");
    return;
  }

  const chatId = dmChatId(myId, otherId);
  const chatRef = doc(db, "chats", chatId);

  // Create chat if not exists
  const existing = await getDoc(chatRef);
  if (!existing.exists()){
    await setDoc(chatRef, {
      type: "dm",
      members: [myId, otherId],
      memberNames: {
        [myId]: myName,
        [otherId]: otherUser.name
      },
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastPreview: "Chat created"
    });
  } else {
    // update names (in case someone changed name later)
    await updateDoc(chatRef, {
      [`memberNames.${myId}`]: myName,
      [`memberNames.${otherId}`]: otherUser.name
    });
  }

  newChatIdEl.value = "";
  setHint("");
  await openChat(chatId);
};

// ---------- Send message ----------
function showReply(target){
  replyTarget = target;
  replyBar.classList.remove("hidden");
  replyToNameEl.textContent = target.nick;
  replyPreviewEl.textContent = target.preview;
  msgEl.focus();
}
function hideReply(){
  replyTarget = null;
  replyBar.classList.add("hidden");
  replyToNameEl.textContent = "";
  replyPreviewEl.textContent = "";
}
cancelReplyBtn.onclick = () => hideReply();

sendBtn.onclick = async () => {
  if (!currentChatId) return;
  const text = (msgEl.value || "").trim();
  if (!text) return;

  msgEl.value = "";

  const payload = {
    senderId: myId,
    senderName: myName,
    text,
    deleted: false,
    reactions: {},
    createdAt: serverTimestamp()
  };

  if (replyTarget){
    payload.replyTo = {
      id: replyTarget.id,
      nick: replyTarget.nick,
      preview: replyTarget.preview
    };
    hideReply();
  }

  await addDoc(collection(db, "chats", currentChatId, "messages"), payload);

  // update chat preview
  await updateDoc(doc(db, "chats", currentChatId), {
    lastMessageAt: serverTimestamp(),
    lastPreview: text.slice(0, 80)
  });
};

msgEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
});

// ---------- Delete chat (for me only) ----------
deleteChatBtn.onclick = async () => {
  if (!currentChatId) return;
  const ref = doc(db, "chats", currentChatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const chat = snap.data();
  const hiddenFor = new Set(chat.hiddenFor || []);
  hiddenFor.add(myId);

  await updateDoc(ref, { hiddenFor: Array.from(hiddenFor) });

  // UI reset
  currentChatId = null;
  currentChat = null;
  chatTitleEl.textContent = "Select a chat";
  chatMetaEl.textContent = "—";
  deleteChatBtn.disabled = true;
  msgEl.disabled = true;
  sendBtn.disabled = true;
  msgsEl.innerHTML = "";
};

// ---------- Context menu / react / reply / delete message ----------
function closeCtxMenu(){
  ctxMenu.classList.add("hidden");
  ctxMenu.setAttribute("aria-hidden","true");
  ctxTarget = null;
}
function openCtxMenuAt(x,y,node,chatId,msgId){
  const nick = node.dataset.nick || "Unknown";
  const preview = (node.dataset.preview || "").slice(0,160).replace(/\s+/g," ").trim();

  ctxTarget = { chatId, msgId, nick, preview };
  ctxHeader.textContent = `Message • ${nick}`;

  ctxReacts.innerHTML = "";
  REACTIONS.forEach((emoji) => {
    const b = document.createElement("button");
    b.className = "ctxEmoji";
    b.type = "button";
    b.textContent = emoji;
    b.onclick = async () => {
      await reactToMessage(chatId, msgId, emoji);
      closeCtxMenu();
    };
    ctxReacts.appendChild(b);
  });

  ctxMenu.classList.remove("hidden");

  // clamp
  const vw = window.innerWidth, vh = window.innerHeight, pad = 10;
  ctxMenu.style.left = "0px"; ctxMenu.style.top = "0px";
  const rect = ctxMenu.getBoundingClientRect();

  let left = x, top = y;
  if (left + rect.width + pad > vw) left = vw - rect.width - pad;
  if (top + rect.height + pad > vh) top = vh - rect.height - pad;
  if (left < pad) left = pad;
  if (top < pad) top = pad;

  ctxMenu.style.left = `${left}px`;
  ctxMenu.style.top = `${top}px`;
  ctxMenu.setAttribute("aria-hidden","false");
}

let longPressTimer = null;
function attachContextHandlers(node, chatId, msgId){
  node.addEventListener("contextmenu",(e)=>{
    e.preventDefault();
    openCtxMenuAt(e.clientX, e.clientY, node, chatId, msgId);
  });

  node.addEventListener("touchstart",(e)=>{
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    longPressTimer = setTimeout(()=>{
      openCtxMenuAt(t.clientX, t.clientY, node, chatId, msgId);
    }, 520);
  }, {passive:true});

  node.addEventListener("touchend",()=>{
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  });
  node.addEventListener("touchmove",()=>{
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  }, {passive:true});
}

ctxClose.onclick = () => closeCtxMenu();
document.addEventListener("pointerdown",(e)=>{
  if (ctxMenu.classList.contains("hidden")) return;
  if (!ctxMenu.contains(e.target)) closeCtxMenu();
});

ctxReply.onclick = () => {
  if (!ctxTarget) return;
  showReply({ id: ctxTarget.msgId, nick: ctxTarget.nick, preview: ctxTarget.preview });
  closeCtxMenu();
};

ctxDelete.onclick = async () => {
  if (!ctxTarget) return;
  await softDeleteMessage(ctxTarget.chatId, ctxTarget.msgId);
  closeCtxMenu();
};

async function reactToMessage(chatId, msgId, emoji){
  const msgRef = doc(db, "chats", chatId, "messages", msgId);
  const snap = await getDoc(msgRef);
  if (!snap.exists()) return;

  const data = snap.data();
  const reactions = data.reactions || {};
  const current = Number(reactions[emoji] || 0);

  await updateDoc(msgRef, { [`reactions.${emoji}`]: current + 1 });
}

async function softDeleteMessage(chatId, msgId){
  const msgRef = doc(db, "chats", chatId, "messages", msgId);
  await updateDoc(msgRef, {
    deleted: true,
    text: "",
    deletedAt: serverTimestamp()
  });
}

// ---------- Init ----------
setStatus("Ready");
subscribeChatList();
msgEl.disabled = true;
sendBtn.disabled = true;
deleteChatBtn.disabled = true;
