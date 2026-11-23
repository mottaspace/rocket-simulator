# REA 실행 스크립트: 프로젝트 전용 Node 24.22.1로 rea/ 소스 빌드를 실행합니다.
# 사용 예: .\rea.ps1 --version   /   .\rea.ps1 doctor
$root = $PSScriptRoot
$node = Join-Path $root '.tools\node-v24.22.1-win-x64\node.exe'
if (-not (Test-Path $node)) { Write-Error "Node 24.22.1이 없습니다: $node"; exit 1 }
& $node (Join-Path $root 'rea\scripts\rea.mjs') @args
exit $LASTEXITCODE
