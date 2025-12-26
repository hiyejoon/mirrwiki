# MirrWiki (미르위키)

> **Firebase와 Netlify 기반의 고성능 가상 세계관 및 인공어 정보 공유 위키 플랫폼**

MirrWiki는 단순한 문서 저장소를 넘어, 인공어(말미르, 우르고딕 등)와 독특한 세계관을 기록하기 위해 설계된 커스텀 위키 엔진입니다. 서버리스 아키텍처를 활용하여 빠르고 안정적인 사용자 경험을 제공합니다.

---

## ✨ 주요 기능 (Key Features)

*   **📝 강력한 마크다운 편집기**: `Marked.js`를 탑재하여 표준 마크다운 문법을 완벽하게 지원합니다.
*   **🔢 수식 렌더링**: `KaTeX` 통합으로 칼만 필터나 복잡한 기술 공식도 미려하게 표현합니다.
*   **🖼️ 멀티미디어 임베딩**: `[[사진:제목]]`, `[[오디오:제목]]` 문법을 통해 독자적인 미디어 시스템을 구축했습니다.
*   **🔒 관리자 보안 시스템**: 중요 문서 잠금 및 해제 기능을 통해 정보의 신뢰성을 유지합니다.
*   **📜 문서 역사(History)**: 모든 수정 내역을 Firestore에 기록하여 문서의 변천사를 확인할 수 있습니다.
*   **🔍 실시간 검색 및 랜덤 이동**: 초성 및 부분 일치 검색과 더불어 '랜덤 문서' 기능을 통한 탐험을 지원합니다.
*   **🚀 SEO 최적화**: Netlify Functions를 이용한 **동적 사이트맵(Sitemap.xml)** 자동 생성 및 검색 엔진 최적화.

---

## 🛠 기술 스택 (Tech Stack)

### Frontend
- **Framework**: HTML5, Tailwind CSS 3.4
- **Icons**: FontAwesome 6.4
- **Libraries**: 
  - `Marked.js` (Markdown Parsing)
  - `KaTeX` (Math Rendering)

### Backend (Serverless)
- **Database**: Firebase Firestore
- **Auth**: Firebase Authentication
- **Analytics**: Firebase Analytics
- **Hosting**: Netlify
- **Serverless Functions**: Node.js (for Dynamic Sitemap)

---

## 🏗 프로젝트 구조 (Project Structure)

```text
MirrWiki/
├── public/                 # 웹 정적 리소스
│   ├── index.html          # 메인 레이아웃 및 UI
│   ├── script.js           # 프론트엔드 핵심 로직 (Firebase SDK 연동)
│   ├── robots.txt          # 검색 엔진 크롤링 설정
│   └── logo.png            # 위키 로고 이미지
├── functions/              # 서버리스 함수
│   └── sitemap.js          # 실시간 sitemap.xml 생성기
├── package.json            # 의존성 관리 파일
└── README.md               # 프로젝트 설명서
```

---

## 💡 핵심 알고리즘: K-Base (갂) 인코딩

MirrWiki는 Firestore의 텍스트 저장 제한을 효율적으로 활용하기 위해 고유의 **K-Base 인코딩** 방식을 사용합니다.

- **원리**: 바이너리 데이터를 한글 유니코드 범위(44032~)로 매핑하여 텍스트 데이터의 밀도를 높입니다.
- **마커**: `갂`으로 시작하는 데이터는 시스템에서 자동으로 이미지나 오디오로 디코딩되어 렌더링됩니다.
- **장점**: 별도의 Storage 서버 없이도 Firestore 내에서 고해상도 WebP 이미지와 인코딩된 오디오를 안전하게 관리할 수 있습니다.

---

## 🚀 설치 및 배포 (Deployment)

1.  **Firebase 설정**: Firebase 프로젝트를 생성하고 `apiKey` 등 설정을 `script.js`에 입력합니다.
2.  **Netlify 배포**: 깃허브 저장소를 Netlify에 연결합니다.
3.  **Functions 설정**: `sitemap.js`가 정상 작동하도록 Netlify 환경 변수를 구성합니다.

---

## 📄 라이선스 (License)

본 프로젝트의 문서는 **CC BY-SA (크리에이티브 커먼즈 저작자표시-동일조건변경허락)** 라이선스를 따릅니다.
