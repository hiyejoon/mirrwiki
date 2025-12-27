import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getFirestore, collection, collectionGroup, doc, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

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

// [교체] 마크다운 렌더링 및 ID 부여 (목차 이동 문제 해결의 핵심)
async function renderContent(raw) {
    let text = raw;
    // [[링크]] 처리
    text = text.replace(/\[\[([^\]]+)\]\]/g, (_, t) => `<a href="#" onclick="router('${t}')">${t}</a>`);
    // 각주 처리
    let fnIdx = 0;
    text = text.replace(/\[\*\s(.*?)]/g, (_, c) => `<sup class="wiki-fn" onclick="toggleFootnote(this, '${encodeURIComponent(c)}')">[${++fnIdx}]</sup>`);

    // 1. HTML로 변환
    const view = document.getElementById('viewMode');
    view.innerHTML = marked.parse(text);

    // 2. [수정됨] 헤더에 ID 강제 부여 (목차 이동을 위해 필수)
    const headers = view.querySelectorAll('h1, h2, h3');
    headers.forEach((h, index) => {
        h.id = `wiki-header-${index}`; // 예: id="wiki-header-0"
    });

    // 3. 수식 렌더링
    if (window.renderMathInElement) renderMathInElement(view, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });

    // 4. 목차 생성 호출
    generateFloatingTOC();

    // 5. 기타 기능 호출 (기존 코드 유지)
    updateDocStats(raw);
    loadBacklinks(currentDocId);
    initLinkPreview();
    updateDynamicFavicon();
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
// [교체] 문서 저장 시 'outgoingLinks' 필드를 함께 저장하도록 업그레이드
window.saveDocument = async () => {
    if (!currentUser) return window.openAuthModal();
    const content = document.getElementById('editorContent').value;
    const btn = document.getElementById('saveBtn');

    // [추가] 퀘스트 진행도 체크
    checkQuestProgress(currentDocId, content.length);

    btn.disabled = true; btn.innerText = "분석 및 저장 중...";

    try {
        // [[링크]] 추출 로직
        const linkRegex = /\[\[([^\]:]+)\]\]/g;
        const links = [];
        let match;
        while ((match = linkRegex.exec(content)) !== null) {
            links.push(match[1]);
        }
        const uniqueLinks = [...new Set(links)]; // 중복 제거

        await setDoc(doc(getWikiCollection(), currentDocId), {
            title: currentDocId,
            content,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
            isLocked: currentDocIsLocked,
            outgoingLinks: uniqueLinks // [핵심] 역링크 구현을 위한 참조 데이터 저장
        });
        await addDoc(getHistoryCollection(currentDocId), { action: "MODIFIED", editor: currentUser.email, timestamp: serverTimestamp() });

        window.showToast("지식과 연결 고리가 보존되었습니다.");
        fetchDocument(currentDocId);
    } catch (e) { alert("저장 권한이 부족합니다."); }
    finally { btn.disabled = false; btn.innerText = "보존하기"; }
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
        // [수정] onAuthStateChanged 내부의 if(user) 블록
        // 기존 버튼 대신 프로필 클릭 버튼으로 교체
        authSec.innerHTML = `<button onclick="openProfileModal()" class="bg-[#00a495] px-4 py-1 rounded-full text-white font-black text-[11px] uppercase border-2 border-white/20 flex items-center gap-2">
            ${user.email.split('@')[0]} <i class="fa-solid fa-crown user-crown"></i>
        </button>`;
        document.getElementById('mobileAuthItem').innerText = `SIGN OUT (${user.email.split('@')[0]})`;

        initDailyQuest(); // [추가] 퀘스트 초기화 호출
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
    try {
        const s = await getDocs(query(getWikiCollection()));
        allDocTitles = s.docs.map(d => d.id);
        initDailyQuest(); // [추가] 목록 로드 후 퀘스트 타겟 설정
    } catch (e) { }
}

function renderToolbar() {
    const bar = document.getElementById('toolbarButtons');
    bar.innerHTML = `
        <button onclick="toggleZenMode()" class="text-[10px] border px-2 py-1 rounded-lg" title="집중 모드"><i class="fa-solid fa-expand"></i></button>
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

// ==========================================
// [신규 기능 1] 링크 미리보기 (Hover Preview)
// ==========================================
const previewCache = {}; // 미리보기 데이터 캐싱

window.initLinkPreview = () => {
    const links = document.querySelectorAll('#viewMode a[onclick^="router"]');
    const popup = document.getElementById('link-preview');

    links.forEach(link => {
        link.addEventListener('mouseenter', async (e) => {
            const title = link.innerText;
            // 좌표 계산
            const rect = link.getBoundingClientRect();
            popup.style.left = `${rect.left}px`;
            popup.style.top = `${rect.bottom + 10}px`;
            popup.innerHTML = `<h4 class="animate-pulse">로딩 중...</h4>`;
            popup.classList.add('show');

            if (previewCache[title]) {
                popup.innerHTML = `<h4>${title}</h4><p>${previewCache[title]}</p>`;
            } else {
                try {
                    const snap = await getDoc(doc(getWikiCollection(), title));
                    if (snap.exists()) {
                        const txt = snap.data().content.replace(/[#*`\[\]]/g, '').substring(0, 150) + "...";
                        previewCache[title] = txt;
                        popup.innerHTML = `<h4>${title}</h4><p>${txt}</p>`;
                    } else {
                        popup.innerHTML = `<h4>${title}</h4><p class="text-gray-400">아직 작성되지 않은 문서입니다.</p>`;
                    }
                } catch (err) { popup.classList.remove('show'); }
            }
        });

        link.addEventListener('mouseleave', () => {
            popup.classList.remove('show');
        });
    });
};

// [교체] DOM 기반 목차 생성 (이제 클릭하면 진짜로 이동함)
window.generateFloatingTOC = () => {
    const tocContainer = document.getElementById('floating-toc');
    const headers = document.querySelectorAll('#viewMode h1, #viewMode h2, #viewMode h3');

    if (headers.length < 2) {
        tocContainer.style.display = 'none';
        return;
    }

    let tocHtml = `<div class="toc-title"><i class="fa-solid fa-list-ul"></i> 목차</div>`;

    headers.forEach((h) => {
        // 태그 이름(H1, H2..)에 따라 클래스 다르게 적용
        const level = h.tagName.toLowerCase();
        const title = h.innerText;
        // 위에서 부여한 ID로 링크 연결
        tocHtml += `<a href="#${h.id}" class="toc-${level}" onclick="event.preventDefault(); document.getElementById('${h.id}').scrollIntoView({behavior: 'smooth', block: 'center'});">${title}</a>`;
    });

    tocContainer.innerHTML = tocHtml;
    tocContainer.style.display = 'block';
};

// 헤더 스크롤 헬퍼 (마크다운 렌더링 방식에 따라 h 태그 찾기)
window.scrollToHeader = (txt) => {
    const headers = document.querySelectorAll('h1, h2, h3');
    for (let h of headers) {
        if (h.innerText.includes(txt)) {
            h.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
        }
    }
};

// ==========================================
// [신규 기능 3] 역링크 (Backlinks)
// ==========================================
window.loadBacklinks = async (currentTitle) => {
    const container = document.getElementById('backlinks-section');
    const list = document.getElementById('backlinks-list');

    // 'outgoingLinks' 배열에 현재 제목이 포함된 문서를 찾음
    try {
        const q = query(getWikiCollection(), where("outgoingLinks", "array-contains", currentTitle), limit(10));
        const snap = await getDocs(q);

        if (!snap.empty) {
            list.innerHTML = snap.docs.map(d => `<span class="backlink-item" onclick="router('${d.id}')"><i class="fa-solid fa-link"></i> ${d.id}</span>`).join('');
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
        }
    } catch (e) {
        // 기존 문서들은 outgoingLinks 필드가 없을 수 있으므로 에러 무시
        console.log("Backlink query skipped (requires index or new save)");
        container.classList.add('hidden');
    }
};

// ==========================================
// [신규 기능 4] 문서 정보 배지 & 파비콘
// ==========================================
window.updateDocStats = (text) => {
    const badges = document.getElementById('doc-badges');
    const charCount = text.length;
    const readTime = Math.ceil(charCount / 500); // 분당 500자 읽기 기준
    const hasImg = text.includes('[[사진:');
    const hasAudio = text.includes('[[오디오:');

    badges.innerHTML = `
        <span class="doc-badge"><i class="fa-solid fa-text-height"></i> ${charCount.toLocaleString()}자</span>
        <span class="doc-badge"><i class="fa-regular fa-clock"></i> 약 ${readTime}분</span>
        ${hasImg ? '<span class="doc-badge text-blue-500"><i class="fa-solid fa-image"></i> 이미지</span>' : ''}
        ${hasAudio ? '<span class="doc-badge text-purple-500"><i class="fa-solid fa-music"></i> 오디오</span>' : ''}
    `;
};

window.updateDynamicFavicon = () => {
    const link = document.querySelector("link[rel~='icon']");
    if (document.body.classList.contains('dark-mode')) {
        // 다크모드일 땐 로고 필터링 (예: 밝게) 혹은 다른 이미지
        // 여기서는 간단히 href를 유지하되, 필요시 교체 가능
        // link.href = '/logo-dark.png'; 
    } else {
        link.href = '/logo.png';
    }
};

// ==========================================
// [신규 기능] 집중 모드 (Zen Mode)
// ==========================================
window.toggleZenMode = () => {
    document.body.classList.toggle('zen-mode');
    const isZen = document.body.classList.contains('zen-mode');
    if (isZen) {
        window.showToast("집중 모드가 켜졌습니다. (ESC로 종료)");
    }
};

// 단축키 (ESC) 지원
document.addEventListener('keydown', (e) => {
    if (e.key === "Escape" && document.body.classList.contains('zen-mode')) {
        toggleZenMode();
    }
});



// ==========================================
// [신규 기능] 일일 퀘스트 시스템 (Daily Quest)
// ==========================================
let dailyQuest = { targetDoc: "", currentLen: 0, targetLen: 50, completed: false };

function initDailyQuest() {
    // 오늘 날짜를 시드(Seed)로 사용하여 매일 같은 문서가 선정되도록 함
    const today = new Date().toDateString();
    const savedQuest = JSON.parse(localStorage.getItem('mirr-quest'));

    // 이미 오늘 퀘스트 데이터가 있으면 로드
    if (savedQuest && savedQuest.date === today) {
        dailyQuest = savedQuest.data;
    } else {
        // 새로운 퀘스트 생성 (문서 목록이 로드된 후 실행)
        if (allDocTitles.length > 0) {
            // 날짜 기반 랜덤 인덱스 생성
            const seed = new Date().getDate() + new Date().getMonth();
            const target = allDocTitles[seed % allDocTitles.length];
            dailyQuest = { targetDoc: target, currentLen: 0, targetLen: 50, completed: false };
            localStorage.setItem('mirr-quest', JSON.stringify({ date: today, data: dailyQuest }));
        }
    }
    updateQuestUI();
}

function updateQuestUI() {
    const widget = document.getElementById('daily-quest-widget');
    if (!currentUser || !dailyQuest.targetDoc) {
        widget.classList.add('hidden');
        return;
    }

    widget.classList.remove('hidden');
    const desc = document.getElementById('quest-desc');
    const bar = document.getElementById('quest-bar');
    const status = document.getElementById('quest-status');

    if (dailyQuest.completed) {
        desc.innerHTML = `<span class="text-[#00a495]"><i class="fa-solid fa-crown"></i> 퀘스트 완료!</span>`;
        bar.style.width = "100%";
        bar.style.backgroundColor = "gold";
        status.innerText = "보상: 명예로운 뱃지 획득";
        // 뱃지 표시 로직
        document.querySelectorAll('.user-crown').forEach(el => el.style.display = 'inline-block');
    } else {
        desc.innerHTML = `'<span class="text-[#00a495]">${dailyQuest.targetDoc}</span>' 문서 기여하기`;
        const percent = Math.min((dailyQuest.currentLen / dailyQuest.targetLen) * 100, 100);
        bar.style.width = `${percent}%`;
        status.innerText = `${dailyQuest.currentLen} / ${dailyQuest.targetLen} 자 작성됨`;
    }
}

function checkQuestProgress(docTitle, contentLen) {
    if (dailyQuest.completed) return;
    if (docTitle === dailyQuest.targetDoc) {
        // 단순히 길이만 체크 (실제로는 diff를 체크해야 하지만 간소화)
        dailyQuest.currentLen = contentLen;
        if (dailyQuest.currentLen >= dailyQuest.targetLen) {
            dailyQuest.completed = true;
            window.showToast("👑 일일 퀘스트 완료! 뱃지를 획득했습니다!");
        }
        // 저장
        const today = new Date().toDateString();
        localStorage.setItem('mirr-quest', JSON.stringify({ date: today, data: dailyQuest }));
        updateQuestUI();
    }
}

// ==========================================
// [신규 기능] 기여 히트맵 (Contribution Graph)
// ==========================================
window.openProfileModal = async () => {
    if (!currentUser) return window.openAuthModal();

    const modal = document.getElementById('profileModal');
    modal.classList.remove('hidden');
    document.getElementById('profile-name').innerText = currentUser.email.split('@')[0];
    document.getElementById('profile-initial').innerText = currentUser.email[0].toUpperCase();

    const heatmap = document.getElementById('contribution-heatmap');
    heatmap.innerHTML = '<div class="text-center w-full col-span-10 py-10 text-gray-400">데이터 수집 중... (색인이 필요할 수 있음)</div>';

    try {
        // 1년치 데이터 생성 (빈 잔디)
        const contributions = {};
        const today = new Date();
        for (let i = 0; i < 365; i++) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            contributions[d.toISOString().split('T')[0]] = 0;
        }

        // Firestore 컬렉션 그룹 쿼리 (모든 history 컬렉션 검색)
        const q = query(collectionGroup(db, 'history'), where('editor', '==', currentUser.email));
        const snap = await getDocs(q);

        snap.forEach(doc => {
            const data = doc.data();
            if (data.timestamp) {
                const date = data.timestamp.toDate().toISOString().split('T')[0];
                if (contributions[date] !== undefined) contributions[date]++;
            }
        });

        // 렌더링
        heatmap.innerHTML = '';
        // 52주 x 7일 그리드로 정렬하려면 날짜 순서 뒤집기 필요
        const dates = Object.keys(contributions).sort(); // 오래된 순

        dates.forEach(date => {
            const count = contributions[date];
            const div = document.createElement('div');
            div.className = 'heatmap-day';
            div.title = `${date}: ${count} contributions`;

            if (count >= 10) div.classList.add('heatmap-level-4');
            else if (count >= 5) div.classList.add('heatmap-level-3');
            else if (count >= 3) div.classList.add('heatmap-level-2');
            else if (count >= 1) div.classList.add('heatmap-level-1');

            heatmap.appendChild(div);
        });

    } catch (e) {
        console.error(e);
        heatmap.innerHTML = `<div class="text-red-500 text-xs p-4">데이터를 불러오지 못했습니다.<br>관리자에게 '컬렉션 그룹 색인' 생성을 요청하세요.<br><br>Error: ${e.message}</div>`;
    }
};