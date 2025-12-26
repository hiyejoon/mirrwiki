import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

// --- Firebase Config (User's Project) ---
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

// --- 환경 변수 및 원본 경로 복구 ---
const ADMIN_EMAIL = "hl105sk@proton.me";
const appId = 'mirrwiki-default'; // [중요] 기존 데이터의 appId
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

// --- K-Base 인코딩 시스템 (원본 보존) ---
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

// --- 라우팅 시스템 ---
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
    titleDom.innerText = pageId;
    document.title = `${pageId} - 미르위키`;
    view.innerHTML = '<div class="text-center p-20 py-40"><i class="fa-solid fa-dragon fa-spin text-5xl text-[#00a495]"></i><p class="mt-6 text-gray-400 font-bold tracking-widest animate-pulse">CHRONICLE LOADING...</p></div>';

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
                view.innerHTML = `<div class="flex flex-col items-center"><img src="${src}" class="max-w-full rounded-2xl shadow-2xl"></div>`;
            } else if (pageId.startsWith("오디오:")) {
                const src = resolveMediaContent(data.content, 'audio/mp3');
                view.innerHTML = `<div class="bg-gray-100 dark:bg-white/5 p-12 rounded-3xl text-center border-2 border-dashed border-gray-200 dark:border-white/10"><i class="fa-solid fa-compact-disc fa-spin text-6xl mb-6 text-[#00a495]"></i><audio controls src="${src}" class="w-full"></audio></div>`;
            } else {
                await renderContent(data.content);
                if (data.content.length > 50) suggestAI(data.content);
            }
            document.getElementById('lastUpdated').innerText = `LAST ARCHIVED: ${data.updatedAt?.toDate().toLocaleString() || 'ANCIENT'}`;
        } else {
            view.innerHTML = `<div class="text-center py-24"><i class="fa-solid fa-wind text-7xl text-gray-100 mb-8"></i><p class="text-gray-400 mb-10 text-lg">기록되지 않은 지식의 파편입니다.</p><button onclick="toggleEdit()" class="namu-btn px-12 py-4">지식 각인하기</button></div>`;
            currentDocIsLocked = false;
        }
        renderToolbar();
    } catch (e) {
        console.error(e);
        view.innerHTML = `<div class="p-10 card border-red-500/20 bg-red-50 dark:bg-red-950/20 text-red-500 text-center"><i class="fa-solid fa-triangle-exclamation text-3xl mb-4"></i><p class="font-bold">데이터 링크 단절</p><p class="text-xs mt-2">${e.message}</p></div>`;
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
// [신규] TensorFlow.js AI 추천 엔진
// ==========================================
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
            let dot = 0, mA = 0, mB = 0;
            for (let j = 0; j < vectors[0].length; j++) {
                dot += vectors[0][j] * vectors[i][j]; mA += vectors[0][j] * vectors[0][j]; mB += vectors[i][j] * vectors[i][j];
            }
            scores.push({ title: samples[i - 1], score: dot / (Math.sqrt(mA) * Math.sqrt(mB)) });
        }

        scores.sort((a, b) => b.score - a.score);
        recList.innerHTML = scores.slice(0, 2).map(s => `
            <div onclick="router('${s.title}')" class="ai-recommendation-card flex items-center justify-between">
                <div>
                    <div class="text-[9px] text-[#00a495] font-black uppercase tracking-tighter">AI Match ${Math.round(s.score * 100)}%</div>
                    <div class="font-bold text-sm">${s.title}</div>
                </div>
                <i class="fa-solid fa-arrow-right-long text-[#00a495]/30"></i>
            </div>
        `).join('');
        recSection.classList.remove('hidden');
    } catch (e) { console.warn("AI Load Skipped"); }
}

// ==========================================
// [신규] Obsidian 스타일 그래프 뷰 최적화
// ==========================================
window.openGraphModal = async () => {
    document.getElementById('graphModal').classList.remove('hidden');
    const container = document.getElementById('graph-canvas');

    // 데이터 준비
    const nodes = allDocTitles.map(t => ({
        id: t,
        name: t,
        group: t.includes(':') ? 2 : 1,
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

    const isDark = document.body.classList.contains('dark-mode');

    const Graph = ForceGraph()(container)
        .graphData({ nodes, links })
        .nodeLabel('name')
        .nodeRelSize(6)
        .nodeAutoColorBy('group')
        .linkColor(() => isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)')
        .backgroundColor(isDark ? '#111' : '#f9f9f9')
        .onNodeClick(node => {
            document.getElementById('graphModal').classList.add('hidden');
            window.router(node.id);
        })
        .nodeCanvasObject((node, ctx, globalScale) => {
            // 옵시디언 스타일 노드 렌더링
            const label = node.name;
            const fontSize = 12 / globalScale;
            ctx.font = `${fontSize}px Sans-Serif`;
            const textWidth = ctx.measureText(label).width;
            const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);

            // 노드 원 그리기
            ctx.beginPath();
            ctx.arc(node.x, node.y, 4, 0, 2 * Math.PI, false);
            ctx.fillStyle = node.color;
            ctx.fill();

            // 확대 시 라벨 표시
            if (globalScale > 1.5) {
                ctx.fillStyle = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
                ctx.fillText(label, node.x - textWidth / 2, node.y + 10);
            }
        });

    // 물리 엔진 튜닝 (옵시디언 느낌)
    Graph.d3Force('charge').strength(-150);
    Graph.d3Force('center').x(0).y(0);
};

// --- CRUD 및 문서 작업 ---
window.saveDocument = async () => {
    if (!currentUser) return window.openAuthModal();
    const content = document.getElementById('editorContent').value;
    const btn = document.getElementById('saveBtn');
    btn.disabled = true; btn.innerText = "전송 중...";

    try {
        await setDoc(doc(getWikiCollection(), currentDocId), {
            title: currentDocId, content, updatedAt: serverTimestamp(), updatedBy: currentUser.uid, isLocked: currentDocIsLocked
        });
        await addDoc(getHistoryCollection(currentDocId), { action: "EDIT", editor: currentUser.email, timestamp: serverTimestamp() });
        window.showToast("지식이 안전하게 보존되었습니다.");
        fetchDocument(currentDocId);
    } catch (e) { alert("저장 권한이 없습니다."); }
    finally { btn.disabled = false; btn.innerText = "지식 보존하기"; }
};

window.submitDeleteDoc = async () => {
    try {
        await deleteDoc(doc(getWikiCollection(), currentDocId));
        window.closeDeleteModal();
        window.showToast("지식의 조각이 말소되었습니다.");
        window.router('FrontPage');
    } catch (e) { alert("삭제 실패"); }
};

window.submitMoveDoc = async () => {
    const newT = document.getElementById('moveDocTitleInput').value.trim();
    if (!newT) return;
    try {
        const oldS = await getDoc(doc(getWikiCollection(), currentDocId));
        await setDoc(doc(getWikiCollection(), newT), { ...oldS.data(), title: newT });
        await deleteDoc(doc(getWikiCollection(), currentDocId));
        window.closeMoveModal();
        window.router(newT);
    } catch (e) { alert("이동 실패"); }
};

// --- 미디어 업로드 ---
window.submitImageUpload = async () => {
    const file = document.getElementById('imgFileInput').files[0];
    const name = document.getElementById('imgTitleInput').value.trim();
    if (!file || !name) return;
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
        const img = new Image();
        img.src = e.target.result;
        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const MAX = 800; let w = img.width, h = img.height;
            if (w > MAX) { h *= MAX / w; w = MAX; }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const content = canvas.toDataURL('image/webp', 0.8);
            await setDoc(doc(getWikiCollection(), "사진:" + name), { title: "사진:" + name, content, updatedAt: serverTimestamp() });
            window.showToast("이미지가 각인되었습니다.");
            window.closeImageUploadModal();
            window.router("사진:" + name);
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
        window.showToast("오디오가 각인되었습니다.");
        window.closeAudioUploadModal();
        window.router("오디오:" + name);
    };
};

// --- 다크 모드 제어 ---
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

// --- 초기화 및 인증 ---
onAuthStateChanged(auth, user => {
    currentUser = user;
    const authSec = document.getElementById('desktopAuthSection');
    if (user) {
        authSec.innerHTML = `<button onclick="handleLogout()" class="bg-[#008b7d] px-4 py-1 rounded-full text-white font-black text-[10px] uppercase border-2 border-white/20">${user.email.split('@')[0]}</button>`;
        document.getElementById('mobileAuthItem').innerText = `SIGN OUT (${user.email.split('@')[0]})`;
    } else {
        authSec.innerHTML = `<button onclick="openAuthModal()" class="text-[10px] font-black tracking-widest border-2 border-white px-4 py-1 rounded-full">JOIN / LOGIN</button>`;
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
            <li class="p-4 cursor-pointer hover:bg-teal-50 dark:hover:bg-white/5 transition-all border-b last:border-0" onclick="router('${d.id}')">
                <div class="font-bold text-gray-700 dark:text-gray-200 truncate mb-1">${d.id}</div>
                <div class="text-[9px] text-gray-400 font-mono">${d.data().updatedAt?.toDate().toLocaleString() || '-'}</div>
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
    const isAdmin = currentUser && currentUser.email === ADMIN_EMAIL;
    bar.innerHTML = `
        <button onclick="openHistoryModal()" class="text-[10px] font-bold border px-3 py-1 rounded-lg hover:bg-gray-50">HISTORY</button>
        <button onclick="toggleEdit()" class="text-[10px] font-bold border px-3 py-1 rounded-lg hover:bg-gray-50">EDIT</button>
        <button onclick="openMoveModal()" class="text-[10px] border px-2 py-1 rounded-lg"><i class="fa-solid fa-arrows-rotate"></i></button>
        <button onclick="openDeleteModal()" class="text-[10px] border px-2 py-1 rounded-lg text-red-500"><i class="fa-solid fa-trash"></i></button>
    `;
}

// UI Helpers
window.handleSearch = () => { const v = document.getElementById('searchInput').value.trim(); if (v) window.router(v); };
window.handleRandom = () => { if (allDocTitles.length) window.router(allDocTitles[Math.floor(Math.random() * allDocTitles.length)]); };
window.showAllDocuments = () => {
    document.getElementById('docTitle').innerText = "ARCHIVE LIST";
    document.getElementById('viewMode').innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">${allDocTitles.sort().map(t => `<div class="p-4 card cursor-pointer hover:border-[#00a495] font-bold" onclick="router('${t}')">${t}</div>`).join('')}</div>`;
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
window.showToast = (m) => { const t = document.getElementById('toast'); t.innerHTML = `<i class="fa-solid fa-circle-check text-[#00a495]"></i> ${m}`; t.classList.remove('translate-y-40'); setTimeout(() => t.classList.add('translate-y-40'), 3500); };

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
    const list = document.getElementById('historyList'); list.innerHTML = '<tr><td colspan="3" class="p-10 text-center animate-pulse">CHRONICLE SYNCING...</td></tr>';
    document.getElementById('historyModal').classList.remove('hidden');
    try {
        const snap = await getDocs(query(getHistoryCollection(currentDocId), orderBy("timestamp", "desc"), limit(25)));
        list.innerHTML = snap.docs.map(d => `<tr class="border-b"><td class="p-4 text-[10px] font-mono">${d.data().timestamp?.toDate().toLocaleString() || '-'}</td><td class="p-4 font-bold text-xs">${d.data().editor.split('@')[0]}</td><td class="p-4 text-xs tracking-tighter">${d.data().action}</td></tr>`).join('');
    } catch (e) { list.innerHTML = '<tr><td colspan="3" class="p-10 text-center text-gray-400">최초의 기록입니다.</td></tr>'; }
};

window.handleLogin = async () => { try { await signInWithEmailAndPassword(auth, document.getElementById('emailInput').value, document.getElementById('passwordInput').value); window.closeAuthModal(); window.showToast("ARCHIVE ACCESS GRANTED"); } catch (e) { alert("ACCESS DENIED"); } };
window.handleSignup = async () => { try { await createUserWithEmailAndPassword(auth, document.getElementById('emailInput').value, document.getElementById('passwordInput').value); window.closeAuthModal(); window.showToast("NEW CONTRIBUTOR REGISTERED"); } catch (e) { alert("REGISTRATION FAILED"); } };
window.handleLogout = () => signOut(auth);
window.onpopstate = (e) => loadPageFromUrl();
window.createNewDoc = () => { const t = document.getElementById('newDocTitleInput').value.trim(); if (t) { window.router(t); window.closeNewDocModal(); } };

// 테마 유지
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');
updateThemeIcon();

window.onscroll = () => { const h = document.documentElement.scrollHeight - document.documentElement.clientHeight; document.getElementById("progress-bar").style.width = (window.scrollY / h * 100) + "%"; };

window.toggleFootnote = (el, enc) => {
    const pop = document.getElementById('fnPopover'); if (pop.style.display === 'block') { pop.style.display = 'none'; return; }
    document.getElementById('fnPopoverContent').innerHTML = marked.parse(decodeURIComponent(enc));
    pop.style.display = 'block'; const rect = el.getBoundingClientRect();
    pop.style.top = (rect.bottom + window.scrollY + 8) + 'px'; pop.style.left = Math.min(rect.left, window.innerWidth - 320) + 'px';
};