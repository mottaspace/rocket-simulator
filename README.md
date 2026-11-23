# 26년도 로켓 시뮬레이터

2026년도 지원사업 로켓 시뮬레이터 프로젝트 소스 저장소.

## 로켓 발사 체험 (웹)

학생들이 휴대폰에서 **부품으로 로켓을 조립 → 직접 조종해 작은 행성의 궤도에 올리고 → 낙하산으로 귀환**하는 체험 웹페이지입니다.
빌드 과정 없는 정적 사이트이며, 로그인은 **Google**, 저장소는 **Cloud Firestore**를 씁니다.

| 파일 | 역할 |
|---|---|
| `index.html`, `css/style.css` | 화면(로그인 · 조립 · 비행) |
| `js/parts.js` | 부품 정의, 단(stage)별 Δv·추력중량비 계산 |
| `js/physics.js` | 행성(반지름 400 km, 대기 45 km) 주위 2D 비행 물리, 궤도 계산 |
| `js/render.js` | 비행 화면 · 지도(궤도) 화면 · 자세 표시기 그리기 |
| `js/app.js` | 화면 흐름, 조종, 임무 5개, 저장/순위표 UI |
| `js/cloud.js` | Firebase Google 로그인 + Firestore 읽기/쓰기 |
| `js/firebase-config.js` | Firebase 웹 앱 설정 값(직접 입력) |
| `firestore.rules`, `firebase.json` | 보안 규칙, Hosting 배포 설정 |

### 3D 버전 (`3d/`)

`http://localhost:5174/3d/` — 격납고에서 3D로 로켓을 조립하고(측면 부스터 2·3·4개 대칭, 인공위성·노즈콘·진공 엔진 포함), 실사풍 행성 위로 발사해 궤도에 올리고 위성을 배치합니다.

| 파일 | 역할 |
|---|---|
| `3d/main.js` | 화면 전환(조립↔비행), 조종, 카메라, 블룸, 위성 우주, 성능 측정 |
| `3d/builder.js` | 3D 조립 화면: 부품 쌓기·선택·이동·삭제, 측면 부스터 대칭, 성능 표 |
| `3d/physics3d.js` | 3D 비행 물리, 측면 부스터·위성 분리, 궤도 계산·케플러 전파, 자동 비행 |
| `3d/world.js` | 셰이더 행성(시작 시 텍스처로 굽기)·구름층·하늘·대기·발사장·연기, 품질 3단계 |
| `3d/rocketModel.js` | 부품·위성 3D 모델, 엔진 불꽃 셰이더 |
| `3d/vendor/` | Three.js r160 및 후처리·환경맵 모듈 (MIT, CDN 없이 동작) |

- 그래픽 품질: PC는 "높음"(그림자·블룸·고해상도 행성), 휴대폰은 "중간"으로 시작하고, 3초 평균이 26fps 아래로 떨어지면 자동으로 한 단계 낮춥니다. 메뉴 → "성능 측정(40초)"으로 기기별 평균·하위 1% fps를 기록합니다.
- 배치한 위성은 지금은 이 기기(localStorage)에만 저장되어 실제 시간에 맞춰 공전합니다. 반 공유 우주는 Firestore 연결 단계에서 추가합니다.

### 로컬 실행

```powershell
python scripts/dev_server.py 5174
```
브라우저에서 http://localhost:5174 를 엽니다. `firebase-config.js`가 비어 있으면 "설정 전 체험하기"(저장 안 됨)로 들어갈 수 있습니다.

### Firebase 설정

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트를 만듭니다.
2. **Authentication → 로그인 방법 → Google** 사용 설정.
3. **Firestore Database → 데이터베이스 만들기** (프로덕션 모드, 서울 `asia-northeast3` 권장).
4. **프로젝트 설정 → 내 앱 → 웹 앱 추가**에서 나온 `firebaseConfig` 값을 `js/firebase-config.js`에 붙여 넣습니다.
5. 규칙 배포와 호스팅(Firebase CLI 필요):
   ```powershell
   npm install -g firebase-tools
   firebase login
   firebase use --add
   firebase deploy --only firestore:rules,hosting
   ```
6. 다른 도메인에서 서비스한다면 **Authentication → 설정 → 승인된 도메인**에 추가합니다.

### Firestore 데이터 구조

- `users/{uid}` — 이름·사진(순위표 표시용)
- `users/{uid}/designs/{id}` — 내 로켓 설계 (본인만 읽기/쓰기)
- `flights/{id}` — 비행 기록 (로그인한 사용자 모두 읽기 → 순위표, 본인 명의로만 생성, 수정 불가)

## REA (Reverse Engineer Anything) 설정

REA 소스는 이 저장소에 포함하지 않고 `rea/` 폴더에 따로 받습니다(`.gitignore` 처리).
빌드에는 Node **24.22.1**이 정확히 필요하므로 `.tools/`에 별도로 둡니다.

1. Node 24.22.1 zip을 https://nodejs.org/dist/v24.22.1/ 에서 받아 `.tools/node-v24.22.1-win-x64/`에 풉니다.
2. 아래 명령으로 소스를 받고 빌드합니다.
   ```powershell
   git clone https://github.com/morluto/rea.git rea
   cd rea
   git checkout rea-agents-6.10.1
   npm pack rea-agents@6.10.1   # 압축을 풀고 package/native/windows/build/ 의 파일 2개를 native/windows/build/ 로 복사
   npm ci
   npm run build
   ```
   (1~2단계의 npm은 `.tools/node-v24.22.1-win-x64`가 PATH 맨 앞에 있는 상태에서 실행합니다.)
3. 실행: `.\rea.ps1 --version`, `.\rea.ps1 doctor`
