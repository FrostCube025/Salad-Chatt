import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, push, set, onValue } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

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
const db = getDatabase(app);

// CHAT
const chatBox = document.getElementById('chat-box');
const nameInput = document.getElementById('nameInput');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');

sendBtn.onclick = () => {
    const msg = messageInput.value;
    const name = nameInput.value || "Anonymous";
    if(msg) {
        push(ref(db, 'messages'), { name, msg });
        messageInput.value = "";
    }
};

onValue(ref(db, 'messages'), (snapshot) => {
    chatBox.innerHTML = "";
    snapshot.forEach((child) => {
        const data = child.val();
        chatBox.innerHTML += `<div><b>${data.name}:</b> ${data.msg}</div>`;
    });
    chatBox.scrollTop = chatBox.scrollHeight;
});

// GAME LOGIC
let score = 0; let timeLeft = 10; let isPlaying = false; let timer;

window.toggleGame = () => {
    const area = document.getElementById('game-area');
    area.style.display = area.style.display === 'none' ? 'block' : 'none';
};

window.startGame = () => {
    if(isPlaying) return;
    score = 0; timeLeft = 10; isPlaying = true;
    document.getElementById('score').innerText = score;
    timer = setInterval(() => {
        timeLeft--;
        document.getElementById('timer').innerText = timeLeft;
        if(timeLeft <= 0) {
            clearInterval(timer);
            isPlaying = false;
            saveScore(score);
            alert("Done! Score: " + score);
        }
    }, 1000);
};

document.getElementById('target-btn').onclick = () => {
    if(isPlaying) { score++; document.getElementById('score').innerText = score; }
};

function saveScore(s) {
    const n = nameInput.value || "Anonymous";
    set(ref(db, 'leaderboard/' + n), { name: n, score: s });
}

onValue(ref(db, 'leaderboard'), (snapshot) => {
    const data = snapshot.val();
    const list = document.getElementById('leader-list');
    list.innerHTML = "";
    if(data) {
        const sorted = Object.values(data).sort((a,b) => b.score - a.score).slice(0, 5);
        sorted.forEach((e, i) => { list.innerHTML += `<div>#${i+1} ${e.name}: ${e.score}</div>`; });
    }
});
