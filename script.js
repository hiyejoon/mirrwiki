import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// --- Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyDoxGleFDo1xt_f9QE8XhmdIBL65XTfR6A",
    authDomain: "mirrwiki-pro.firebaseapp.com",
    projectId: "mirrwiki-pro",
    storageBucket: "mirrwiki-pro.firebasestorage.app",
    messagingSenderId: "154251618788",
    appId: "1:154251618788:web:98594edc88afe64333bff1",
    measurementId: "G-DN6RG991TV"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Global States ---
const ADMIN_EMAIL = "hl105sk@proton.me";
const appId = 'mirrwiki-default';
const KBASE_OFFSET = 44032;
const MARKER_KBASE = "갂";

let currentUser = null;
let currentDocId = "FrontPage";
let isEditing = false;
let allDocTitles = [];
let currentDocIsLocked = false;
let aiModel = null;

const getWikiCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'wiki_pages');
const getHistoryCollection = (docId) => collection(getWikiCollection(), docId, 'history');

// --- K-Base 시스템 ---
function kBaseEncode(u8) {
    let res = "";
    for (let i = 0; i < u8.length; i += 3) {
        const b0 = u8[i], b1 = u8[i + 1] || 0, b2 = u8[i + 2] || 0;
        const val = (b0 << 16) | (b1 << 8) | b2;
        res += String.fromCharCode(KBASE_OFFSET + ((val >> 12) & 0xFFF));
        res += String.fromCharCode(KBASE_OFFSET + (val & 0xFFF));
    }
    return MARKER_KBASE + res;
}

function kBaseDecode(str) {
    if (str.startsWith(MARKER_KBASE)) str = str.substring(1);
    const buf = [];
    for (let i = 0; i < str.length; i += 2) {
        const c1 = str.charCodeAt(i) - KBASE_OFFSET;
        const c2 = (str.charCodeAt(i + 1) || 0) - KBASE_OFFSET;
        const val = (c1 << 12) | c2;
        buf.push((val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF);
    }
    return new Uint8Array(buf);
}

function resolveMediaContent(content, mime = 'image/webp') {
    if (!content) return null;
    try {
        if (content.startsWith(MARKER_KBASE) || content.includes("kbase,")) {
            const data = content.includes("kbase,") ? content.split("kbase,")[1] : content;
            return URL.createObjectURL(new Blob([kBaseDecode(data)], { type: mime }));
        }
        if (content.startsWith("data:")) return content;
        return `data:${mime};base64,${content}`;
    } catch (e) { return null; }
}

// --- 라우팅 ---
window.router = (pageId) => {
    if (!pageId) pageId = "FrontPage";
    currentDocId = pageId;
    window.history.pushState({ page: pageId }, '', `/w/${encodeURIComponent(pageId)}`);
    fetchDocument(pageId);
    document.getElementById('mobileMenu').classList.add('hidden');
    document.getElementById('searchResults').classList.add('hidden');
    window.scrollTo(0, 0);
};

async function fetchDocument(pageId) {
    currentDocId = pageId;
    const view = document.getElementById('viewMode');
    const titleDom = document.getElementById('docTitle');
    const summaryBox = document.getElementById('ai-summary-box');
    const tagsBox = document.getElementById('ai-tags-box');

    titleDom.innerText = pageId;
    document.title = `${pageId} - MirrWiki`;
    view.innerHTML = '<div class="text-center p-20 py-40 animate-pulse"><i class="fa-solid fa-dragon fa-bounce text-6xl text-[#00a495]"></i></div>';

    summaryBox.style.display = 'none';
    tagsBox.style.display = 'none';
    isEditing = false;
    updateModeUI();
    document.getElementById('ai-recs').classList.add('hidden');

    try {
        const snap = await getDoc(doc(getWikiCollection(), pageId));
        if (snap.exists()) {
            const data = snap.data();
            currentDocIsLocked = data.isLocked || false;

            if (pageId.startsWith("사진:")) {
                const src = resolveMediaContent(data.content);
                view.innerHTML = `<img src="${src}" class="max-w-full rounded-[30px] shadow-2xl">`;
            } else if (pageId.startsWith("오디오:")) {
                const src = resolveMediaContent(data.content, 'audio/mp3');
                view.innerHTML = `<div class="bg-gray-100 dark:bg-white/5 p-16 rounded-[40px] text-center shadow-inner"><audio controls src="${src}" class="w-full"></audio></div>`;
            } else {
                await renderContent(data.content);
                // QoL: 읽기 시간 계산
                calculateReadingTime(data.content);

                // AI 기능 On/Off 체크 후 실행
                if (localStorage.getItem('ai-enabled') !== 'false' && data.content.length > 50) {
                    suggestAI(data.content);
                    generateSummaryAI(data.content);
                    generateAutoTagsAI(data.content); // [AI 3단계 준비]
                }
            }
            document.getElementById('lastUpdated').innerText = `Archived: ${data.updatedAt?.toDate().toLocaleString() || '-'}`;
        } else {
            view.innerHTML = `<div class="text-center py-24"><p class="text-gray-400 mb-10 text-xl font-bold">기록되지 않은 지식입니다.</p><button onclick="toggleEdit()" class="namu-btn px-16 py-5 text-xl shadow-2xl">지식 각인</button></div>`;
            currentDocIsLocked = false;
        }
        renderToolbar();
    } catch (e) {
        view.innerHTML = `<div class="p-10 card border-red-500 bg-red-50 text-red-600 font-bold text-center">데이터 통신 단절: ${e.message}</div>`;
    }
}

async function renderContent(raw) {
    let text = raw;
    text = text.replace(/\[\[([^\]]+)\]\]/g, (_, t) => `<a href="#" onclick="router('${t}')">${t}</a>`);
    let fnIdx = 0;
    text = text.replace(/\[\*\s(.*?)]/g, (_, c) => `<sup class="wiki-fn" onclick="toggleFootnote(this, '${encodeURIComponent(c)}')">[${++fnIdx}]</sup>`);
    document.getElementById('viewMode').innerHTML = marked.parse(text);
    if (window.renderMathInElement) renderMathInElement(document.getElementById('viewMode'), { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });
}

// ==========================================
// [AI 2단계] 추출적 요약 (Centroid)
// ==========================================
async function generateSummaryAI(text) {
    const box = document.getElementById('ai-summary-box');
    const list = document.getElementById('ai-summary-list');
    try {
        if (!aiModel) aiModel = await use.load();
        box.style.display = 'block';
        list.innerHTML = `<li class="animate-pulse">지식 분석 중...</li>`;

        const cleanText = text.replace(/[#*`\[\]]/g, '').replace(/\s\s+/g, ' ');
        const sentences = cleanText.split(/[.!?\n]/).filter(s => s.trim().length > 15);

        if (sentences.length <= 3) {
            list.innerHTML = sentences.map(s => `<li>${s.trim()}.</li>`).join('');
            return;
        }

        const embeddings = await aiModel.embed(sentences);
        const vectors = await embeddings.array();
        const centroid = vectors[0].map((_, col) => vectors.reduce((sum, row) => sum + row[col], 0) / vectors.length);

        let scored = sentences.map((s, i) => ({ text: s.trim(), score: cosineSimilarity(vectors[i], centroid), index: i }));
        const top3 = scored.sort((a, b) => b.score - a.score).slice(0, 3).sort((a, b) => a.index - b.index);

        list.innerHTML = top3.map(r => `<li><i class="fa-solid fa-bolt-lightning text-[#00a495] mr-2 opacity-50"></i>${r.text}.</li>`).join('');
    } catch (e) { box.style.display = 'none'; }
}

// ==========================================
// [AI 3단계 준비] 자동 태깅 및 키워드 추출
// ==========================================
async function generateAutoTagsAI(text) {
    const tagsBox = document.getElementById('ai-tags-box');
    try {
        if (!aiModel) aiModel = await use.load();
        tagsBox.style.display = 'flex';

        // 1. 단어 분리 및 불용어 제거 (간이)
        const words = text.replace(/[^\wㄱ-ㅎㅏ-ㅣ가-힣]/g, ' ').split(/\s+/).filter(w => w.length > 1 && w.length < 10);
        const uniqueWords = [...new Set(words)].slice(0, 30);

        // 2. 단어 임베딩 생성하여 문서 전체와 가장 관련 있는 단어 5개 추출
        const embeddings = await aiModel.embed([text, ...uniqueWords]);
        const vectors = await embeddings.array();

        let wordScores = [];
        for (let i = 1; i < vectors.length; i++) {
            wordScores.push({ word: uniqueWords[i - 1], score: cosineSimilarity(vectors[0], vectors[i]) });
        }

        wordScores.sort((a, b) => b.score - a.score);
        tagsBox.innerHTML = wordScores.slice(0, 5).map(w => `<span class="ai-tag">#${w.word}</span>`).join('');
    } catch (e) { tagsBox.style.display = 'none'; }
}

async function suggestAI(text) {
    const recSection = document.getElementById('ai-recs');
    const recList = document.getElementById('rec-list');
    try {
        if (!aiModel) aiModel = await use.load();
        const samples = allDocTitles.filter(t => t !== currentDocId && !t.includes(':')).slice(0, 15);
        if (samples.length < 1) return;
        const embeddings = await aiModel.embed([text, ...samples]);
        const vectors = await embeddings.array();
        let scores = [];
        for (let i = 1; i < vectors.length; i++) {
            scores.push({ title: samples[i - 1], score: cosineSimilarity(vectors[0], vectors[i]) });
        }
        scores.sort((a, b) => b.score - a.score);
        recList.innerHTML = scores.slice(0, 2).map(s => `
            <div onclick="router('${s.title}')" class="p-6 border-2 rounded-3xl cursor-pointer hover:border-[#00a495] hover:bg-[#00a495]/5 transition-all">
                <div class="text-[9px] text-[#00a495] font-black uppercase mb-1">AI Relevancy ${Math.round(s.score * 100)}%</div>
                <div class="font-black text-lg">${s.title}</div>
            </div>
        `).join('');
        recSection.classList.remove('hidden');
    } catch (e) { }
}

function cosineSimilarity(a, b) {
    let dot = 0, mA = 0, mB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; mA += a[i] * a[i]; mB += b[i] * b[i]; }
    return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

// ==========================================
// Obsidian 그래프 뷰 (strength -10 적용)
// ==========================================
window.openGraphModal = async () => {
    document.getElementById('graphModal').classList.remove('hidden');
    const container = document.getElementById('graph-canvas');
    const isDark = document.body.classList.contains('dark-mode');

    const nodes = allDocTitles.map(t => ({
        id: t, name: t,
        color: t.includes('사진:') ? '#ff9800' : t.includes('오디오:') ? '#2196f3' : '#00a495'
    }));

    const links = [];
    const recentDocs = await getDocs(query(getWikiCollection(), limit(100)));
    recentDocs.forEach(d => {
        const content = d.data().content || "";
        const matches = content.match(/\[\[([^\]]+)\]\]/g);
        if (matches) {
            matches.forEach(m => {
                const target = m.replace('[[', '').replace(']]', '');
                if (allDocTitles.includes(target)) links.push({ source: d.id, target: target });
            });
        }
    });

    const Graph = ForceGraph()(container)
        .graphData({ nodes, links })
        .nodeLabel('name')
        .nodeRelSize(7)
        .linkColor(() => isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
        .backgroundColor(isDark ? '#0f0f0f' : '#f9f9f9')
        .onNodeClick(node => { document.getElementById('graphModal').classList.add('hidden'); window.router(node.id); })
        .nodeCanvasObject((node, ctx, globalScale) => {
            const label = node.name;
            const fontSize = 14 / globalScale;
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.beginPath(); ctx.arc(node.x, node.y, 4.5, 0, 2 * Math.PI, false);
            ctx.fillStyle = node.color; ctx.fill();
            if (globalScale > 1.8) {
                ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
                ctx.fillText(label, node.x - ctx.measureText(label).width / 2, node.y + 12);
            }
        });

    Graph.d3Force('charge').strength(-10); // 요청사항 반영
    Graph.d3Force('center').x(0).y(0);
};

// --- QoL Helpers ---
function calculateReadingTime(text) {
    const wordsPerMinute = 200;
    const time = Math.ceil(text.length / wordsPerMinute);
    document.getElementById('reading-time').innerText = `About ${time} min read`;
}

window.copyCurrentURL = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => window.showToast("지식의 경로가 복사되었습니다."));
};

// --- 개인화 설정 제어 ---
window.openSettingsModal = () => {
    document.getElementById('settingsModal').classList.remove('hidden');
    document.getElementById('ai-toggle').checked = localStorage.getItem('ai-enabled') !== 'false';
    document.getElementById('dark-toggle').checked = document.body.classList.contains('dark-mode');
};
window.closeSettingsModal = () => document.getElementById('settingsModal').classList.add('hidden');
window.toggleAISetting = (enabled) => {
    localStorage.setItem('ai-enabled', enabled);
    window.showToast(enabled ? "AI 어시스턴트가 깨어났습니다." : "AI 어시스턴트가 잠들었습니다.");
    fetchDocument(currentDocId); // 즉시 적용
};

// --- CRUD 및 기타 (생략 없음) ---
window.saveDocument = async () => {
    if (!currentUser) return window.openAuthModal();
    const content = document.getElementById('editorContent').value;
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;
    try {
        await setDoc(doc(getWikiCollection(), currentDocId), { title: currentDocId, content, updatedAt: serverTimestamp(), updatedBy: currentUser.uid, isLocked: currentDocIsLocked });
        await addDoc(getHistoryCollection(currentDocId), { action: "ENGRAVED", editor: currentUser.email, timestamp: serverTimestamp() });
        window.showToast("지식이 안전하게 보존되었습니다.");
        fetchDocument(currentDocId);
    } catch (e) { alert("권한 거부"); }
    finally { btn.disabled = false; }
};

window.submitDeleteDoc = async () => {
    try { await deleteDoc(doc(getWikiCollection(), currentDocId)); window.closeDeleteModal(); window.router('FrontPage'); } catch (e) { alert("삭제 실패"); }
};

window.submitMoveDoc = async () => {
    const newT = document.getElementById('moveDocTitleInput').value.trim();
    if (!newT) return;
    try {
        const oldS = await getDoc(doc(getWikiCollection(), currentDocId));
        await setDoc(doc(getWikiCollection(), newT), { ...oldS.data(), title: newT });
        await deleteDoc(doc(getWikiCollection(), currentDocId));
        window.closeMoveModal(); window.router(newT);
    } catch (e) { alert("이동 오류"); }
};

window.submitImageUpload = async () => {
    const file = document.getElementById('imgFileInput').files[0];
    const name = document.getElementById('imgTitleInput').value.trim();
    if (!file || !name) return;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
        const img = new Image(); img.src = e.target.result;
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const MAX = 800; let w = img.width, h = img.height;
            if (w > MAX) { h *= MAX / w; w = MAX; }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            await setDoc(doc(getWikiCollection(), "사진:" + name), { title: "사진:" + name, content: canvas.toDataURL('image/webp', 0.8), updatedAt: serverTimestamp() });
            window.showToast("이미지 각인 성공"); window.closeImageUploadModal(); window.router("사진:" + name);
        };
    };
};

window.submitAudioUpload = async () => {
    const file = document.getElementById('audioFileInput').files[0];
    const name = document.getElementById('audioTitleInput').value.trim();
    if (!file || !name) return;
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = async (e) => {
        const encoded = kBaseEncode(new Uint8Array(e.target.result));
        await setDoc(doc(getWikiCollection(), "오디오:" + name), { title: "오디오:" + name, content: `data:${file.type};kbase,${encoded}`, updatedAt: serverTimestamp() });
        window.showToast("오디오 각인 성공"); window.closeAudioUploadModal(); window.router("오디오:" + name);
    };
};

window.toggleDarkMode = () => {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcon();
};
function updateThemeIcon() {
    const icon = document.getElementById('theme-icon');
    if (document.body.classList.contains('dark-mode')) icon.classList.replace('fa-moon', 'fa-sun');
    else icon.classList.replace('fa-sun', 'fa-moon');
}

onAuthStateChanged(auth, user => {
    currentUser = user;
    const authSec = document.getElementById('desktopAuthSection');
    if (user) {
        authSec.innerHTML = `<button onclick="handleLogout()" class="bg-[#008b7d] px-5 py-1.5 rounded-full text-white font-black text-[11px] border-2 border-white/20 uppercase tracking-tighter">${user.email.split('@')[0]}</button>`;
        document.getElementById('mobileAuthItem').innerText = `SIGN OUT (${user.email.split('@')[0]})`;
    } else {
        authSec.innerHTML = `<button onclick="openAuthModal()" class="text-[11px] font-black border-2 border-white px-5 py-1.5 rounded-full uppercase tracking-widest hover:bg-white hover:text-[#00a495] transition-all">Archive Access</button>`;
        document.getElementById('mobileAuthItem').innerText = "LOGIN / REGISTER";
    }
    loadRecentChanges(); loadAllTitles(); loadPageFromUrl();
});

function loadPageFromUrl() {
    const path = window.location.pathname;
    const page = path.startsWith('/w/') ? decodeURIComponent(path.substring(3)) : "FrontPage";
    fetchDocument(page);
}

function loadRecentChanges() {
    onSnapshot(query(getWikiCollection(), orderBy("updatedAt", "desc"), limit(15)), s => {
        document.getElementById('recentList').innerHTML = s.docs.map(d => `
            <li class="p-5 cursor-pointer hover:bg-[#00a495]/5 transition-all border-b last:border-0" onclick="router('${d.id}')">
                <div class="font-black text-gray-700 dark:text-gray-200 truncate mb-1">${d.id}</div>
                <div class="text-[10px] text-gray-400 font-mono tracking-tighter uppercase">${d.data().updatedAt?.toDate().toLocaleString() || '-'}</div>
            </li>
        `).join('');
        document.getElementById('stat-total').innerText = s.size + "+";
    });
}

async function loadAllTitles() {
    try { const s = await getDocs(query(getWikiCollection())); allDocTitles = s.docs.map(d => d.id); } catch (e) { }
}

function renderToolbar() {
    const bar = document.getElementById('toolbarButtons');
    bar.innerHTML = `
        <button onclick="openHistoryModal()" class="text-[10px] font-black border-2 px-4 py-2 rounded-xl hover:bg-gray-100 transition-all">HISTORY</button>
        <button onclick="toggleEdit()" class="text-[10px] font-black border-2 px-4 py-2 rounded-xl hover:bg-gray-100 transition-all">EDIT</button>
        <button onclick="openMoveModal()" class="text-[10px] border-2 px-2 py-2 rounded-xl"><i class="fa-solid fa-arrows-spin"></i></button>
        <button onclick="openDeleteModal()" class="text-[10px] border-2 px-2 py-2 rounded-xl text-red-500 border-red-100 hover:bg-red-50"><i class="fa-solid fa-trash-can"></i></button>
    `;
}

// UI Helpers (All Binding Window)
window.handleSearch = () => { const v = document.getElementById('searchInput').value.trim(); if (v) { window.router(v); document.getElementById('searchInput').value = ''; } };
window.handleRandom = () => { if (allDocTitles.length) window.router(allDocTitles[Math.floor(Math.random() * allDocTitles.length)]); };
window.showAllDocuments = () => {
    document.getElementById('docTitle').innerText = "Inventory of Knowledge";
    document.getElementById('viewMode').innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">${allDocTitles.sort().map(t => `<div class="p-5 card cursor-pointer hover:border-[#00a495] transition-all font-black text-sm tracking-tight" onclick="router('${t}')"><i class="fa-regular fa-file text-[#00a495] mr-2 opacity-50"></i>${t}</div>`).join('')}</div>`;
};
window.showToast = (m) => {
    const t = document.getElementById('toast');
    t.innerHTML = `<i class="fa-solid fa-circle-check text-[#00a495]"></i> <span>${m}</span>`;
    t.classList.remove('translate-y-48');
    setTimeout(() => t.classList.add('translate-y-48'), 3500);
};

window.openAuthModal = () => document.getElementById('authModal').classList.remove('hidden');
window.closeAuthModal = () => document.getElementById('authModal').classList.add('hidden');
window.openNewDocModal = () => document.getElementById('newDocModal').classList.remove('hidden');
window.closeNewDocModal = () => document.getElementById('newDocModal').classList.add('hidden');
window.openImageUploadModal = () => document.getElementById('imageUploadModal').classList.remove('hidden');
window.closeImageUploadModal = () => document.getElementById('imageUploadModal').classList.add('hidden');
window.openAudioUploadModal = () => document.getElementById('audioUploadModal').classList.remove('hidden');
window.closeAudioUploadModal = () => document.getElementById('audioUploadModal').classList.add('hidden');
window.openMoveModal = () => { document.getElementById('moveDocTitleInput').value = currentDocId; document.getElementById('moveDocModal').classList.remove('hidden'); };
window.closeMoveModal = () => document.getElementById('moveDocModal').classList.add('hidden');
window.openDeleteModal = () => { document.getElementById('deleteTargetTitle').innerText = currentDocId; document.getElementById('deleteDocModal').classList.remove('hidden'); };
window.closeDeleteModal = () => document.getElementById('deleteDocModal').classList.add('hidden');
window.toggleMobileMenu = () => document.getElementById('mobileMenu').classList.toggle('hidden');

window.toggleEdit = async () => {
    if (!currentUser) return window.openAuthModal();
    isEditing = !isEditing;
    if (isEditing) {
        const snap = await getDoc(doc(getWikiCollection(), currentDocId));
        document.getElementById('editorContent').value = snap.exists() ? snap.data().content : `# ${currentDocId}\n\n`;
        document.getElementById('editing-title-display').innerText = currentDocId;
    }
    updateModeUI();
};
window.cancelEdit = () => { isEditing = false; updateModeUI(); };
function updateModeUI() { document.getElementById('viewMode').classList.toggle('hidden', isEditing); document.getElementById('editMode').classList.toggle('hidden', !isEditing); }

window.openHistoryModal = async () => {
    const list = document.getElementById('historyList'); list.innerHTML = '<tr><td colspan="3" class="p-12 text-center animate-pulse tracking-widest text-xs font-black opacity-50">SYNCING...</td></tr>';
    document.getElementById('historyModal').classList.remove('hidden');
    try {
        const snap = await getDocs(query(getHistoryCollection(currentDocId), orderBy("timestamp", "desc"), limit(25)));
        list.innerHTML = snap.docs.map(d => `<tr class="border-b hover:bg-gray-50 transition-colors"><td class="p-5 text-[10px] font-mono opacity-50">${d.data().timestamp?.toDate().toLocaleString() || '-'}</td><td class="p-5 font-black text-xs italic">${d.data().editor.split('@')[0]}</td><td class="p-5 text-xs font-bold tracking-tight text-[#00a495]">${d.data().action}</td></tr>`).join('');
    } catch (e) { list.innerHTML = '<tr><td colspan="3" class="p-10 text-center text-gray-400">데이터가 없습니다.</td></tr>'; }
};

window.handleLogin = async () => { try { await signInWithEmailAndPassword(auth, document.getElementById('emailInput').value, document.getElementById('passwordInput').value); window.closeAuthModal(); } catch (e) { alert("DENIED"); } };
window.handleSignup = async () => { try { await createUserWithEmailAndPassword(auth, document.getElementById('emailInput').value, document.getElementById('passwordInput').value); window.closeAuthModal(); } catch (e) { alert("FAIL"); } };
window.handleLogout = () => signOut(auth);
window.onpopstate = (e) => loadPageFromUrl();
window.createNewDoc = () => { const t = document.getElementById('newDocTitleInput').value.trim(); if (t) { window.router(t); window.closeNewDocModal(); } };

if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');
updateThemeIcon();

window.onscroll = () => {
    const h = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    document.getElementById("progress-bar").style.width = (window.scrollY / h * 100) + "%";
    const btn = document.getElementById('scroll-top-btn');
    if (window.scrollY > 300) btn.style.display = 'flex'; else btn.style.display = 'none';
};

window.toggleFootnote = (el, enc) => {
    const pop = document.getElementById('fnPopover'); if (pop.style.display === 'block') { pop.style.display = 'none'; return; }
    document.getElementById('fnPopoverContent').innerHTML = marked.parse(decodeURIComponent(enc));
    pop.style.display = 'block'; const rect = el.getBoundingClientRect();
    pop.style.top = (rect.bottom + window.scrollY + 8) + 'px'; pop.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
};