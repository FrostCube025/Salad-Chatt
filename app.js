import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  getDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/* Firebase config (embedded as requested) */
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

const statusEl = el("status");
const accountBtn = el("accountBtn");

const meNameEl = el("meName");
const meIdEl = el("meId");

const addContactIdEl = el("addContactId");
const addContactBtn = el("addContactBtn");
const hintEl = el("hint");

const contactListEl = el("contactList");
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

// Profile modal
const profileModal = el("profileModal");
const profileBackdrop = el("profileBackdrop");
const profileCloseBtn = el("profileCloseBtn");
const profileNameEl = el("profileName");
const profileIdEl = el("profileId");
const profileAboutEl = el("profileAbout");
const profileCopyBtn = el("profileCopyBtn");
const profileStartDmBtn = el("profileStartDmBtn");
const profileHintEl = el("profileHint");

// Context menu
const ctxMenu = el("ctxMenu");
const ctxHeader = el("ctxHeader");
const ctxReacts = el("ctxReacts");
const ctxReply = el("ctxReply");
const ctxDelete = el("ctxDelete");
const ctxClose = el("ctxClose");

function setHint(t){ hintEl.textContent = t || ""; }
function setStatus(t){ statusEl.textContent = t || ""; }
function setProfileHint(t){ profileHintEl.textContent = t || ""; }

function loadLocalUser(){
  try { return JSON.parse(localStorage.getItem("salad_user_v1") || "null"); }
  catch { return null; }
}

const user = loadLocalUser();
if (!user?.id || !user?.name){
  window.location.replace("./account.html");
}
const myId = user.id;
const myName = user.name;

meNameEl.textContent = myName;
meIdEl.textContent = myId;

accountBtn.onclick = () => window.location.href = "./account.html";

const REACTIONS = ["👍","😂","❤️","🔥"];

let currentChatId = null;
let unsubContacts = null;
let unsubChats = null;
let unsubMessages = null;

let replyTarget = null;
let ctxTarget = null;

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

// code formatting
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

function dmChatId(a,b){
  const [x,y] = [a,b].sort();
  return `dm_${x}_${y}`;
}

async function ensureUserExists(userId){
  const snap = await getDoc(doc(db, "users", userId));
  return snap.exists() ? snap.data() : null;
}

/* ---------- Profile modal ---------- */
async function openProfile(userId){
  setProfileHint("");
  profileModal.classList.remove("hidden");
  profileModal.setAttribute("aria-hidden","false");

  profileNameEl.textContent = "Loading…";
  profileIdEl.textContent = userId;
  profileAboutEl.textContent = "—";

  try{
    const snap = await getDoc(doc(db, "users", userId));
    if (!snap.exists()){
      profileNameEl.textContent = "Unknown user";
      profileAboutEl.textContent = "No description.";
      setProfileHint("This user does not exist (or was deleted).");
      return;
    }
    const u = snap.data();
    profileNameEl.textContent = u.name || "Unknown";
    profileIdEl.textContent = u.id || userId;
    profileAboutEl.textContent = (u.about && u.about.trim()) ? u.about : "No description yet.";
  } catch(e){
    console.error(e);
    profileNameEl.textContent = "Error";
    profileAboutEl.textContent = "—";
    setProfileHint("Failed to load profile.");
  }

  profileCopyBtn.onclick = async () => {
    await navigator.clipboard.writeText(userId);
    setProfileHint("Copied ID!");
  };

  profileStartDmBtn.onclick = async () => {
    if (!/^\d{10}$/.test(userId)) return;
    await ensureDmChat(userId);
    closeProfile();
  };
}

function closeProfile(){
  profileModal.classList.add("hidden");
  profileModal.setAttribute("aria-hidden","true");
  setProfileHint("");
}
profileCloseBtn.onclick = closeProfile;
profileBackdrop.onclick = closeProfile;

/* ---------- Contacts ---------- */
// Contacts stored at: users/{myId}/contacts/{contactId}
function contactsColl(userId){
  return collection(db, "users", userId, "contacts");
}

async function upsertContact(ownerId, contactUser){
  // contactUser: {id, name, about}
  await setDoc(doc(db, "users", ownerId, "contacts", contactUser.id), {
    id: contactUser.id,
    name: contactUser.name || "Unknown",
    about: contactUser.about || "",
    addedAt: serverTimestamp()
  }, { merge: true });
}

async function addContactMutual(otherId){
  if (!/^\d{10}$/.test(otherId)){
    setHint("Contact ID must be 10 digits.");
    return;
  }
  if (otherId === myId){
    setHint("You can’t add yourself.");
    return;
  }

  setHint("Checking user…");
  const otherUser = await ensureUserExists(otherId);
  if (!otherUser){
    setHint("No user found with that ID.");
    return;
  }

  // Add to my contacts
  await upsertContact(myId, { id: otherId, name: otherUser.name, about: otherUser.about });

  // Add me to their contacts (auto-appears on both sides)
  await upsertContact(otherId, { id: myId, name: myName, about: user.about || "" });

  setHint("Contact added!");
}

addContactBtn.onclick = async () => {
  const otherId = (addContactIdEl.value || "").trim();
  addContactIdEl.value = "";
  await addContactMutual(otherId);
};

function subscribeContacts(){
  if (unsubContacts) unsubContacts();

  const q = query(contactsColl(myId), orderBy("addedAt","desc"), limit(100));
  unsubContacts = onSnapshot(q, (snap) => {
    contactListEl.innerHTML = "";
    snap.forEach((d) => {
      const c = d.data();
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="title">${escapeHtml(c.name || c.id)}</div>
        <div class="sub">${escapeHtml(c.id)} • click to chat</div>
      `;
      div.onclick = async () => {
        await ensureDmChat(c.id);
      };
      contactListEl.appendChild(div);
    });
  });
}

/* ---------- Chats ---------- */
async function ensureDmChat(otherId){
  setHint("");
  const otherUser = await ensureUserExists(otherId);
  if (!otherUser){
    setHint("No user found with that ID.");
    return;
  }

  const chatId = dmChatId(myId, otherId);
  const chatRef = doc(db, "chats", chatId);

  const existing = await getDoc(chatRef);
  if (!existing.exists()){
    await setDoc(chatRef, {
      type: "dm",
      members: [myId, otherId],
      memberNames: { [myId]: myName, [otherId]: otherUser.name },
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastPreview: "Chat created",
      hiddenFor: []
    });
  } else {
    await updateDoc(chatRef, {
      [`memberNames.${myId}`]: myName,
      [`memberNames.${otherId}`]: otherUser.name
    });
  }

  await openChat(chatId);
}

function subscribeChats(){
  if (unsubChats) unsubChats();

  const chatsRef = collection(db, "chats");
  const q = query(chatsRef, where("members", "array-contains", myId), orderBy("lastMessageAt", "desc"), limit(50));

  unsubChats = onSnapshot(q, (snap) => {
    chatListEl.innerHTML = "";
    snap.forEach((d) => {
      const chatId = d.id;
      const chat = d.data();
      if ((chat.hiddenFor || []).includes(myId)) return;

      const div = document.createElement("div");
      div.className = "item" + (chatId === currentChatId ? " active" : "");
      div.dataset.chatId = chatId;

      let title = chat.title || "Chat";
      if (chat.type === "dm"){
        const other = (chat.members || []).find(m => m !== myId) || "Unknown";
        title = chat.memberNames?.[other] || other;
      }

      div.innerHTML = `
        <div class="title">${escapeHtml(title)}</div>
        <div class="sub">${escapeHtml(chat.lastPreview || "No messages yet")}</div>
      `;
      div.onclick = () => openChat(chatId);
      chatListEl.appendChild(div);
    });
  });
}

async function openChat(chatId){
  currentChatId = chatId;

  Array.from(chatListEl.querySelectorAll(".item")).forEach(n => {
    n.classList.toggle("active", n.dataset.chatId === chatId);
  });

  const chatSnap = await getDoc(doc(db,"chats",chatId));
  if (!chatSnap.exists()) return;

  const chat = chatSnap.data();

  if (chat.type === "dm"){
    const other = (chat.members || []).find(m => m !== myId) || "Unknown";
    const name = chat.memberNames?.[other] || other;
    chatTitleEl.textContent = name;
    chatMetaEl.textContent = `DM • ${other}`;
  } else {
    chatTitleEl.textContent = chat.title || "Group";
    chatMetaEl.textContent = `Group • ${(chat.members||[]).length} members`;
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
      bubble.dataset.msgId = d.id;
      bubble.dataset.nick = m.senderName || "Unknown";
      bubble.dataset.preview = (m.deleted ? "Message deleted" : (m.text || "")).slice(0,140);

      attachContextHandlers(bubble, chatId, d.id);

      const name = document.createElement("div");
      name.className = "name profileLink";
      name.textContent = m.senderName || "Unknown";
      name.onclick = () => openProfile(m.senderId);
      bubble.appendChild(name);

      if (m.replyTo && m.replyTo.nick) {
        const chip = document.createElement("div");
        chip.className = "replyChip";
        const rn = document.createElement("div");
        rn.className = "replyNick";
        rn.textContent = `Replying to ${m.replyTo.nick}`;
        const rt = document.createElement("div");
        rt.className = "replyText";
        rt.textContent = m.replyTo.preview || "";
        chip.appendChild(rn);
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

/* ---------- Reply UI ---------- */
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

/* ---------- Send message ---------- */
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
    payload.replyTo = { id: replyTarget.id, nick: replyTarget.nick, preview: replyTarget.preview };
    hideReply();
  }

  await addDoc(collection(db, "chats", currentChatId, "messages"), payload);

  await updateDoc(doc(db, "chats", currentChatId), {
    lastMessageAt: serverTimestamp(),
    lastPreview: text.slice(0, 80)
  });
};

msgEl.addEventListener("keydown",(e)=>{
  if (e.key === "Enter") sendBtn.click();
});

/* ---------- Hide chat for me ---------- */
deleteChatBtn.onclick = async () => {
  if (!currentChatId) return;
  const ref = doc(db, "chats", currentChatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;

  const chat = snap.data();
  const hiddenFor = new Set(chat.hiddenFor || []);
  hiddenFor.add(myId);
  await updateDoc(ref, { hiddenFor: Array.from(hiddenFor) });

  currentChatId = null;
  chatTitleEl.textContent = "Select a chat";
  chatMetaEl.textContent = "—";
  deleteChatBtn.disabled = true;
  msgEl.disabled = true;
  sendBtn.disabled = true;
  msgsEl.innerHTML = "";
};

/* ---------- Context menu ---------- */
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
  await updateDoc(msgRef, { deleted: true, text: "", deletedAt: serverTimestamp() });
}

/* ---------- Safety: escape HTML for list items ---------- */
function escapeHtml(s){
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

/* ---------- Init ---------- */
setStatus("Ready");
subscribeContacts();
subscribeChats();

msgEl.disabled = true;
sendBtn.disabled = true;
deleteChatBtn.disabled = true;

profileCloseBtn && (profileCloseBtn.onclick = closeProfile);
profileBackdrop && (profileBackdrop.onclick = closeProfile);
