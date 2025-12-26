// 🚩 새로운 Firebase SDK 버전 (12.6.0) 및 설정으로 변경됨
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-analytics.js";

// 기존 Firebase SDK (인증, Firestore)도 12.6.0 버전으로 통일합니다.
import { getAuth, signInWithCustomToken, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

        // Configuration
        const ADMIN_EMAIL = "hl105sk@proton.me"; // 이메일은 유지
        
        // 🚩 사용자 요청에 따라 새로운 Firebase 설정 반영
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
        const analytics = getAnalytics(app); // 🚩 Analytics 초기화 추가
        const auth = getAuth(app);
        const db = getFirestore(app);

        let currentUser = null;
        let currentDocId = "FrontPage";
        let isEditing = false;
        let allDocTitles = []; 
        let currentDocIsLocked = false; 

        const appId = typeof __app_id !== 'undefined' ? __app_id : 'mirrwiki-default';
        const getWikiCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'wiki_pages');
        const getHistoryCollection = (docId) => collection(db, 'artifacts', appId, 'public', 'data', 'wiki_pages', docId, 'history');

        // --- DECODING/ENCODING LOGIC (K-Base / Ascii85) ---
        const KBASE_OFFSET = 44032; 
        const MARKER_KBASE = "갂"; 
        const MARKER_A85_S = "<~";
        const MARKER_A85_E = "~>";

        // K-Base Encoder (Uint8Array -> String)
        function kBaseEncode(u8) {
            let res = "";
            const len = u8.length;
            for (let i = 0; i < len; i += 3) {
                const b0 = u8[i];
                const b1 = (i + 1 < len) ? u8[i + 1] : 0;
                const b2 = (i + 2 < len) ? u8[i + 2] : 0;
                
                const val = (b0 << 16) | (b1 << 8) | b2;
                
                const c1 = (val >> 12) & 0xFFF;
                const c2 = val & 0xFFF;
                
                res += String.fromCharCode(KBASE_OFFSET + c1);
                res += String.fromCharCode(KBASE_OFFSET + c2);
            }
            return MARKER_KBASE + res;
        }

        function kBaseDecode(str) {
            if (str.startsWith(MARKER_KBASE)) str = str.substring(1);
            const len = str.length;
            const buf = [];
            for (let i = 0; i < len; i += 2) {
                const c1 = str.charCodeAt(i) - KBASE_OFFSET;
                const c2 = (i + 1 < len) ? (str.charCodeAt(i + 1) - KBASE_OFFSET) : 0;
                const val = (c1 << 12) | c2;
                buf.push((val >> 16) & 0xFF);
                buf.push((val >> 8) & 0xFF);
                buf.push(val & 0xFF);
            }
            return new Uint8Array(buf);
        }

        function ascii85Decode(str) {
            let s = str.replace(/<~/g,"").replace(/~>/g,"").replace(/\s/g,"");
            let exp = "";
            for(let i=0; i<s.length; i++) exp += (s[i]==='z')?"!!!!!":s[i];
            s = exp;
            const pad = (5 - (s.length % 5)) % 5;
            if(pad>0) s += "u".repeat(pad);
            const buf = new Uint8Array((s.length/5)*4);
            let idx = 0;
            for(let i=0; i<s.length; i+=5) {
                let acc = 0;
                for(let j=0; j<5; j++) acc = acc*85 + (s.charCodeAt(i+j)-33);
                buf[idx++] = (acc >>> 24) & 0xFF;
                buf[idx++] = (acc >>> 16) & 0xFF;
                buf[idx++] = (acc >>> 8) & 0xFF;
                buf[idx++] = acc & 0xFF;
            }
            return buf.slice(0, buf.length - pad);
        }

        // Resolves content to Blob URL (Image or Audio)
        function resolveMediaContent(content, mimeTypePrefix = 'image/webp') {
            if (!content) return null;
            content = content.trim();

            try {
                let u8;
                // 1. K-Base
                if (content.startsWith(MARKER_KBASE) || content.includes("kbase,")) {
                    let clean = content;
                    if(content.includes("kbase,")) clean = content.split("kbase,")[1];
                    u8 = kBaseDecode(clean);
                }
                // 2. Ascii85
                else if (content.startsWith(MARKER_A85_S) || content.includes("ascii85,")) {
                    let clean = content;
                    if(content.includes("ascii85,")) clean = content.split("ascii85,")[1];
                    u8 = ascii85Decode(clean);
                }
                // 3. Data URI (Base64) - handled natively by browser usually, but here we might want to ensure it works
                else if (content.startsWith("data:")) {
                    return content;
                }
                // 4. Raw Base64
                else {
                    return `data:${mimeTypePrefix};base64,${content}`;
                }

                if (u8) {
                    // Try to guess mime if not provided or just use prefix
                    // If content has a header like "data:audio/mp3;kbase,...", extract mime
                    let finalMime = mimeTypePrefix;
                    if (content.startsWith("data:")) {
                        const matches = content.match(/data:(.*?);/);
                        if(matches && matches[1]) finalMime = matches[1];
                    }
                    
                    const blob = new Blob([u8], {type: finalMime});
                    return URL.createObjectURL(blob);
                }

            } catch (e) {
                console.error("Media decode error", e);
                return null;
            }
            return null;
        }

        // DOM Elements
        const dom = {
            docTitle: document.getElementById('docTitle'), lockIcon: document.getElementById('lockIcon'),
            toolbarButtons: document.getElementById('toolbarButtons'),
            viewMode: document.getElementById('viewMode'), editMode: document.getElementById('editMode'),
            editorContent: document.getElementById('editorContent'), lastUpdated: document.getElementById('lastUpdated'), editBtn: document.getElementById('editBtn'),
            desktopAuthSection: document.getElementById('desktopAuthSection'), mobileAuthItem: document.getElementById('mobileAuthItem'),
            authModal: document.getElementById('authModal'), emailInput: document.getElementById('emailInput'), passwordInput: document.getElementById('passwordInput'),
            mobileMenu: document.getElementById('mobileMenu'), recentList: document.getElementById('recentList'),
            searchInput: document.getElementById('searchInput'), searchResults: document.getElementById('searchResults'),
            newDocModal: document.getElementById('newDocModal'), newDocTitleInput: document.getElementById('newDocTitleInput'),
            moveDocModal: document.getElementById('moveDocModal'), moveDocTitleInput: document.getElementById('moveDocTitleInput'),
            deleteDocModal: document.getElementById('deleteDocModal'), deleteTargetTitle: document.getElementById('deleteTargetTitle'),
            historyModal: document.getElementById('historyModal'), historyDocTitle: document.getElementById('historyDocTitle'), historyList: document.getElementById('historyList'),
            fnPopover: document.getElementById('fnPopover'), fnPopoverContent: document.getElementById('fnPopoverContent'),
            // Image Upload
            imageUploadModal: document.getElementById('imageUploadModal'), imgTitleInput: document.getElementById('imgTitleInput'), imgFileInput: document.getElementById('imgFileInput'), imgUploadBtn: document.getElementById('imgUploadBtn'),
            // Audio Upload
            audioUploadModal: document.getElementById('audioUploadModal'), audioTitleInput: document.getElementById('audioTitleInput'), audioFileInput: document.getElementById('audioFileInput'), audioUploadBtn: document.getElementById('audioUploadBtn')
        };

        // --- Admin & Logic ---
        function checkIsAdmin() { return currentUser && currentUser.email === ADMIN_EMAIL; }

        window.toggleLock = async () => {
            if (!checkIsAdmin()) return showToast("관리자 권한이 필요합니다.");
            try {
                const newStatus = !currentDocIsLocked;
                const docRef = doc(getWikiCollection(), currentDocId);
                const docSnap = await getDoc(docRef);
                if(!docSnap.exists()) {
                    await setDoc(docRef, { title: currentDocId, content: "", isLocked: newStatus, updatedAt: serverTimestamp() });
                } else {
                    await updateDoc(docRef, { isLocked: newStatus });
                }
                await addDoc(getHistoryCollection(currentDocId), { editor: currentUser.email, timestamp: serverTimestamp(), action: newStatus ? "🔒 문서 잠금" : "🔓 잠금 해제" });
                currentDocIsLocked = newStatus;
                showToast(newStatus ? "문서를 잠갔습니다." : "잠금을 해제했습니다.");
                renderToolbar();
            } catch (e) { handleError(e, "잠금 상태 변경"); }
        };

        function renderToolbar() {
            const isAdmin = checkIsAdmin();
            const isLocked = currentDocIsLocked;
            const isImage = currentDocId.startsWith("사진:");
            const isAudio = currentDocId.startsWith("오디오:");
            
            if (isLocked) dom.lockIcon.classList.remove('hidden'); else dom.lockIcon.classList.add('hidden');

            let btnsHtml = `
                <button onclick="openHistoryModal()" class="text-sm border border-gray-300 px-2 md:px-3 py-1 rounded hover:bg-gray-50 text-gray-600" title="문서 역사">
                    <i class="fa-solid fa-clock-rotate-left"></i> <span class="hidden sm:inline">역사</span>
                </button>
            `;

            if (isAdmin) {
                const lockIcon = isLocked ? '<i class="fa-solid fa-lock-open"></i>' : '<i class="fa-solid fa-lock"></i>';
                btnsHtml += `<button onclick="toggleLock()" class="text-sm border border-gray-300 px-2 md:px-3 py-1 rounded hover:bg-red-50 text-red-600 font-bold">${lockIcon}</button>`;
            }

            if (!isLocked || isAdmin) {
                btnsHtml += `
                    <button onclick="openMoveModal()" class="text-sm border border-gray-300 px-2 md:px-3 py-1 rounded hover:bg-gray-50 text-gray-600"><i class="fa-solid fa-arrow-right-arrow-left"></i></button>
                    <button onclick="openDeleteModal()" class="text-sm border border-gray-300 px-2 md:px-3 py-1 rounded hover:bg-red-50 text-red-600"><i class="fa-solid fa-trash"></i></button>
                    <div class="w-px bg-gray-300 mx-1 h-6 self-center"></div>
                `;
                btnsHtml += `
                    <button onclick="toggleEdit()" id="editBtn" class="text-sm border border-gray-300 px-2 md:px-3 py-1 rounded hover:bg-gray-50">
                        <i class="fa-solid fa-pen"></i> 편집
                    </button>
                `;
            } else {
                btnsHtml += `
                    <div class="w-px bg-gray-300 mx-1 h-6 self-center"></div>
                    <span class="text-xs text-gray-400 flex items-center gap-1 px-2 cursor-not-allowed"><i class="fa-solid fa-lock"></i> 편집 불가</span>
                `;
            }
            
             btnsHtml += `<button onclick="router('FrontPage')" class="text-sm border border-gray-300 px-2 md:px-3 py-1 rounded hover:bg-gray-50 ml-auto"><i class="fa-solid fa-house"></i></button>`;

            dom.toolbarButtons.innerHTML = btnsHtml;
            if(document.getElementById('editBtn')) dom.editBtn = document.getElementById('editBtn');
        }

        function requireLogin() {
            if (!currentUser) { showToast("로그인이 필요합니다!"); openAuthModal(); return true; }
            return false;
        }

        function isActionBlocked() {
            if (currentDocIsLocked && !checkIsAdmin()) { showToast("이 문서는 관리자에 의해 잠겨있습니다."); return true; }
            return false;
        }

        // --- Footnote Logic ---
        window.toggleFootnote = (el, encodedContent) => {
            const content = decodeURIComponent(encodedContent);
            const popover = dom.fnPopover;
            if (popover.style.display === 'block' && popover.dataset.activeFn === el.innerText) {
                popover.style.display = 'none'; popover.dataset.activeFn = ''; return;
            }
            if (typeof marked !== 'undefined' && marked.parse) {
                dom.fnPopoverContent.innerHTML = marked.parse(content);
            } else {
                dom.fnPopoverContent.innerText = content;
            }
            popover.style.display = 'block';
            popover.dataset.activeFn = el.innerText;
            const rect = el.getBoundingClientRect();
            const st = window.pageYOffset || document.documentElement.scrollTop;
            let top = rect.bottom + st + 8;
            let left = rect.left + (window.pageXOffset || document.documentElement.scrollLeft);
            if (left + 250 > window.innerWidth) left = window.innerWidth - 260;
            popover.style.top = `${top}px`; popover.style.left = `${left}px`;
        };
        document.addEventListener('click', (e) => {
            if (!e.target.classList.contains('wiki-fn') && !dom.fnPopover.contains(e.target)) {
                dom.fnPopover.style.display = 'none'; dom.fnPopover.dataset.activeFn = '';
            }
        });

        // --- Auth & Init ---
        window.toggleMobileMenu = () => dom.mobileMenu.classList.toggle('hidden');
        window.handleMobileAuthClick = () => { toggleMobileMenu(); if (currentUser) handleLogout(); else openAuthModal(); };

        async function initAuth() {
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                try { await signInWithCustomToken(auth, __initial_auth_token); } catch (e) {}
            }
        }

        onAuthStateChanged(auth, (user) => {
            currentUser = user;
            updateAuthUI();
            loadRecentChanges(); 
            loadPageFromUrl();   
            loadAllTitlesForSearch(); 
        });

        function updateAuthUI() {
            if (currentUser) {
                const displayEmail = currentUser.email ? currentUser.email.split('@')[0] : '사용자';
                dom.desktopAuthSection.innerHTML = `<button onclick="handleLogout()" class="bg-[#008b7d] hover:bg-[#00756a] text-white px-3 py-1 rounded text-xs"><i class="fa-solid fa-user"></i> ${displayEmail}</button>`;
                dom.mobileAuthItem.innerHTML = `<i class="fa-solid fa-right-from-bracket w-5 text-center text-[#00a495]"></i> 로그아웃 (${displayEmail})`;
            } else {
                dom.desktopAuthSection.innerHTML = `<button onclick="openAuthModal()" class="bg-white text-[#00a495] px-3 py-1 rounded font-bold hover:bg-gray-100 text-xs border border-[#00a495]"><i class="fa-solid fa-right-to-bracket"></i> 로그인</button>`;
                dom.mobileAuthItem.innerHTML = `<i class="fa-solid fa-right-to-bracket w-5 text-center text-[#00a495]"></i> 로그인`;
            }
            renderToolbar();
        }

        window.openAuthModal = () => { dom.authModal.classList.remove('hidden'); dom.emailInput.focus(); };
        window.closeAuthModal = () => { dom.authModal.classList.add('hidden'); dom.emailInput.value = ''; dom.passwordInput.value = ''; };
        window.handleLogin = async () => {
            const email = dom.emailInput.value; const password = dom.passwordInput.value;
            if(!email || !password) return showToast("입력 확인");
            try { await signInWithEmailAndPassword(auth, email, password); closeAuthModal(); showToast("로그인 성공"); } 
            catch (e) { handleError(e, "로그인"); }
        };
        window.handleSignup = async () => {
            const email = dom.emailInput.value; const password = dom.passwordInput.value;
            if(!email || !password) return showToast("입력 확인");
            try { await createUserWithEmailAndPassword(auth, email, password); closeAuthModal(); showToast("가입 성공"); } 
            catch (e) { handleError(e, "가입"); }
        };
        window.handleLogout = async () => {
            try { await signOut(auth); showToast("로그아웃"); if(isEditing) { isEditing = false; updateViewMode(); } } catch(e){}
        };

        // --- View Logic ---
        window.showAllDocuments = () => {
            currentDocId = "전체 문서 목록";
            dom.docTitle.innerText = currentDocId;
            dom.lastUpdated.innerText = "";
            currentDocIsLocked = false;
            renderToolbar();
            isEditing = false;
            updateViewMode();
            if (allDocTitles.length === 0) { dom.viewMode.innerHTML = '<p class="text-gray-500 p-4">문서가 없거나 로딩 중입니다.</p>'; return; }
            const sorted = [...allDocTitles].sort((a, b) => a.localeCompare(b, 'ko'));
            let html = '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">';
            sorted.forEach(t => { 
                let icon = "fa-regular fa-file-lines";
                if (t.startsWith("사진:")) icon = "fa-image";
                if (t.startsWith("오디오:")) icon = "fa-music";
                html += `<div class="p-3 border border-gray-200 rounded hover:bg-gray-50 cursor-pointer flex items-center gap-2" onclick="router('${t}')"><i class="${icon} text-[#00a495]"></i> ${t}</div>`; 
            });
            html += '</div>';
            dom.viewMode.innerHTML = html;
        };
        
        window.router = (pageId) => {
            if(!pageId) pageId = "FrontPage";
            currentDocId = pageId;
            dom.searchResults.classList.add('hidden');
            dom.mobileMenu.classList.add('hidden');
            dom.fnPopover.style.display = 'none'; 
        
            // URL 업데이트 로직 수정: ?page= 대신 /w/ 사용
            try { 
                // 제목에 공백이나 특수문자가 있을 수 있으므로 encodeURIComponent를 사용합니다.
                const newUrl = `/w/${encodeURIComponent(pageId)}`;
                window.history.pushState({ page: pageId }, '', newUrl); 
            } catch(e) {
                console.error("URL 변경 오류:", e);
            }
        
            fetchDocument(pageId);
        };

        async function fetchDocument(pageId) {
            if(!pageId) pageId = "FrontPage";
            dom.docTitle.innerText = pageId;
            dom.lastUpdated.innerText = "";
            isEditing = false;
            updateViewMode();
            dom.viewMode.innerHTML = '<div class="flex justify-center p-10"><i class="fa-solid fa-spinner fa-spin text-4xl text-[#00a495]"></i></div>';
            
            // ✅ [SEO 필수] 브라우저 탭 제목을 문서 제목으로 변경
            document.title = `${pageId} - 미르위키`;

            try {
                const docRef = doc(getWikiCollection(), pageId);
                const docSnap = await getDoc(docRef);
                let descriptionText = ""; // 검색 결과 요약글용 변수

                if (docSnap.exists()) {
                    const data = docSnap.data();
                    currentDocIsLocked = data.isLocked || false;
                    descriptionText = data.content; // 본문 내용을 설명으로 사용
                    
                    // --- 이미지 문서 처리 ---
                    if (pageId.startsWith("사진:")) {
                        const imgSrc = resolveMediaContent(data.content, 'image/webp');
                        if (imgSrc) {
                            dom.viewMode.innerHTML = `<div class="flex flex-col items-center justify-center bg-gray-50 p-6 rounded border border-gray-200"><img src="${imgSrc}" class="max-w-full shadow-lg rounded"><p class="mt-4 text-sm text-gray-500 font-mono select-all break-all">${data.content.substring(0,50)}...</p><p class="text-xs text-gray-400 mt-1">[[${pageId}]] 로 문서에 삽입할 수 있습니다.</p></div>`;
                        } else {
                            dom.viewMode.innerHTML = `<div class="p-4 bg-red-50 text-red-600">이미지 데이터가 손상되었거나 형식을 알 수 없습니다.</div>`;
                        }
                    } 
                    // --- 오디오 문서 처리 ---
                    else if (pageId.startsWith("오디오:")) {
                         const audioSrc = resolveMediaContent(data.content, 'audio/mp3');
                         if (audioSrc) {
                             dom.viewMode.innerHTML = `<div class="flex flex-col items-center justify-center bg-gray-50 p-6 rounded border border-gray-200"><div class="w-full max-w-md bg-white p-4 rounded shadow"><i class="fa-solid fa-music text-4xl text-[#00a495] mb-4 block text-center"></i><audio controls src="${audioSrc}" class="w-full"></audio></div><p class="mt-4 text-sm text-gray-500 font-mono select-all break-all">${data.content.substring(0,50)}...</p><p class="text-xs text-gray-400 mt-1">[[${pageId}]] 로 문서에 삽입할 수 있습니다.</p></div>`;
                         } else {
                            dom.viewMode.innerHTML = `<div class="p-4 bg-red-50 text-red-600">오디오 데이터가 손상되었거나 형식을 알 수 없습니다.</div>`;
                         }
                    }
                    // --- 일반 문서 처리 ---
                    else {
                        await renderContent(data.content);
                    }

                    if(data.updatedAt) dom.lastUpdated.innerText = `최근 수정: ${data.updatedAt.toDate().toLocaleString()}`;
                } else {
                    // 문서가 없을 때
                    currentDocIsLocked = false;
                    descriptionText = "아직 작성되지 않은 문서입니다.";
                    dom.viewMode.innerHTML = `<div class="text-center py-10"><div class="text-6xl text-gray-200 mb-4"><i class="fa-solid fa-file-circle-question"></i></div><p class="text-gray-600 mb-4">'${pageId}' 문서가 존재하지 않습니다.</p><button onclick="toggleEdit()" class="namu-btn"><i class="fa-solid fa-plus"></i> 새 문서 만들기</button></div>`;
                    dom.lastUpdated.innerText = "문서 없음";
                }

                // ✅ [SEO 필수] 검색 엔진용 설명(Description) 태그 자동 생성
                let metaDesc = document.querySelector('meta[name="description"]');
                if (!metaDesc) {
                    metaDesc = document.createElement('meta');
                    metaDesc.name = "description";
                    document.head.appendChild(metaDesc);
                }
                // 특수문자 제거 후 150자만 자르기
                const plainText = descriptionText.replace(/[#*`\->\[\]]/g, '').substring(0, 150).trim();
                metaDesc.content = plainText || "미르위키 문서입니다.";

                renderToolbar();
            } catch (error) {
                let msg = "데이터 로드 실패";
                if(error.code === 'permission-denied') msg = "권한 없음";
                dom.viewMode.innerHTML = `<div class="bg-red-50 border border-red-200 rounded p-6 text-center"><h3 class="font-bold text-red-700">${msg}</h3><p class="text-gray-500 text-xs mt-2">${error.message}</p></div>`;
            }
        }

        async function renderContent(markdownText) {
            // marked.js가 로드되었는지 확인하는 로직입니다.
            if (typeof marked === 'undefined') { dom.viewMode.innerHTML = '<div class="text-red-500">Marked 라이브러리 오류 (index.htm에 Marked CDN을 추가했는지 확인하세요)</div>'; return; }
            
            let processedText = markdownText;

            // 1. Process [[사진:Name]] & [[오디오:Name]] tags
            // We find all unique tags first
            const linkRegex = /\[\[(사진:|오디오:)([^\]]+)\]\]/g;
            const matches = [...processedText.matchAll(linkRegex)];
            
            if (matches.length > 0) {
                const uniqueFullTitles = [...new Set(matches.map(m => m[1] + m[2]))];
                
                // Fetch all needed docs
                const promises = uniqueFullTitles.map(title => getDoc(doc(getWikiCollection(), title)));
                const snapshots = await Promise.all(promises);
                
                // Map Title -> Blob URL
                const mediaMap = {};
                snapshots.forEach((snap, idx) => {
                    const title = uniqueFullTitles[idx];
                    if (snap.exists()) {
                        const content = snap.data().content;
                        // Determine type based on title prefix
                        const mime = title.startsWith("오디오:") ? 'audio/mp3' : 'image/webp';
                        const src = resolveMediaContent(content, mime);
                        mediaMap[title] = src;
                    } else {
                        mediaMap[title] = null;
                    }
                });

                // Replace in text
                processedText = processedText.replace(linkRegex, (match, type, name) => {
                    const fullTitle = type + name;
                    const src = mediaMap[fullTitle];
                    
                    if (!src) return `<span class="text-red-500 text-xs border border-red-200 bg-red-50 px-1 rounded"><i class="fa-solid fa-triangle-exclamation"></i> ${fullTitle} (유실됨)</span>`;
                    
                    if (type === "사진:") {
                        return `![${name}](${src})`;
                    } else {
                        return `<div class="my-2 p-2 bg-gray-100 rounded border flex items-center gap-2"><i class="fa-solid fa-music text-[#00a495]"></i><span class="font-bold text-sm text-gray-600 mr-2">${name}</span><audio controls src="${src}" class="h-8"></audio></div>`;
                    }
                });
            }

            // 1.5 Process [[Link]] tags (Automatic Link Processing)
            // Added logic here to ensure links work inside footnotes as well
            processedText = processedText.replace(/\[\[([^\]]+)\]\]/g, (match, title) =>
                `<a href="#" onclick="router('${title}')">${title}</a>`
            );

            // 2. Footnotes
            let footnoteCount = 0;
            processedText = processedText.replace(/\[\*\s(.*?)]/g, (match, content) => {
                footnoteCount++;
                return `<sup class="wiki-fn" onclick="toggleFootnote(this, '${encodeURIComponent(content)}')">[${footnoteCount}]</sup>`;
            });

            dom.viewMode.innerHTML = marked.parse(processedText);

            // 3. Render LaTeX (KaTeX)
            if (window.renderMathInElement) {
                window.renderMathInElement(dom.viewMode, {
                    delimiters: [
                        {left: '$$', right: '$$', display: true},
                        {left: '$', right: '$', display: false},
                        {left: '\\(', right: '\\)', display: false},
                        {left: '\\[', right: '\\]', display: true}
                    ],
                    throwOnError: false
                });
            }
        }

        // --- Editing ---
        window.toggleEdit = async () => {
            if(requireLogin()) return;
            if(isActionBlocked()) return;

            isEditing = !isEditing;
            if(isEditing) {
                dom.editBtn.innerHTML = '<i class="fa-solid fa-eye"></i> 읽기';
                try {
                    const s = await getDoc(doc(getWikiCollection(), currentDocId));
                    let defaultContent = `# ${currentDocId}\n\n내용을 입력하세요.`;
                    if (currentDocId.startsWith("사진:") || currentDocId.startsWith("오디오:")) defaultContent = ""; // Media docs empty by default
                    dom.editorContent.value = s.exists() ? s.data().content : defaultContent;
                } catch(e) { handleError(e, "편집"); isEditing=false; updateViewMode(); }
            } else { dom.editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> 편집'; }
            updateViewMode();
        };
        window.cancelEdit = () => { isEditing = false; dom.editBtn.innerHTML = '<i class="fa-solid fa-pen"></i> 편집'; updateViewMode(); }
        function updateViewMode() {
             if(isEditing) { dom.viewMode.classList.add('hidden'); dom.editMode.classList.remove('hidden'); }
             else { dom.viewMode.classList.remove('hidden'); dom.editMode.classList.add('hidden'); }
        }
        window.saveDocument = async () => {
            if(requireLogin()) return;
            if(isActionBlocked()) return;

            const btn = document.getElementById('saveBtn'); const origin = btn.innerHTML;
            btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 저장...';
            try {
                await setDoc(doc(getWikiCollection(), currentDocId), {
                    title: currentDocId, content: dom.editorContent.value, updatedAt: serverTimestamp(), updatedBy: currentUser.uid, isLocked: currentDocIsLocked
                });
                try { await addDoc(getHistoryCollection(currentDocId), { editor: currentUser.email||"Unknown", timestamp: serverTimestamp(), action: "수정" }); } catch(e){}
                if(!allDocTitles.includes(currentDocId)) allDocTitles.push(currentDocId);
                showToast("저장됨"); isEditing = false; dom.editBtn.innerHTML='<i class="fa-solid fa-pen"></i> 편집'; updateViewMode(); fetchDocument(currentDocId);
            } catch(e) { handleError(e, "저장"); }
            finally { btn.disabled=false; btn.innerHTML=origin; }
        };
        
        // --- Image Upload Logic ---
        window.openImageUploadModal = () => { if(requireLogin()) return; dom.imageUploadModal.classList.remove('hidden'); dom.imgTitleInput.focus(); };
        window.closeImageUploadModal = () => { dom.imageUploadModal.classList.add('hidden'); dom.imgTitleInput.value=''; dom.imgFileInput.value=''; };
        
        window.submitImageUpload = async () => {
            const titlePart = dom.imgTitleInput.value.trim();
            if(!titlePart) return showToast("이미지 제목을 입력해주세요.");
            const file = dom.imgFileInput.files[0];
            if(!file) return showToast("이미지 파일을 선택해주세요.");

            const fullTitle = "사진:" + titlePart;
            // Check existence
            try {
                const check = await getDoc(doc(getWikiCollection(), fullTitle));
                if(check.exists()) if(!confirm(`'${fullTitle}' 문서가 이미 존재합니다. 덮어쓰시겠습니까?`)) return;
            } catch(e) {}

            const btn = dom.imgUploadBtn;
            const originalText = btn.innerText;
            btn.innerText = "처리 중...";
            btn.disabled = true;

            try {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = async () => {
                        const canvas = document.createElement('canvas');
                        const MAX_WIDTH = 800; 
                        let width = img.width;
                        let height = img.height;
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                        canvas.width = width; canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        const dataUrl = canvas.toDataURL('image/webp', 0.7);
                        
                        if (dataUrl.length > 950000) {
                            showToast("파일이 너무 큽니다.");
                            btn.innerText = originalText; btn.disabled = false; return;
                        }

                        await setDoc(doc(getWikiCollection(), fullTitle), {
                            title: fullTitle, content: dataUrl, updatedAt: serverTimestamp(), updatedBy: currentUser.uid, isLocked: false, type: 'image'
                        });

                        try { await addDoc(getHistoryCollection(fullTitle), { editor: currentUser.email, timestamp: serverTimestamp(), action: "이미지 업로드" }); } catch(e){}
                        if(!allDocTitles.includes(fullTitle)) allDocTitles.push(fullTitle);

                        showToast("이미지 업로드 성공!");
                        closeImageUploadModal();
                        router(fullTitle);
                        btn.innerText = originalText; btn.disabled = false;
                    };
                };
            } catch (e) { handleError(e, "이미지 업로드"); btn.innerText = originalText; btn.disabled = false; }
        };

        // --- Audio Upload Logic (K-Base 4096) ---
        window.openAudioUploadModal = () => { if(requireLogin()) return; dom.audioUploadModal.classList.remove('hidden'); dom.audioTitleInput.focus(); };
        window.closeAudioUploadModal = () => { dom.audioUploadModal.classList.add('hidden'); dom.audioTitleInput.value=''; dom.audioFileInput.value=''; };
        
        window.submitAudioUpload = async () => {
            const titlePart = dom.audioTitleInput.value.trim();
            if(!titlePart) return showToast("오디오 제목을 입력해주세요.");
            const file = dom.audioFileInput.files[0];
            if(!file) return showToast("오디오 파일을 선택해주세요.");
            
            // Size check: 400KB limit (approx) due to K-Base overhead and Firestore limit
            if(file.size > 1024 * 1024) return showToast("파일이 너무 큽니다. (1MB 이하 권장)");

            const fullTitle = "오디오:" + titlePart;
            try {
                const check = await getDoc(doc(getWikiCollection(), fullTitle));
                if(check.exists()) if(!confirm(`'${fullTitle}' 문서가 이미 존재합니다. 덮어쓰시겠습니까?`)) return;
            } catch(e) {}

            const btn = dom.audioUploadBtn;
            const originalText = btn.innerText;
            btn.innerText = "인코딩 중...";
            btn.disabled = true;

            try {
                const reader = new FileReader();
                reader.readAsArrayBuffer(file);
                reader.onload = async (event) => {
                    const u8 = new Uint8Array(event.target.result);
                    // K-4096 Encode
                    const encodedBody = kBaseEncode(u8);
                    const mime = file.type || 'audio/mp3';
                    const finalContent = `data:${mime};kbase,${encodedBody}`;
                    
                    if (finalContent.length > 950000) { // Firestore limit check roughly (UTF-8 bytes)
                         // 1 char in K-Base is roughly 3 bytes in UTF-8
                         // string length * 3 needs to be < 1,048,576
                         // But Javascript string .length counts UTF-16 units
                         showToast("인코딩 후 용량이 너무 큽니다.");
                         btn.innerText = originalText; btn.disabled = false; return;
                    }

                    await setDoc(doc(getWikiCollection(), fullTitle), {
                        title: fullTitle, content: finalContent, updatedAt: serverTimestamp(), updatedBy: currentUser.uid, isLocked: false, type: 'audio'
                    });

                    try { await addDoc(getHistoryCollection(fullTitle), { editor: currentUser.email, timestamp: serverTimestamp(), action: "오디오 업로드 (K-4096)" }); } catch(e){}
                    if(!allDocTitles.includes(fullTitle)) allDocTitles.push(fullTitle);

                    showToast("오디오 업로드 성공!");
                    closeAudioUploadModal();
                    router(fullTitle);
                    btn.innerText = originalText; btn.disabled = false;
                };
            } catch (e) { handleError(e, "오디오 업로드"); btn.innerText = originalText; btn.disabled = false; }
        };

        // --- Other Doc Actions ---
        window.openNewDocModal = () => { if(requireLogin()) return; dom.newDocModal.classList.remove('hidden'); dom.newDocTitleInput.focus(); };
        window.closeNewDocModal = () => { dom.newDocModal.classList.add('hidden'); dom.newDocTitleInput.value=''; };
        window.createNewDoc = () => { const t=dom.newDocTitleInput.value.trim(); if(!t)return showToast("제목 입력"); closeNewDocModal(); router(t); };
        
        window.openMoveModal = () => { 
            if(requireLogin()) return; 
            if(isActionBlocked()) return;
            if(isEditing) return showToast("편집중 불가"); 
            dom.moveDocTitleInput.value=currentDocId; dom.moveDocModal.classList.remove('hidden'); 
        };
        window.closeMoveModal = () => dom.moveDocModal.classList.add('hidden');
        window.submitMoveDoc = async () => {
            const t=dom.moveDocTitleInput.value.trim(); if(!t||t===currentDocId)return showToast("제목 확인");
            try {
                if((await getDoc(doc(getWikiCollection(), t))).exists()) return showToast("이미 존재함");
                const oldS=await getDoc(doc(getWikiCollection(), currentDocId)); if(!oldS.exists()) return showToast("문서 없음");
                await setDoc(doc(getWikiCollection(), t), { ...oldS.data(), title:t, updatedAt:serverTimestamp() });
                await deleteDoc(doc(getWikiCollection(), currentDocId));
                allDocTitles=allDocTitles.filter(x=>x!==currentDocId); allDocTitles.push(t);
                closeMoveModal(); showToast("이동됨"); router(t);
            } catch(e){ handleError(e, "이동"); }
        };
        
        window.openDeleteModal = () => { 
            if(requireLogin()) return; 
            if(isActionBlocked()) return;
            dom.deleteTargetTitle.innerText=currentDocId; dom.deleteDocModal.classList.remove('hidden'); 
        };
        window.closeDeleteModal = () => dom.deleteDocModal.classList.add('hidden');
        window.submitDeleteDoc = async () => {
            try { await deleteDoc(doc(getWikiCollection(), currentDocId)); allDocTitles=allDocTitles.filter(x=>x!==currentDocId); closeDeleteModal(); showToast("삭제됨"); router('FrontPage'); }
            catch(e){ handleError(e, "삭제"); }
        };

        window.openHistoryModal = () => {
             dom.historyDocTitle.innerText = currentDocId;
             dom.historyList.innerHTML = '<tr><td colspan="3" class="text-center py-4">로딩 중...</td></tr>';
             dom.historyModal.classList.remove('hidden');
             getDocs(query(getHistoryCollection(currentDocId), orderBy("timestamp", "desc"), limit(30)))
                .then(snap => {
                    dom.historyList.innerHTML = snap.empty ? '<tr><td colspan="3" class="text-center py-4 text-gray-500">기록 없음</td></tr>' : '';
                    snap.forEach(d => {
                        const v=d.data();
                        const tr=document.createElement('tr'); tr.className="border-b hover:bg-gray-50";
                        tr.innerHTML=`<td class="px-4 py-3 text-gray-600">${v.timestamp?v.timestamp.toDate().toLocaleString():'-'}</td><td class="px-4 py-3 font-bold">${v.editor}</td><td class="px-4 py-3">${v.action}</td>`;
                        dom.historyList.appendChild(tr);
                    });
                }).catch(e => dom.historyList.innerHTML='<tr><td colspan="3" class="text-center text-red-500">불러오기 실패</td></tr>');
        };

        function handleError(e, ctx) { console.error(e); if(e.code==='permission-denied') showToast("권한이 없습니다."); else showToast(`${ctx} 실패: ${e.message}`); }
        function showToast(m) { const t=document.getElementById('toast'); t.innerText=m; t.classList.remove('translate-y-20'); setTimeout(()=>t.classList.add('translate-y-20'),3000); }
        function loadRecentChanges() {
             onSnapshot(query(getWikiCollection(), orderBy("updatedAt", "desc"), limit(10)), s => {
                 dom.recentList.innerHTML = s.empty ? '<li class="p-2 border-b hover:bg-gray-50 cursor-pointer flex justify-between text-center text-xs">기록 없음</li>' : '';
                 s.forEach(d => {
                     const li=document.createElement('li'); li.className="p-2 border-b hover:bg-gray-50 cursor-pointer flex justify-between";
                     li.onclick=()=>router(d.id);
                     li.innerHTML=`<div class="truncate w-2/3 font-medium text-gray-700">${d.id}</div><div class="text-xs text-gray-400">${d.data().updatedAt?getTimeAgo(d.data().updatedAt.toDate()):"방금"}</div>`;
                     dom.recentList.appendChild(li);
                 });
             });
        }
        async function loadAllTitlesForSearch() { try { const s=await getDocs(query(getWikiCollection(), limit(300))); allDocTitles=s.docs.map(d=>d.id); } catch(e){} }
        function loadPageFromUrl() {
            try {
                const path = window.location.pathname;
                
                // 1. 주소가 /w/로 시작하는지 확인
                if (path.startsWith('/w/')) {
                    // "/w/" 이후의 문자열을 추출하고 인코딩된 문자를 복원(decode)합니다.
                    const pageId = decodeURIComponent(path.substring(3));
                    // router 함수를 호출하되, 무한 루프 방지를 위해 내부 로직만 실행하거나 
                    // 아래처럼 fetchDocument를 직접 호출하는 것이 안전할 수 있습니다.
                    fetchDocument(pageId || "FrontPage");
                } 
                // 2. 하위 호환성을 위해 기존 ?page= 방식도 남겨둡니다.
                else {
                    const pageParam = new URLSearchParams(window.location.search).get('page');
                    fetchDocument(pageParam || "FrontPage");
                }
            } catch(e) {
                console.error("라우팅 오류:", e);
                fetchDocument("FrontPage");
            }
        }
        function getTimeAgo(date) {
            const s = Math.floor((new Date() - date)/1000);
            if(s>31536000) return Math.floor(s/31536000)+"년 전";
            if(s>2592000) return Math.floor(s/2592000)+"달 전";
            if(s>86400) return Math.floor(s/86400)+"일 전";
            if(s>3600) return Math.floor(s/3600)+"시간 전";
            if(s>60) return Math.floor(s/60)+"분 전";
            return "방금 전";
        }
        
        dom.searchInput.addEventListener('input', (e) => {
            const v=e.target.value.trim().toLowerCase();
            if(!v) { dom.searchResults.classList.add('hidden'); return; }
            const m=allDocTitles.filter(t=>t.toLowerCase().includes(v)).slice(0,10);
            if(m.length){
                dom.searchResults.innerHTML=m.map(t=>`<li class="px-4 py-2 hover:bg-gray-100 cursor-pointer border-b" onclick="router('${t}')">${t}</li>`).join('');
                dom.searchResults.classList.remove('hidden');
            } else dom.searchResults.classList.add('hidden');
        });
        window.handleSearch = () => { const v=dom.searchInput.value.trim(); if(v){ router(v); dom.searchInput.value=''; dom.searchResults.classList.add('hidden'); }};
        window.handleRandom = () => { if(allDocTitles.length) router(allDocTitles[Math.floor(Math.random()*allDocTitles.length)]); else router('FrontPage'); };

        initAuth();