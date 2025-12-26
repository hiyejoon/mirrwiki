# 변형할 코드 트리
MirrWiki/
├── public/                 # 웹 브라우저에 직접 호스팅되는 파일들
│   ├── index.html          # [메인] 위키의 진입점이자 레이아웃 (blf.html, lbisc.html의 통합본)
│   ├── script.js           # [핵심 로직] Firebase 통신, 라우팅, 마크다운 렌더링, 미디어 업로드
│   ├── robots.txt          # 검색 엔진 크롤링 규칙 설정
│   └── logo.png            # (필요) 위키 로고 이미지
│
├── functions/              # Netlify Functions (서버 측 로직)
│   └── sitemap.js          # [동적 생성] Firestore 데이터를 읽어 실시간 sitemap.xml 생성
│
├── config/                 # 설정 및 관리 파일 (실제 배포 루트에 위치 가능)
│   └── package.json        # Node.js 의존성 관리 (sitemap.js 실행용)
│
└── backups/                # (정리 대상) 중복되거나 버전이 다른 파일들
    ├── bf.htm / bf.js      # 초기 버전 또는 백업용
    ├── blf.html / lbisc.html # index.html과 거의 동일한 변형 파일
    └── script.js.txt       # script.js의 텍스트 백업본
