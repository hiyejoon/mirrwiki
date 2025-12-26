// 🚩 [필수] Netlify 서버(Node.js) 환경에서 Firebase가 통신할 수 있도록 설정
global.XMLHttpRequest = require('xhr2');

const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs } = require("firebase/firestore");

// Firebase 설정 (기존과 동일)
const firebaseConfig = {
  apiKey: "AIzaSyDoxGleFDo1xt_f9QE8XhmdIBL65XTfR6A",
  authDomain: "mirrwiki-pro.firebaseapp.com",
  projectId: "mirrwiki-pro",
  storageBucket: "mirrwiki-pro.firebasestorage.app",
  messagingSenderId: "154251618788",
  appId: "1:154251618788:web:98594edc88afe64333bff1",
  measurementId: "G-DN6RG991TV"
};

// 앱 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

exports.handler = async (event, context) => {
  try {
    // 1. 위키 문서가 저장된 컬렉션 경로
    const docRef = collection(db, 'artifacts', 'mirrwiki-default', 'public', 'data', 'wiki_pages');
    
    // 2. 모든 문서 가져오기
    const snapshot = await getDocs(docRef);
    
    // 3. XML 시작 부분 작성
    let xml = '<?xml version="1.0" encoding="UTF-8"?>';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    
    // 4. 메인 페이지 추가
    xml += `
    <url>
        <loc>https://mirrwiki.netlify.app/</loc>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>`;

    // 5. 각 위키 문서를 XML에 추가
    snapshot.forEach(doc => {
       const pageId = doc.id;
       
       // 🚩 주소 형식을 '/w/제목'으로 하고 한글 깨짐 방지 처리
       const safeUrl = `https://mirrwiki.netlify.app/w/${encodeURIComponent(pageId)}`;
       
       // 날짜 처리 (데이터에 없으면 오늘 날짜)
       const data = doc.data();
       let lastMod = new Date().toISOString().split('T')[0];
       if (data.updatedAt && data.updatedAt.toDate) {
           lastMod = data.updatedAt.toDate().toISOString().split('T')[0];
       }

       xml += `
    <url>
        <loc>${safeUrl}</loc>
        <lastmod>${lastMod}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>0.8</priority>
    </url>`;
    });

    // 6. XML 닫기
    xml += '</urlset>';

    // 🚩 [핵심 수정] 서버 응답 헤더 설정
    // 이렇게 해야 Netlify가 불필요한 <script> 태그를 끼워 넣지 않습니다.
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Cache-Control': 'public, max-age=0, must-revalidate'
      },
      body: xml.trim() // 공백 제거
    };

  } catch (error) {
    console.error("Sitemap Error:", error);
    return {
      statusCode: 500,
      body: "Error generating sitemap: " + error.toString()
    };
  }
};