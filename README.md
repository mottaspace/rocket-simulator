# 26년도 로켓 시뮬레이터

2026년도 지원사업 로켓 시뮬레이터 프로젝트 소스 저장소.

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
