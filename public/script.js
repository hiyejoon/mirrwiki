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
    appId: "1:154251618788:web:98594edc88afe64333bff1"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Constants & Variables ---
const ADMIN_EMAIL = "hl105sk@proton.me";
const appId = 'mirrwiki-default';
const KBASE_OFFSET = 44032;
const MARKER_KBASE = "갂";

let currentUser = null;
let currentDocId = "FrontPage";
let isEditing = false;
let allDocTitles = [];
let currentDocIsLocked = false;

// --- Firebase Collection Helpers ---
const getWikiCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'wiki_pages');
const getHistoryCollection = (docId) => collection(getWikiCollection(), docId, 'history');

// --- K-Base / Ascii85 Logic ---
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

// --- Navigation & Routing ---
window.router = (pageId) => {
    if (!pageId) pageId = "FrontPage";
    currentDocId = pageId;
    window.history.pushState({ page: pageId }, '', `/w/${encodeURIComponent(pageId)}`);
    fetchDocument(pageId);
    document.getElementById('mobileMenu').classList.add('hidden');
    document.getElementById('searchResults').classList.add('hidden');
};

async function fetchDocument(pageId) {
    currentDocId = pageId;
    const view = document.getElementById('viewMode');
    const titleDom = document.getElementById('docTitle');
    titleDom.innerText = pageId;
    document.title = `${pageId} - 미르위키`;
    view.innerHTML = '<div class="text-center p-10"><i class="fa-solid fa-spinner fa-spin text-2xl"></i></div>';
    isEditing = false;
    updateModeUI();

    try {
        const snap = await getDoc(doc(getWikiCollection(), pageId));
        if (snap.exists()) {
            const data = snap.data();
            currentDocIsLocked = data.isLocked || false;

            if (pageId.startsWith("사진:")) {
                const src = resolveMediaContent(data.content);
                view.innerHTML = `<img src="${src}" class="max-w-full">`;
            } else if (pageId.startsWith("오디오:")) {
                const src = resolveMediaContent(data.content, 'audio/mp3');
                view.innerHTML = `<audio controls src="${src}" class="w-full"></audio>`;
            } else {
                await renderContent(data.content);
            }
            document.getElementById('lastUpdated').innerText = `최근 수정: ${data.updatedAt?.toDate().toLocaleString() || '-'}`;
        } else {
            view.innerHTML = `<p class="py-10 text-center">'${pageId}' 문서가 없습니다.</p><button onclick="toggleEdit()" class="namu-btn mx-auto block">만들기</button>`;
        }
        renderToolbar();
    } catch (e) { view.innerHTML = "로드 실패"; }
}

async function renderContent(raw) {
    let text = raw;
    // [[Link]]
    text = text.replace(/\[\[([^\]]+)\]\]/g, (_, t) => `<a href="#" onclick="router('${t}')">${t}</a>`);
    // [* Footnote]
    let fnIdx = 0;
    text = text.replace(/\[\*\s(.*?)]/g, (_, c) => `<sup class="wiki-fn" onclick="toggleFootnote(this, '${encodeURIComponent(c)}')">[${++fnIdx}]</sup>`);

    document.getElementById('viewMode').innerHTML = marked.parse(text);
    if (window.renderMathInElement) renderMathInElement(document.getElementById('viewMode'), { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }] });
}

// --- Auth System ---
window.handleLogin = async () => {
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('emailInput').value, document.getElementById('passwordInput').value);
        window.closeAuthModal();
        showToast("로그인 성공");
    } catch (e) { alert("로그인 실패: " + e.message); }
};

window.handleSignup = async () => {
    try {
        await createUserWithEmailAndPassword(auth, document.getElementById('emailInput').value, document.getElementById('passwordInput').value);
        window.closeAuthModal();
        showToast("가입 성공");
    } catch (e) { alert("가입 실패: " + e.message); }
};

window.handleLogout = () => signOut(auth);

// --- Admin Features ---
window.toggleLock = async () => {
    if (currentUser.email !== ADMIN_EMAIL) return;
    const newStatus = !currentDocIsLocked;
    await updateDoc(doc(getWikiCollection(), currentDocId), { isLocked: newStatus });
    await addDoc(getHistoryCollection(currentDocId), { action: newStatus ? "🔒 잠금" : "🔓 해제", editor: currentUser.email, timestamp: serverTimestamp() });
    currentDocIsLocked = newStatus;
    fetchDocument(currentDocId);
};

// --- CRUD Operations ---
window.saveDocument = async () => {
    if (!currentUser) return window.openAuthModal();
    const content = document.getElementById('editorContent').value;
    await setDoc(doc(getWikiCollection(), currentDocId), { title: currentDocId, content, updatedAt: serverTimestamp(), updatedBy: currentUser.uid, isLocked: currentDocIsLocked });
    await addDoc(getHistoryCollection(currentDocId), { action: "수정", editor: currentUser.email, timestamp: serverTimestamp() });
    showToast("저장 완료");
    fetchDocument(currentDocId);
};

window.submitDeleteDoc = async () => {
    await deleteDoc(doc(getWikiCollection(), currentDocId));
    window.closeDeleteModal();
    window.router('FrontPage');
};

window.submitMoveDoc = async () => {
    const newTitle = document.getElementById('moveDocTitleInput').value.trim();
    if (!newTitle) return;
    const snap = await getDoc(doc(getWikiCollection(), currentDocId));
    await setDoc(doc(getWikiCollection(), newTitle), { ...snap.data(), title: newTitle });
    await deleteDoc(doc(getWikiCollection(), currentDocId));
    window.closeMoveModal();
    window.router(newTitle);
};

// --- Media Uploads ---
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
            const MAX = 800;
            let w = img.width, h = img.height;
            if (w > MAX) { h *= MAX / w; w = MAX; }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const content = canvas.toDataURL('image/webp', 0.7);
            await setDoc(doc(getWikiCollection(), "사진:" + name), { title: "사진:" + name, content, updatedAt: serverTimestamp() });
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
        const content = `data:${file.type};kbase,${encoded}`;
        await setDoc(doc(getWikiCollection(), "오디오:" + name), { title: "오디오:" + name, content, updatedAt: serverTimestamp() });
        window.closeAudioUploadModal();
        window.router("오디오:" + name);
    };
};

// --- UI Helpers ---
window.openHistoryModal = async () => {
    document.getElementById('historyDocTitle').innerText = currentDocId;
    const list = document.getElementById('historyList');
    list.innerHTML = '로딩 중...';
    document.getElementById('historyModal').classList.remove('hidden');
    const snap = await getDocs(query(getHistoryCollection(currentDocId), orderBy("timestamp", "desc"), limit(20)));
    list.innerHTML = snap.empty ? '기록 없음' : '';
    snap.forEach(d => {
        const v = d.data();
        list.innerHTML += `<tr class="border-b"><td class="p-2">${v.timestamp?.toDate().toLocaleString() || '-'}</td><td class="p-2">${v.editor}</td><td class="p-2">${v.action}</td></tr>`;
    });
};

function renderToolbar() {
    const container = document.getElementById('toolbarButtons');
    const isAdmin = currentUser && currentUser.email === ADMIN_EMAIL;
    let html = `<button onclick="openHistoryModal()" class="text-xs border px-2 py-1 rounded">역사</button>`;
    if (!currentDocIsLocked || isAdmin) {
        html += `<button onclick="toggleEdit()" class="text-xs border px-2 py-1 rounded">편집</button>`;
        html += `<button onclick="openMoveModal()" class="text-xs border px-2 py-1 rounded"><i class="fa-solid fa-arrows-rotate"></i></button>`;
        html += `<button onclick="openDeleteModal()" class="text-xs border px-2 py-1 rounded text-red-500"><i class="fa-solid fa-trash"></i></button>`;
    }
    if (isAdmin) {
        html += `<button onclick="toggleLock()" class="text-xs border px-2 py-1 rounded font-bold text-red-600">${currentDocIsLocked ? '🔓' : '🔒'}</button>`;
    }
    container.innerHTML = html;
}

window.toggleFootnote = (el, enc) => {
    const pop = document.getElementById('fnPopover');
    if (pop.style.display === 'block') { pop.style.display = 'none'; return; }
    document.getElementById('fnPopoverContent').innerHTML = marked.parse(decodeURIComponent(enc));
    pop.style.display = 'block';
    const rect = el.getBoundingClientRect();
    pop.style.top = (rect.bottom + window.scrollY + 5) + 'px';
    pop.style.left = rect.left + 'px';
};

// --- Initialize ---
onAuthStateChanged(auth, user => {
    currentUser = user;
    const authSec = document.getElementById('desktopAuthSection');
    if (user) {
        authSec.innerHTML = `<button onclick="handleLogout()" class="text-xs bg-teal-700 px-2 py-1 rounded text-white">${user.email.split('@')[0]}</button>`;
        document.getElementById('mobileAuthItem').innerText = "로그아웃 (" + user.email.split('@')[0] + ")";
    } else {
        authSec.innerHTML = `<button onclick="openAuthModal()" class="text-xs border px-2 py-1 rounded">로그인</button>`;
        document.getElementById('mobileAuthItem').innerText = "로그인 / 가입";
    }
    loadRecentChanges();
    loadAllTitles();
    loadPageFromUrl();
});

function loadPageFromUrl() {
    const path = window.location.pathname;
    const page = path.startsWith('/w/') ? decodeURIComponent(path.substring(3)) : "FrontPage";
    fetchDocument(page);
}

function loadRecentChanges() {
    onSnapshot(query(getWikiCollection(), orderBy("updatedAt", "desc"), limit(10)), s => {
        document.getElementById('recentList').innerHTML = s.docs.map(d => `<li class="p-2 cursor-pointer hover:bg-gray-50" onclick="router('${d.id}')">${d.id}</li>`).join('');
    });
}

async function loadAllTitles() {
    const s = await getDocs(query(getWikiCollection(), limit(500)));
    allDocTitles = s.docs.map(d => d.id);
}

// --- Search & Utils ---
window.handleSearch = () => {
    const v = document.getElementById('searchInput').value.trim();
    if (v) window.router(v);
};

window.handleRandom = () => {
    if (allDocTitles.length) window.router(allDocTitles[Math.floor(Math.random() * allDocTitles.length)]);
};

window.showAllDocuments = () => {
    const list = [...allDocTitles].sort();
    document.getElementById('docTitle').innerText = "전체 문서 목록";
    document.getElementById('viewMode').innerHTML = `<div class="grid grid-cols-2 gap-2">${list.map(t => `<div class="p-2 border rounded cursor-pointer hover:bg-gray-50" onclick="router('${t}')">${t}</div>`).join('')}</div>`;
};

// --- Modal Controls (Window Mapping) ---
window.openAuthModal = () => document.getElementById('authModal').classList.remove('hidden');
window.closeAuthModal = () => document.getElementById('authModal').classList.add('hidden');
window.openNewDocModal = () => document.getElementById('newDocModal').classList.remove('hidden');
window.closeNewDocModal = () => document.getElementById('newDocModal').classList.add('hidden');
window.openImageUploadModal = () => document.getElementById('imageUploadModal').classList.remove('hidden');
window.closeImageUploadModal = () => document.getElementById('imageUploadModal').classList.add('hidden');
window.openAudioUploadModal = () => document.getElementById('audioUploadModal').classList.remove('hidden');
window.closeAudioUploadModal = () => document.getElementById('audioUploadModal').classList.add('hidden');
window.openMoveModal = () => {
    document.getElementById('moveDocTitleInput').value = currentDocId;
    document.getElementById('moveDocModal').classList.remove('hidden');
};
window.closeMoveModal = () => document.getElementById('moveDocModal').classList.add('hidden');
window.openDeleteModal = () => {
    document.getElementById('deleteTargetTitle').innerText = currentDocId;
    document.getElementById('deleteDocModal').classList.remove('hidden');
};
window.closeDeleteModal = () => document.getElementById('deleteDocModal').classList.add('hidden');
window.toggleMobileMenu = () => document.getElementById('mobileMenu').classList.toggle('hidden');
window.showToast = (m) => {
    const t = document.getElementById('toast');
    t.innerText = m; t.classList.remove('translate-y-20');
    setTimeout(() => t.classList.add('translate-y-20'), 3000);
};

window.toggleEdit = async () => {
    if (!currentUser) return window.openAuthModal();
    if (currentDocIsLocked && currentUser.email !== ADMIN_EMAIL) return alert("문서가 잠겨있습니다.");
    isEditing = !isEditing;
    if (isEditing) {
        const snap = await getDoc(doc(getWikiCollection(), currentDocId));
        document.getElementById('editorContent').value = snap.exists() ? snap.data().content : "";
    }
    updateModeUI();
};
window.cancelEdit = () => { isEditing = false; updateModeUI(); };
function updateModeUI() {
    document.getElementById('viewMode').classList.toggle('hidden', isEditing);
    document.getElementById('editMode').classList.toggle('hidden', !isEditing);
}

window.createNewDoc = () => {
    const t = document.getElementById('newDocTitleInput').value.trim();
    if (t) { window.router(t); window.closeNewDocModal(); }
};

window.onpopstate = (e) => loadPageFromUrl();