import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  onSnapshot,
  serverTimestamp
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

alert("app.js loaded"); // REMOVE LATER

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Elements
const nick = document.getElementById("nick");
const codeInput = document.getElementById("code");
const hostBtn = document.getElementById("hostBtn");
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const sendBtn = document.getElementById("sendBtn");
const msgInput = document.getElementById("msg");
const messages = document.getElementById("messages");
const roomSpan = document.getElementById("room");

let roomCode = null;
let unsubscribe = null;

// Utils
function genCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function addMessage(nick, text) {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = `<div class="meta">${nick}</div>${text}`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

// Join room
async function joinRoom(code) {
  roomCode = code;
  roomSpan.textContent = code;

  await setDoc(doc(db, "rooms", code), { createdAt: serverTimestamp() }, { merge: true });

  const msgsRef = collection(db, "rooms", code, "messages");

  unsubscribe = onSnapshot(msgsRef, snap => {
    messages.innerHTML = "";
    snap.forEach(d => {
      const m = d.data();
      addMessage(m.nick, m.text);
    });
  });

  msgInput.disabled = false;
  sendBtn.disabled = false;
  leaveBtn.disabled = false;
}

// Buttons
hostBtn.onclick = async () => {
  const code = genCode();
  codeInput.value = code;
  await joinRoom(code);
};

joinBtn.onclick = async () => {
  if (!/^\d{6}$/.test(codeInput.value)) {
    alert("Invalid code");
    return;
  }
  await joinRoom(codeInput.value);
};

sendBtn.onclick = async () => {
  if (!roomCode) return;
  const text = msgInput.value.trim();
  if (!text) return;

  msgInput.value = "";

  await addDoc(collection(db, "rooms", roomCode, "messages"), {
    nick: nick.value || "Anon",
    text,
    createdAt: serverTimestamp()
  });
};

leaveBtn.onclick = () => {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  roomCode = null;
  roomSpan.textContent = "—";
  messages.innerHTML = "";
  msgInput.disabled = true;
  sendBtn.disabled = true;
  leaveBtn.disabled = true;
};
