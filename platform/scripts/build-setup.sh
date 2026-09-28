#!/usr/bin/env bash
# migrations/*.sql 을 Supabase SQL 편집기에 한 번에 붙여넣을 수 있는 파일 하나로 합친다.
# 한 트랜잭션이라 중간에 오류가 나면 아무것도 남지 않고, 이미 설치된 DB 에서는 실행을 거부한다.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=supabase/setup_all.sql
{
  echo "-- ============================================================"
  echo "-- 학원관리 플랫폼 DB 설치 (자동 생성 파일 · 직접 고치지 말 것 · scripts/build-setup.sh)"
  echo "-- Supabase → SQL Editor → New query 에 전체를 붙여넣고 Run."
  echo "-- 한 번에 전부 설치되거나, 오류가 나면 아무것도 설치되지 않는다."
  echo "-- ============================================================"
  echo "begin;"
  echo "do \$\$ begin"
  echo "  if to_regclass('public.academies') is not null then"
  echo "    raise exception '이미 설치된 DB 입니다. 다시 실행하지 않아도 됩니다.';"
  echo "  end if;"
  echo "end \$\$;"
  for f in supabase/migrations/*.sql; do echo; echo "-- >>>>> $f"; cat "$f"; done
  echo
  echo "commit;"
  echo "select '설치 완료' as result,"
  echo "  (select count(*) from information_schema.tables where table_schema in ('public','app')) as tables,"
  echo "  (select count(*) from pg_policies where schemaname = 'public') as policies;"
} > "$OUT"
echo "$OUT ($(wc -l < "$OUT") 줄)"
