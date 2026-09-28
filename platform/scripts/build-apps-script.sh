#!/usr/bin/env bash
# 구글 Apps Script 에 붙여넣을 파일 하나로 합친다: apps-script/main.js + transform.cjs → apps-script/import.gs
set -euo pipefail
cd "$(dirname "$0")/../migrate"
OUT=apps-script/import.gs
{
  cat apps-script/main.js
  echo
  echo "// ================================================================"
  echo "// 아래는 이관 규칙 (platform/migrate/transform.cjs 와 같은 코드 · 자동 생성 · 직접 고치지 말 것)"
  echo "// ================================================================"
  cat transform.cjs
} > "$OUT"
echo "migrate/$OUT ($(wc -l < "$OUT") 줄)"
