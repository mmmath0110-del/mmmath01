-- =====================================================================
-- 0004 학원 한 곳을 한 번에 넣는 함수 (옛 구글 시트 이관용)
--
-- public.import_academy(payload, apply, replace_existing)
--   payload : migrate/transform.cjs 가 만든 { 표이름: [행, ...] }
--   apply   : false 면 전부 넣어 본 뒤 CHECK_OK 오류로 되돌린다(점검). true 면 저장
--   replace_existing : 같은 slug 학원이 있으면 지우고 다시 넣는다 (테스트 DB 에서만)
-- 한 번의 호출 = 한 트랜잭션. 하나라도 실패하거나 건수가 안 맞으면 아무것도 남지 않는다.
-- 서버 관리자 키(service_role / Secret key)로만 부를 수 있다. 화면·비로그인 키로는 호출 불가.
-- =====================================================================
create or replace function public.import_academy(payload jsonb, apply boolean default false, replace_existing boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  -- 참조 순서 (transform.cjs 의 HAKWON_ORDER 와 같아야 한다)
  tables text[] := array['academies', 'academy_settings', 'app.academy_secrets', 'staff', 'app.staff_legacy_credentials', 'students',
    'classes', 'textbooks', 'enrollments', 'attendance', 'checkins', 'payments', 'exams', 'scores', 'reports', 'consults', 'messages',
    'ext_schedules', 'schedule_links', 'academy_kv', 'changes', 'makeups', 'mk_requests', 'events', 'tests', 'supplies', 'issues',
    'student_profiles', 'gradebook', 'bills', 'att_checks', 'att_check_log', 'work_logs', 'shifts', 'push_subs', 'kiosk_devices', 'blog_posts'];
  t text; tbl text; cols text; n bigint; want bigint;
  counts jsonb := '{}';
  v_slug text := payload -> 'academies' -> 0 ->> 'slug';
begin
  if v_slug is null then raise exception 'payload 에 학원(academies) 정보가 없습니다'; end if;
  if exists (select 1 from public.academies a where a.slug = v_slug) then
    if not replace_existing then
      raise exception '"%" 학원이 이미 들어 있습니다. 다시 넣으려면 replace_existing 을 켜세요 (테스트 DB 에서만)', v_slug;
    end if;
    delete from public.academies a where a.slug = v_slug;   -- 딸린 데이터는 on delete cascade 로 함께 지워진다
  end if;

  -- payload 에 모르는 표 이름이 있으면 멈춘다 (오타로 데이터가 조용히 빠지는 것 방지)
  select string_agg(k, ', ') into t from jsonb_object_keys(payload) k where k <> all (tables);
  if t is not null then raise exception '알 수 없는 표: %', t; end if;

  foreach t in array tables loop
    want := coalesce(jsonb_array_length(payload -> t), 0);
    continue when want = 0;
    tbl := case when position('.' in t) > 0
                then quote_ident(split_part(t, '.', 1)) || '.' || quote_ident(split_part(t, '.', 2))
                else 'public.' || quote_ident(t) end;
    select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(payload -> t -> 0) k;
    execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1)', tbl, cols, cols, tbl)
      using payload -> t;
    get diagnostics n = row_count;
    if n <> want then raise exception '% 건수 불일치 (DB % / 보낸 것 %)', t, n, want; end if;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  if not apply then
    -- 점검: 전부 들어가는 것을 확인했으니 오류로 되돌린다
    raise exception using errcode = 'P0001', message = 'CHECK_OK', detail = counts::text;
  end if;
  return counts;
end $$;

revoke all on function public.import_academy(jsonb, boolean, boolean) from public, anon, authenticated;
grant execute on function public.import_academy(jsonb, boolean, boolean) to service_role;
