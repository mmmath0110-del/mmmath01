/*
 * 원장 전용 도구 — 운영 캘린더 · 기록카드 · 개별 청구 · 테스트 일정 · 점검
 * 옛 원장실(admin.html) 화면을 학원관리(academy.html) 안으로 합친 것. 화면 코드는 원장실 그대로 쓰고
 * (같은 서버 액션 adminBootstrap · adminSave · adminDelete …), 학원관리와 스타일이 섞이지 않게 Shadow DOM 안에 그린다.
 * 색은 학원관리 색(--cobalt · --paper …)을 그대로 따른다. 원장(관리자) 아이디에서만 열린다.
 * 원장실 화면의 원본은 이제 이 파일이다 (admin.html 은 학원관리로 넘기는 안내만 남았다). 고칠 때는 여기서 직접 고친다.
 */
(function () {
"use strict";
const CSS = ":host{display:block;color:var(--ink);font-family:var(--kr);font-size:15px;line-height:1.6;word-break:keep-all;-webkit-font-smoothing:antialiased;\n  --ground:var(--paper); --surface:var(--sheet); --surface-2:var(--paper); --surface-3:var(--rule-2);\n  --line:var(--rule); --line-2:var(--rule-2); --accent:var(--cobalt); --accent-soft:var(--cobalt-soft);\n  --paid:var(--teal); --due:var(--danger); --crit-bg:var(--danger-soft); --warn-bg:var(--warn-soft); --info-bg:var(--cobalt-soft); --good-bg:var(--teal-soft);\n  --shadow-lg:var(--shadow); --kr:\"Noto Sans KR\",-apple-system,\"Apple SD Gothic Neo\",\"Malgun Gothic\",system-ui,sans-serif; --mono:ui-monospace,\"SFMono-Regular\",Consolas,monospace}\n#app{display:flex;flex-direction:column;gap:18px}\n#app>section{display:flex;flex-direction:column;gap:14px}\n.sec{margin:0;font-size:19px;font-weight:700}\na{color:var(--accent)}\n.homeacts .acts{gap:6px} .homeacts .act{border-radius:9px;box-shadow:none} .homeacts .act .t{font-size:14.5px} .homeacts .act .d{font-size:12.5px;margin-top:1px} .homeacts .act .bd{padding:8px 0 8px 4px} .homeacts .act .fg{padding:8px 16px 8px 0;font-size:15px}\n.homeacts{margin-bottom:6px}\n@media (max-width:820px){ .pad{padding:14px} .kpis{grid-template-columns:1fr 1fr} .two{grid-template-columns:1fr!important} .links{grid-template-columns:1fr} }\n*{box-sizing:border-box}\n[hidden]{display:none!important}\n\n\n/* 숫자 표기 — .n0 은 순수 숫자 전용(모노), .n1 은 한글이 섞인 값(본문 서체 + 자릿수 정렬).\n   IBM Plex Mono 에는 한글 글리프가 없어 한글에 모노를 쓰면 글자마다 대체 서체로 떨어진다. */\n.n0{font-family:var(--mono); font-variant-numeric:tabular-nums}\n.n1{font-variant-numeric:tabular-nums; font-feature-settings:\"tnum\" 1}\nbutton{font:inherit; cursor:pointer; font-family:var(--kr)}\ninput,select,textarea{font:inherit; color:inherit; font-family:var(--kr)}\ninput[type=number],input[type=date]{font-family:var(--mono)}\n\n/* ── 좌측 사이드바 레이아웃 ── */\n.shell{display:grid; grid-template-columns:224px minmax(0,1fr); align-items:start}\n.side{position:sticky; top:52px; height:calc(100vh - 52px); background:var(--surface); border-right:1px solid var(--line);\n  display:flex; flex-direction:column; padding:20px 14px 14px; gap:18px; z-index:20}\n.brand{font-family:\"Gowun Batang\",var(--kr); font-weight:700; font-size:20px; letter-spacing:-.01em;\n  padding:0 10px; line-height:1.3}\n.brand em{font-style:normal; color:var(--accent); display:block}\nnav{display:flex; flex-direction:column; gap:3px; overflow-y:auto; flex:1}\nnav button{display:flex; align-items:center; gap:8px; width:100%; background:none; border:0;\n  padding:10px 12px; border-radius:8px; color:var(--ink-2); font-size:14.5px; font-weight:500; text-align:left}\nnav button:hover{background:var(--surface-3); color:var(--ink)}\nnav button[aria-current=\"page\"]{background:var(--accent-soft); color:var(--accent); font-weight:600;\n  box-shadow:inset 3px 0 0 var(--accent)}\nnav button .c{margin-left:auto; font-size:12px; color:var(--ink-3); font-variant-numeric:tabular-nums}\nnav button[aria-current=\"page\"] .c{color:var(--accent)}\nnav button .b{margin-left:auto; font-size:11.5px; font-weight:600; padding:1px 7px; border-radius:999px;\n  background:var(--due); color:#fff; font-variant-numeric:tabular-nums}\nnav a.ext{display:flex; align-items:center; gap:8px; width:100%; padding:10px 12px; border-radius:8px;\n  color:var(--ink-2); font-size:14.5px; font-weight:500; text-decoration:none}\nnav a.ext:hover{background:var(--surface-3); color:var(--ink)}\nnav a.ext .arr{margin-left:auto; font-size:12px; color:var(--ink-3)}\n.linkcard{display:flex; align-items:center; gap:16px; flex-wrap:wrap}\n.linkcard .ic{width:44px; height:44px; border-radius:10px; background:var(--accent-soft); color:var(--accent);\n  display:flex; align-items:center; justify-content:center; font-size:20px; flex:none}\n.linkcard .t{font-size:15.5px; font-weight:600}\n.linkcard .d{font-size:13px; color:var(--ink-2); margin-top:2px}\n.linkcard .go{margin-left:auto; display:flex; gap:8px; flex-wrap:wrap}\na.btn{text-decoration:none; display:inline-flex; align-items:center; gap:6px}\n.links{display:grid; grid-template-columns:1fr 1fr; gap:14px}\n.links .linkcard{align-items:flex-start; flex-wrap:nowrap; gap:14px}\n.links .linkcard .go{margin-left:0; margin-top:10px}\n.links .linkcard .body{flex:1; min-width:0}\n.navgrp{font-size:12.5px; font-weight:700; color:var(--ink-2); letter-spacing:.02em;\n  padding:16px 12px 6px; margin-top:8px; border-top:1px solid var(--line); text-transform:none}\nnav button .ico,nav a.ext .ico{width:22px; flex:none; text-align:center; font-size:15px; line-height:1;\n  font-family:\"Apple Color Emoji\",\"Segoe UI Emoji\",\"Noto Color Emoji\",sans-serif}\n/* 알림 배너 — 시재 부족 · 임박한 테스트 */\n.banner{border-radius:10px; padding:13px 16px; font-size:14px; line-height:1.6; border:1px solid}\n.banner b{font-weight:600}\n.banner.crit{background:var(--crit-bg); border-color:var(--due); color:var(--due)}\n.banner.warn{background:var(--warn-bg); border-color:var(--warn); color:var(--warn)}\n.banner.info{background:var(--info-bg); border-color:var(--accent); color:var(--accent)}\n.side-foot{font-size:12px; color:var(--ink-3); padding:10px 12px 0; border-top:1px solid var(--line-2); min-height:34px}\n/* 열람 전용으로 공유받은 계정에서는 편집 수단을 숨긴다 (쓰기는 서버에서도 거부된다) */\n.build{font-size:10.5px; color:var(--ink-3); margin-top:6px; opacity:.7}\n/* 저장 실패 알림 띠 — 화면 맨 위, 항상 보임 (샌드박스라 alert 팝업이 안 뜨므로) */\n#topbanner{position:fixed; top:0; left:0; right:0; z-index:80; background:var(--due); color:#fff;\n  padding:12px 18px; font-size:14px; font-weight:500; display:none; align-items:center; gap:14px;\n  box-shadow:0 2px 12px rgba(0,0,0,.25); line-height:1.5}\n#topbanner.on{display:flex}\n#topbanner span{flex:1}\n#topbanner .btn{background:#fff; color:var(--due); flex:none}\n#topbanner .tb-x{background:none; border:0; color:#fff; font-size:22px; line-height:1; padding:0 4px; flex:none}\n#save-state.busy{color:var(--accent)} #save-state.err{color:var(--due)}\n.links-foot{font-size:12px; margin-top:6px} .links-foot a{color:var(--ink-2); text-decoration:none} .links-foot a:hover{color:var(--accent)}\n/* 상단 막대 — 학원관리·근무일지와 같은 자리에 같은 정보(이름·역할·나가기·버전) */\n.topbar{position:sticky; top:0; z-index:30; height:52px; background:var(--accent); color:#fff; display:flex; align-items:center; gap:12px; padding:0 16px}\n.tb-brand{font-family:\"Gowun Batang\",var(--kr); font-weight:700; font-size:17px; white-space:nowrap}\n.tb-brand span{font-family:var(--kr); font-weight:400; font-size:12.5px; opacity:.85; margin-left:6px; letter-spacing:.04em}\n.tb-me{margin-left:auto; display:flex; align-items:center; gap:6px; font-size:13px; flex-wrap:wrap; justify-content:flex-end}\n.tb-me .chip{background:rgba(255,255,255,.18); border-color:transparent; color:#fff; font-size:12.5px} .tb-me .chip .muted{opacity:.8}\n.tb-me .chip.ver{font-family:var(--mono); font-size:11.5px}\n.tb-me .btn.ghost{background:transparent; color:#fff; border-color:rgba(255,255,255,.45); text-decoration:none} .tb-me .btn.ghost:hover{background:rgba(255,255,255,.15); color:#fff}\n#banner{max-width:1080px; padding:14px 34px 0} #banner:empty{display:none}\n#banner .banner{margin:0}\nbody.locked .shell,body.locked #banner{display:none}\n/* 로그인 창 */\n.modal-back{position:fixed; inset:0; background:rgba(10,12,18,.55); z-index:90; display:none; align-items:center; justify-content:center; padding:16px}\n.modal-back.on{display:flex}\n.modal{background:var(--surface); color:var(--ink); border:1px solid var(--line); border-radius:12px; padding:22px 24px; width:100%; max-width:400px; box-shadow:var(--shadow-lg)}\n.login-err{color:var(--due); font-size:13px; min-height:18px; margin-top:8px}\n\nmain{max-width:1080px; padding:30px 34px 90px; display:flex; flex-direction:column; gap:34px}\n.panel{background:var(--surface); border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow)}\n.pad{padding:20px 22px}\nh2.sec{font-family:\"Gowun Batang\",var(--kr); font-size:23px; font-weight:700; margin:0; letter-spacing:-.015em}\n.sec-row{display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; padding-bottom:11px;\n  border-bottom:1px solid var(--line)}\n.sec-row .hint{font-size:13px; color:var(--ink-3)}\n.sec-row .spacer{margin-left:auto}\nsection{display:flex; flex-direction:column; gap:16px}\n.note{font-size:12.5px; color:var(--ink-3); line-height:1.65}\n.note b{color:var(--ink-2); font-weight:500}\na{color:var(--accent)}\n.sub-h{font-size:13.5px; font-weight:600; margin-bottom:10px}\n\n.kpis{display:grid; grid-template-columns:repeat(4,1fr); gap:1px; background:var(--line);\n  border:1px solid var(--line); border-radius:12px; overflow:hidden}\n.kpi{background:var(--surface); padding:18px 20px}\n.kpi .k{font-size:12.5px; color:var(--ink-3); margin-bottom:7px; letter-spacing:.01em}\n.kpi .v{font-size:29px; font-weight:600; letter-spacing:-.025em; line-height:1.05; font-family:var(--mono);\n  font-variant-numeric:tabular-nums}\n.kpi .v small{font-size:13.5px; font-weight:400; color:var(--ink-3); margin-left:4px; font-family:var(--kr)}\n.kpi .s{font-size:12.5px; color:var(--ink-2); margin-top:7px}\n.kpi.hi .v{color:var(--due)}\n\n.acts{display:flex; flex-direction:column; gap:10px}\n.act{display:grid; grid-template-columns:5px 1fr auto; gap:0 18px; background:var(--surface);\n  border:1px solid var(--line); border-radius:10px; overflow:hidden; text-align:left; width:100%; padding:0}\n.act:hover{border-color:var(--accent); box-shadow:var(--shadow)}\n.act .bar{align-self:stretch}\n.act.crit .bar{background:var(--due)} .act.warn .bar{background:var(--warn)} .act.info .bar{background:var(--accent)}\n.act .bd{padding:16px 0 16px 6px}\n.act .t{font-size:16px; font-weight:600; display:block; letter-spacing:-.005em}\n.act .d{font-size:13.5px; color:var(--ink-2); margin-top:3px; display:block}\n.act .fg{padding:16px 22px 16px 0; align-self:center; font-size:21px; font-weight:600; white-space:nowrap;\n  font-variant-numeric:tabular-nums; letter-spacing:-.02em}\n\n.row{display:grid; grid-template-columns:118px 1fr 82px; gap:13px; align-items:center; margin-bottom:9px}\n.row.tight{grid-template-columns:118px 1fr 56px}\n.row .lab{font-size:12.5px; color:var(--ink-3); text-align:right; line-height:1.35}\n.row .lab b{display:block; color:var(--ink); font-weight:600; font-size:14px; line-height:1.3}\n.track{position:relative; height:24px; background:var(--line-2); border-radius:5px}\n.seg{position:absolute; top:0; bottom:0}\n.seg .fill{height:100%; width:100%}\n.seg.p .fill{background:var(--paid); border-radius:5px 0 0 5px}\n.seg.d .fill{background:var(--due); border-radius:0 5px 5px 0}\n.seg.solo{background:var(--accent); border-radius:5px}\n.val{font-size:12.5px; color:var(--ink-2); text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums}\n.legend{display:flex; gap:15px; font-size:12.5px; color:var(--ink-2); margin-bottom:12px; flex-wrap:wrap}\n.legend i{display:inline-block; width:11px; height:11px; border-radius:3px; margin-right:6px; vertical-align:-1px}\n\n.bar-tools{display:flex; gap:9px; flex-wrap:wrap; align-items:center}\n.inp{background:var(--surface); border:1px solid var(--line); border-radius:7px; padding:7px 11px;\n  font-size:14px; min-width:0; color:var(--ink)}\n.inp:focus{outline:2px solid var(--accent); outline-offset:-1px; border-color:var(--accent)}\n.chip{background:var(--surface); border:1px solid var(--line); border-radius:999px; padding:5px 12px;\n  font-size:13px; color:var(--ink-2)}\n.chip[aria-pressed=\"true\"]{background:var(--accent); border-color:var(--accent); color:#fff; font-weight:500}\n.chips{display:flex; gap:6px; flex-wrap:wrap}\n.btn{background:var(--accent); color:#fff; border:0; border-radius:7px; padding:8px 15px; font-size:14px; font-weight:500}\n.btn:hover{filter:brightness(1.08)}\n.btn.ghost{background:var(--surface); color:var(--ink-2); border:1px solid var(--line)}\n.btn.ghost:hover{border-color:var(--accent); color:var(--accent); filter:none}\n.btn.sm{padding:5px 11px; font-size:13px}\n.btn.danger{background:none; color:var(--due); border:1px solid var(--line)}\n.btn:disabled{opacity:.5; cursor:default}\n\n.tw{overflow-x:auto; border-radius:10px}\ntable{width:100%; border-collapse:collapse; font-size:14px; background:var(--surface)}\nth,td{text-align:left; padding:11px 14px; border-bottom:1px solid var(--line-2); vertical-align:top}\nth{font-size:11.5px; font-weight:600; color:var(--ink-3); letter-spacing:.04em; border-bottom:1px solid var(--line); white-space:nowrap; padding-top:12px; padding-bottom:9px}\ntd.n,th.n{text-align:right; font-variant-numeric:tabular-nums}\ntd.mono{font-family:var(--mono); color:var(--ink-3)}\n.clk tbody tr{cursor:pointer}\n.clk tbody tr:hover{background:var(--surface-2)}\ntbody tr:last-child td{border-bottom:0}\n.cut{max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}\n.pill{display:inline-block; font-size:11.5px; font-weight:600; padding:2px 9px; border-radius:999px; white-space:nowrap}\n.pill.ok{background:var(--good-bg); color:var(--paid)}\n.pill.no{background:var(--crit-bg); color:var(--due)}\n.pill.wr{background:var(--warn-bg); color:var(--warn)}\n.pill.nu{background:var(--surface-3); color:var(--ink-3)}\n.flagdot{display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--warn); margin-right:6px; vertical-align:1px}\n.due-amt{color:var(--due); font-weight:600}\n.empty{padding:40px 20px; text-align:center; color:var(--ink-3); font-size:14px}\n\n.scrim{position:fixed; inset:0; background:rgba(10,12,18,.42); z-index:40; opacity:0; pointer-events:none; transition:opacity .18s}\n.scrim.on{opacity:1; pointer-events:auto}\n.drawer{position:fixed; top:0; right:0; bottom:0; width:min(470px,100%); background:var(--surface);\n  border-left:1px solid var(--line); box-shadow:var(--shadow-lg); z-index:41; transform:translateX(100%);\n  transition:transform .2s; display:flex; flex-direction:column}\n.drawer.on{transform:none}\n.dr-head{padding:17px 22px; border-bottom:1px solid var(--line); display:flex; align-items:flex-start; gap:14px}\n.dr-head h3{margin:0; font-family:\"Gowun Batang\",var(--kr); font-size:21px; font-weight:700; letter-spacing:-.01em}\n.dr-head .sub{font-size:12.5px; color:var(--ink-3); margin-top:2px}\n.dr-head .x{margin-left:auto; background:none; border:0; color:var(--ink-3); font-size:22px; line-height:1; padding:2px 6px}\n.dr-body{padding:18px 22px; overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:14px}\n.dr-foot{padding:13px 22px; border-top:1px solid var(--line); display:flex; gap:9px; align-items:center}\n/* 저장 거부 사유 — 서랍 발치, 버튼 바로 위 */\n.dr-err{padding:10px 22px; font-size:13px; line-height:1.55; color:var(--due); background:var(--crit-bg);\n  border-top:1px solid var(--line); display:flex; gap:10px; align-items:center; flex-wrap:wrap}\n.dr-err .btn{flex:none}\n.dr-foot .sp{margin-left:auto}\n.fld{display:flex; flex-direction:column; gap:5px}\n.fld label{font-size:12px; color:var(--ink-3); font-weight:500}\n.fld .inp{width:100%}\n.fld textarea.inp{resize:vertical; min-height:64px; line-height:1.55}\n.grid2{display:grid; grid-template-columns:1fr 1fr; gap:12px}\n.grid3{display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px}\n.ro{font-size:13px; color:var(--ink-2); background:var(--surface-2); border-radius:7px; padding:9px 12px; line-height:1.6}\n.ro b{color:var(--ink); font-weight:600}\n\n.flags{display:flex; flex-direction:column}\n.flag{display:flex; gap:13px; align-items:baseline; padding:11px 0; border-bottom:1px solid var(--line-2)}\n.flag:last-child{border-bottom:0}\n.flag .code{font-size:11.5px; color:var(--ink-3); min-width:112px}\n.flag .txt{font-size:13.5px; color:var(--ink-2); flex:1}\n.flag .txt b{color:var(--ink); font-weight:600}\n.tabtag{display:inline-block; font-size:10.5px; font-weight:600; color:var(--paid); border:1px solid var(--paid); border-radius:4px; padding:0 5px; line-height:1.6; white-space:nowrap}   /* 출결 태블릿에서 찍은 기록 */\n.staff{display:flex; flex-direction:column}\n.staff .r{display:flex; gap:10px; align-items:center; flex-wrap:wrap; padding:9px 0; border-bottom:1px solid var(--line-2)}\n.depts.staffkpi{grid-template-columns:repeat(4,minmax(0,1fr))}\n@media (max-width:640px){ .depts.staffkpi{grid-template-columns:repeat(2,minmax(0,1fr))} }   /* 휴대폰에서도 네 칸이 두 줄로만 (한 줄씩 길어지지 않게) */\n.staff .r:last-child{border-bottom:0}\n.staff .dot{width:9px; height:9px; border-radius:50%; flex:none}\n.staff .nm{font-size:13.5px; font-weight:600; min-width:74px}\n.staff .tm{font-family:var(--mono); font-variant-numeric:tabular-nums; font-size:12.5px; color:var(--ink-2); white-space:nowrap}\n.staff .wk{flex:1; font-size:12.5px; color:var(--ink-3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap}\n.depts{display:grid; grid-template-columns:repeat(4,1fr); gap:9px}\n.dept{background:var(--surface-2); border:1px solid var(--line-2); border-radius:8px; padding:11px 13px}\n.dept .k{font-size:12px; color:var(--ink-3)}\n.dept .v{font-size:20px; font-weight:600; font-family:var(--mono); font-variant-numeric:tabular-nums}\n.dept .v small{font-size:12px; font-weight:400; color:var(--ink-3); font-family:var(--kr)}\n.two{display:grid; grid-template-columns:1.15fr .85fr; gap:18px; align-items:start}\n.issue{display:grid; grid-template-columns:auto 1fr auto; gap:13px; align-items:start; padding:12px 0; border-bottom:1px solid var(--line-2)}\n.issue:last-child{border-bottom:0}\n.issue.done{opacity:.5} .issue.done .ti{text-decoration:line-through}\n.issue input[type=checkbox]{width:17px; height:17px; margin-top:3px; accent-color:var(--accent)}\n.issue .ti{font-size:14px; font-weight:600}\n.issue .de{font-size:12.5px; color:var(--ink-2); margin-top:2px}\n.issue .ac{font-size:12.5px; color:var(--accent); margin-top:3px}\n\n/* 달력 */\n.cal-head{display:flex; align-items:center; gap:10px; flex-wrap:wrap}\n.cal-head .m{font-family:\"Gowun Batang\",var(--kr); font-size:22px; font-weight:700; min-width:150px;\n  font-variant-numeric:tabular-nums}\n.cal{display:grid; grid-template-columns:repeat(7,1fr); gap:1px; background:var(--line);\n  border:1px solid var(--line); border-radius:10px; overflow:hidden}\n.cal .dow{background:var(--surface-2); padding:8px 0; text-align:center; font-size:12px; color:var(--ink-3); font-weight:600}\n.cal .dow.sun{color:var(--due)}\n/* min-width:0 이 없으면 nowrap 인 일정 제목이 칸 너비를 밀어내 토요일 칸이 화면 밖으로 나간다 */\n.cell{background:var(--surface); min-height:104px; min-width:0; padding:7px 8px; display:flex;\n  flex-direction:column; gap:4px; border:0; text-align:left; border-radius:0; overflow:hidden}\n.cell:hover{background:var(--surface-2)}\n.cell.out{background:var(--surface-3); opacity:.55}\n.cell .dn{font-size:12.5px; color:var(--ink-2); font-family:var(--mono); font-variant-numeric:tabular-nums}\n.cell.sun .dn{color:var(--due)}\n.cell.today .dn{background:var(--accent); color:#fff; border-radius:50%; width:21px; height:21px;\n  display:inline-flex; align-items:center; justify-content:center; font-size:11.5px}\n.ev{display:block; max-width:100%; min-width:0; font-size:11.5px; padding:2px 6px; border-radius:4px;\n  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border-left:3px solid;\n  background:var(--surface-3); color:var(--ink-2); line-height:1.5}\n.ev.시험{border-color:var(--due); background:var(--crit-bg); color:var(--due)}\n.ev.특강{border-color:var(--accent); background:var(--info-bg); color:var(--accent)}\n.ev.상담{border-color:var(--paid); background:var(--good-bg); color:var(--paid)}\n.ev.휴원{border-color:var(--ink-3)}\n.ev.특이사항{border-color:var(--ink); color:var(--ink)}\n.ev.보강{border-color:#B45309; background:#FEF3C7; color:#7C4A02}\ntr.soon td{background:var(--info-bg)}\n.ev.보강.done{opacity:.6}\n.ev.시험기간{border-color:#9333EA; background:#F3E8FF; color:#6B21A8}\n/* 학교 시험기간 — 여러 날에 걸쳐 칸 맨 위에 띠로 깔린다 (시작한 날과 주(週)의 첫 칸에만 이름) */\n.band{display:block; max-width:100%; min-width:0; font-size:11px; font-weight:700; line-height:1.55; padding:1px 6px;\n  color:#fff; background:#9333EA; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; border-radius:0}\n.band.s{border-radius:5px 0 0 5px} .band.e{border-radius:0 5px 5px 0} .band.s.e{border-radius:5px}\n.band.mid{color:rgba(255,255,255,.72)}\n.band.c1{background:#9333EA} .band.c2{background:#DB2777} .band.c3{background:#0891B2} .band.c4{background:#CA8A04} .band.c5{background:#4F46E5}\n/* 범례 = 켜고 끄는 단추 */\n.legend button{display:inline-flex; align-items:center; gap:6px; border:1px solid var(--line); background:var(--surface);\n  color:var(--ink-2); border-radius:999px; padding:3px 10px; font:inherit; font-size:12.5px; cursor:pointer}\n.legend button .n{font-family:var(--mono); font-size:11px; color:var(--ink-3)}\n.legend button[aria-pressed=\"false\"]{opacity:.45; text-decoration:line-through}\n.legend button:hover{background:var(--surface-2)}\n.exambar{display:flex; flex-direction:column; gap:6px; margin:0 0 12px}\n.exambar .x{display:flex; align-items:center; gap:10px; font-size:12.5px; background:var(--surface-2);\n  border:1px solid var(--line-2); border-radius:8px; padding:6px 10px; cursor:pointer; text-align:left; width:100%}\n.exambar .x .sw{width:10px; height:10px; border-radius:3px; flex:none}\n.exambar .x .nm{font-weight:700; min-width:96px}\n.exambar .x .dd{margin-left:auto; font-family:var(--mono); font-size:11.5px; color:var(--ink-3)}\n.exambar .x .dd.on{color:var(--due); font-weight:700}\n\n/* 라벨 / 값 격자 — 기록카드의 성향·방향성·진로 */\n.kv{display:grid; grid-template-columns:auto 1fr; gap:8px 18px; font-size:13.5px; align-items:baseline}\n.kv-k{color:var(--ink-3); font-size:12.5px; white-space:nowrap}\n.kv-v{color:var(--ink); overflow-wrap:anywhere}\n.kv2{display:flex; gap:12px; padding:7px 0; border-top:1px solid var(--line); font-size:13.5px}\n.kv2:first-of-type{border-top:0}\n.kv2 span{color:var(--ink-3); min-width:88px}\n.kv2 b{overflow-wrap:anywhere}\n\n@media print{\n  @page{margin:14mm}\n  .side,.scrim,.drawer,.toast,.no-print,.sec-row .spacer,#rec-print,.topbar,#banner{display:none!important}\n  body{background:#fff; color:#000; font-size:11pt}\n  .shell{display:block}\n  main{padding:0; gap:12px; max-width:none}\n  .panel{box-shadow:none; border:1px solid #bbb; break-inside:avoid}\n  .two{grid-template-columns:1fr 1fr}\n  .btn,.chip{display:none!important}\n  h2.sec{font-size:15pt}\n  .kv-k,.note{color:#444}\n}\n.toast{position:fixed; left:50%; bottom:26px; transform:translate(-50%,14px); background:var(--ink); color:var(--ground);\n  padding:10px 18px; border-radius:8px; font-size:13.5px; z-index:60; opacity:0; pointer-events:none; transition:.2s}\n.toast.on{opacity:1; transform:translate(-50%,0)}\n.toast.err{background:var(--due); color:#fff}\n:focus-visible{outline:2px solid var(--accent); outline-offset:2px}\n@media (prefers-reduced-motion:reduce){*{transition:none!important}}\n@media (max-width:1080px){ #refreshBtn .rl{display:none} #refreshBtn{padding:4px 8px} main{padding:26px 24px 80px} }\n@media (max-width:900px){\n  /* 좁은 화면에서는 사이드바를 상단 가로 막대로 접는다 */\n  .shell{grid-template-columns:minmax(0,1fr)}\n  /* 상단 막대: 이름·버튼이 두 줄로 넘쳐도 아래 메뉴를 덮지 않게 높이를 내용에 맞춘다 */\n  .topbar{height:auto; min-height:52px; padding:6px 14px; flex-wrap:wrap; row-gap:4px}\n  .tb-brand{overflow:hidden; text-overflow:ellipsis; min-width:0}\n  .tb-me{flex-wrap:nowrap; gap:5px}\n  .tb-me .btn{padding:5px 9px; font-size:12.5px}\n  .side{position:static; height:auto; flex-direction:row; align-items:center; gap:12px; min-width:0; overflow:hidden;\n    border-right:0; border-bottom:1px solid var(--line); padding:10px 14px}\n  .brand{font-size:17px; padding:0; white-space:nowrap; flex:none}\n  .brand em{display:inline}\n  /* nav 가 flex 항목이라 min-width:0 이 없으면 메뉴 전체 너비만큼 페이지가 넓어져 휴대폰에서 화면이 축소된다 */\n  nav{flex-direction:row; overflow-x:auto; overflow-y:hidden; gap:2px; scrollbar-width:none; min-width:0; -webkit-overflow-scrolling:touch}\n  nav::-webkit-scrollbar{display:none}\n  nav button{width:auto; white-space:nowrap; padding:8px 12px; box-shadow:none!important}\n  nav button .c{display:none}\n  .navgrp{display:none}\n  nav button .ico,nav a.ext .ico{width:auto; margin-right:2px}\n  nav a.ext{width:auto; white-space:nowrap; padding:8px 12px}\n  nav button .b{margin-left:5px}\n  .side-foot{border:0; padding:0; margin-left:auto; min-height:0; white-space:nowrap; flex:none;\n    flex-direction:row; align-items:center; gap:10px}\n  .links-foot,.build{display:none}\n  #banner{padding:12px 18px 0}\n  main{max-width:none; padding:22px 18px 80px; gap:26px}\n  /* 1fr 은 minmax(auto,1fr) 이라 표가 넓으면 칸이 화면 밖으로 밀린다 → minmax(0,1fr) */\n  .two,.links{grid-template-columns:minmax(0,1fr)} .kpis,.depts{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .cell{min-height:80px}\n}\n@media (max-width:560px){\n  /* 학원관리·근무일지 링크는 홈 화면 카드와 메뉴에도 있으므로 상단 막대에서는 뺀다 */\n  .tb-me a.btn{display:none}\n  .tb-me .chip .muted{display:none}\n  .tb-brand{font-size:15.5px} .tb-brand span{font-size:11.5px; margin-left:4px}\n  .side{padding:8px 10px; gap:8px}\n  .side-foot{display:none}\n  .kpis,.depts{grid-template-columns:minmax(0,1fr)}\n  .row,.row.tight{grid-template-columns:88px 1fr 58px; gap:9px}\n  .act{grid-template-columns:4px 1fr} .act .fg{grid-column:2; padding:0 18px 14px 6px; align-self:start}\n  .grid2,.grid3{grid-template-columns:minmax(0,1fr)}\n  .cell{min-height:62px; padding:5px} .cell .ev{font-size:10.5px; padding:1px 4px}\n  .cal-head .m{font-size:19px; min-width:0}\n  .brand em{display:none}\n  h2.sec{font-size:20px}\n  main{padding:18px 14px 70px}\n}\n.toast.undoable{pointer-events:auto;display:flex;align-items:center;gap:12px} .toast .undo{border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.12);color:inherit;border-radius:6px;padding:4px 10px;font:inherit;font-weight:700;cursor:pointer;white-space:nowrap} .toast .undo b{opacity:.75;font-weight:600}";
let CTX = null;
const mkHost = cls => { const h = document.createElement("div"); h.className = cls; const r = h.attachShadow({ mode: "open" }); return [h, r]; };
const [HOST, ROOT] = mkHost("mm-office");
ROOT.innerHTML = `<style>${CSS}</style><div id="app"></div><div class="scrim" id="scrim"></div><aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title"></aside>`;
const [HOMEHOST, HOMEROOT] = mkHost("mm-office-home");
HOMEROOT.innerHTML = `<style>${CSS}</style><div id="home"></div>`;
const $ = (s, r) => (r || ROOT).querySelector(s);
const $$ = (s, r) => Array.from((r || ROOT).querySelectorAll(s));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = n => (Number(n) || 0).toLocaleString("ko-KR");
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
const pad = n => String(n).padStart(2, "0");
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => (CTX && CTX.today()) || fmtDate(new Date());
const LINKS = { sheet: "https://docs.google.com/spreadsheets/d/1TNHAyqMIj43wRvaFtAp8eu4KOIPItcWzYy3ZFtxusMs/edit" };
const SUP_CAT = ["사무용품", "인쇄/토너", "교재/부교재", "청소/위생", "다과", "기타"];   // 시재는 쓰지 않지만 운영 편집 표(OPS)가 참조한다
let view = "cal", loaded = false, loading = null, loadErr = "", stale = false;
let MEMBERS = new Map(), TEACHERS = ["확인필요"], ready = false;   // 원장실 adapt() 가 채운다
let fS = { q: "", dept: "", hr: "", flag: false, status: "재원" }, fC = { closed: false };   // 원장실 학생·반 화면 필터 (wire 가 참조)
const friendly = ex => CTX ? CTX.friendly(ex) : ((ex && ex.message) || "요청을 처리하지 못했습니다.");
const toast = msg => CTX && CTX.toast(msg);
function showDrawerError(text) {
  const foot = $("#drawer .dr-foot"); if (!foot) return;
  let el = $("#dr-err"); if (!el) { el = document.createElement("div"); el.id = "dr-err"; el.className = "dr-err"; foot.before(el); }
  el.textContent = text;
}
const showBanner = () => {};
/** 저장 요청: 실패하면 서랍 발치와 토스트로 이유를 보이고 다시 던진다 (버튼이 풀린다) */
async function call(action, payload) {
  try { return await CTX.api(action, payload); }
  catch (err) { const text = friendly(err); showDrawerError(text); toast(text); throw err; }
}
async function load() { const d = await CTX.api("adminBootstrap"); adapt(d); loaded = true; stale = false; loadErr = ""; if (CTX.onData) CTX.onData(); }
function ensure() {
  if (loading) return loading;
  if (loaded && !stale) return Promise.resolve();
  loading = load().catch(e => { loadErr = friendly(e); }).finally(() => { loading = null; draw(); drawHome(); });
  return loading;
}
async function refresh() { try { await load(); } catch (e) { toast("다시 읽지 못했습니다: " + friendly(e)); } draw(); drawHome(); }
/** 원장실 안의 이동 이름 → 학원관리 화면 */
const VIEWMAP = { calendar: "cal", records: "rec", payments: "bills", tests: "tests", issues: "issues", students: "students", classes: "classes", home: "home" };
function go(v) { CTX.go(VIEWMAP[v] || v); }
function render() { draw(); drawHome(); if (CTX && CTX.onData) CTX.onData(); }   // 저장 뒤 왼쪽 메뉴 숫자도 바로

const GRADES = ["초1","초2","초3","초4","초5","초6","중1","중2","중3","고1","고2","고3","기타"];
const PAYSTATUS = ["완납","미납","부분납","청강","환불","면제","확인필요"];
const METHODS = ["","카드","계좌이체","현금","기타"];
const ENROLSTATUS = ["재원","휴원","퇴원","대기"];
const EVTYPES = ["시험","특강","상담","휴원","특이사항","시험기간"];   // 시험기간: 학교별 기간 일정 (시작~종료)
const CONSULT_TYPES = ["신규상담","학부모상담","학생상담","전화상담","기타"];
const BILL_KINDS = ["특강","선행","정규","보충","교재비","기타"];

let S={students:[],teachers:[],classes:[],rows:[],payments:[],issues:[],meta:null,
       records:{exams:[],mocks:[],tasks:[],counsels:[],profiles:[]}, events:[], makeups:[], ops:{supplies:[],tests:[]}, paid:[], staffToday:[]};

const deptOfGrade = g => /^초/.test(g||"") ? "초등부" : /^중/.test(g||"") ? "중등부" : /^고/.test(g||"") ? "고등부" : "확인필요";
const deptOfName  = n => /^초/.test(n||"") ? "초등부" : /^중/.test(n||"") ? "중등부" : /^고/.test(n||"") ? "고등부" : "확인필요";
const gradeNum = g => { const n=Number(String(g||"").replace(/\D/g,"")); return n||null; };
function teacherLabel(id){ const m=MEMBERS.get(id); if(!m) return ""; return /T$/.test(m.name) ? m.name : m.name+"T"; }
function adapt(d){
  MEMBERS = new Map((d.members||[]).map(m=>[m.id,m]));
  TEACHERS = [...MEMBERS.values()].filter(m=>m.active!==false).map(m=>teacherLabel(m.id)).concat(["확인필요"]);
  const tk = today();
  const clsMap = new Map((d.classes||[]).map(c=>[c.id,c]));
  S.classes = (d.classes||[]).map(c=>({id:c.id, name:c.name, dept:c.kind==="선행" ? "선행반" : deptOfName(c.name),
    teacher:teacherLabel(c.teacherId)||"확인필요", teacherId:c.teacherId||"", day:(c.days||"").replace(/,/g,""),
    program:c.progress||"", type:c.subject||"", kind:c.kind||"", fee:Number(c.fee)||0, note:c.memo||"", status:c.status||"운영", slots:c.slots||[]}));
  S.rows = (d.enrollments||[]).filter(e => !e.endDate || e.endDate >= tk).filter(e => clsMap.has(e.classId))
    .map(e=>({id:e.id, studentId:e.studentId, classId:e.classId, startDate:e.startDate||""}));
  const regOf = {};
  S.rows.forEach(r=>{ const c=clsMap.get(r.classId); if(c && c.kind!=="선행") (regOf[r.studentId]=regOf[r.studentId]||[]).push(c); });
  S.students = (d.students||[]).map(s=>{
    const hr = (regOf[s.id]||[]).map(c=>teacherLabel(c.teacherId)).filter(Boolean)[0] || "확인필요";
    return {id:s.id, extId:s.extId||"", name:s.name, dept:deptOfGrade(s.grade), grade:gradeNum(s.grade), gradeKey:s.grade||"",
      school:s.school||"", status:s.status||"재원", phone:s.phone||"", guardianPhone:s.parentPhone||"", parentName:s.parentName||"",
      birth:s.birth||"", enrolledAt:s.enrolledAt||"", leftAt:s.leftAt||"", note:s.memo||"", homeroom:hr,
      flag:/확인\s*필요|확인필요/.test(s.memo||"")};
  });
  S.teachers = [...MEMBERS.values()];
  const nameOf = id => { const s=S.students.find(x=>x.id===id); return s ? s.name : id; };
  S.payments = (d.bills||[]).map(b => Object.assign({}, b, {name:nameOf(b.studentId), billed:Number(b.billed)||0, discount:Number(b.discount)||0, paid:Number(b.paid)||0}));
  S.paid = d.payments || [];
  S.issues = d.issues||[]; S.events = d.events||[];
  S.makeups = d.makeups||[];   // 학원관리 보강 일정 (makeups 시트 그대로 읽기만 — 달력·기록카드가 같은 원본을 본다)
  S.ops = {supplies:d.supplies||[], tests:d.tests||[]};
  const g = d.gradebook||[];
  S.records = {exams:g.filter(x=>x.kind==="내신"), mocks:g.filter(x=>x.kind==="모의"), tasks:g.filter(x=>x.kind==="과제"),
    counsels:d.consults||[], profiles:d.profiles||[]};
  S.meta = d.meta || null;
  S.examResults = d.examResults || [];   // 학원관리 성적(시험·점수) — 같은 시트를 읽을 뿐 따로 저장하지 않는다
  S.staffToday = d.staffToday || [];     // 오늘 선생님 출퇴근 (근무일지와 같은 logs 시트 · 태블릿에서 찍은 것도 그대로)
  S.attWatch = d.attWatch || null;       // 오늘 미출결 확인 (확인 필요 · 재알림 수) — 처리는 학원관리 [미출결 확인]
  S.mkRequests = d.mkRequests || [];     // 강사가 원장에게 보낸 보강 요청 (처리는 학원관리 [보강 → 선생님 요청])
  S.lastSync = Date.now();
  ready = S.students.length>0 || S.classes.length>0;
}

const money = () => { let bill=0,paid=0; S.payments.forEach(p=>{bill+=(p.billed||0)-(p.discount||0); paid+=(p.paid||0);});
  return {bill,paid,due:bill-paid,rate:pct(paid,bill)}; };
const byKind = k => { const rs=S.payments.filter(p=>p.kind===k); let bill=0,paid=0;
  rs.forEach(p=>{bill+=(p.billed||0)-(p.discount||0); paid+=(p.paid||0);});
  return {n:rs.length,bill,paid,due:bill-paid,rate:pct(paid,bill)}; };
const dueOf = p => (p.billed||0)-(p.discount||0)-(p.paid||0);
const unpaid = () => S.payments.filter(p => dueOf(p) > 0 && p.status!=="청강" && p.status!=="면제" && p.status!=="환불");
const needCheck = () => S.payments.filter(p => p.status==="확인필요");
const openIssues = () => S.issues.filter(i => !i.done);
const teacherLoad = () => { const m={},cls={};
  S.students.filter(s=>s.status==="재원").forEach(s=>{const t=s.homeroom||"확인필요"; m[t]=(m[t]||0)+1;});
  S.classes.filter(c=>c.status!=="종료").forEach(c=>{cls[c.teacher]=(cls[c.teacher]||0)+1;});
  return TEACHERS.filter(t=>t!=="확인필요").map(t=>({t,n:m[t]||0,c:cls[t]||0})).filter(x=>x.n||x.c).sort((a,b)=>b.n-a.n); };
const deptCount = d => S.students.filter(s=>s.dept===d && s.status==="재원").length;
const stu = id => S.students.find(x=>x.id===id);
const stuName = id => { const s=stu(id); return s?s.name:id; };
const memberName = id => { const m=MEMBERS.get(id); return m ? m.name : (id||""); };
/* 고1 최상위반 바로가기: 이름에 '고1' 과 '최상위' 가 들어간 반 */
const topClass = () => { const c=S.classes.find(c=>/고1/.test(c.name)&&/최상위/.test(c.name)&&c.status!=="종료");
  return c ? S.rows.filter(r=>r.classId===c.id).map(r=>r.studentId) : []; };
const classesOf = id => S.rows.filter(r=>r.studentId===id).map(r=>S.classes.find(c=>c.id===r.classId)).filter(Boolean);

/* ── 운영: 시재 · 테스트 ── */
const lowStock = () => S.ops.supplies.filter(x =>
  x.qty!=="" && x.qty!=null && x.minQty!=="" && x.minQty!=null && Number(x.qty) <= Number(x.minQty));
const noCount  = () => S.ops.supplies.filter(x => x.qty==="" || x.qty==null);
const dday = d => Math.round((new Date(d+"T00:00:00") - new Date(today()+"T00:00:00"))/86400000);
const soonTests = () => S.ops.tests.filter(t => !t.done && t.date && dday(t.date)>=0 && dday(t.date)<=2)
  .sort((a,b)=>a.date<b.date?-1:1);
const nextTests = () => S.ops.tests.filter(t => !t.done && t.date && dday(t.date)>=0)
  .sort((a,b)=>a.date<b.date?-1:1);
const ddayLabel = d => { const n=dday(d); return n===0?"오늘":n===1?"내일":n===2?"모레":n>0?"D-"+n:"지남"; };

/* ---------- 기록카드 ---------- */
let recStu=null;
function vRecords(){
  const top=topClass();
  if(!recStu || !stu(recStu)) recStu = top[0] || (S.students.find(s=>s.status==="재원")||S.students[0]||{}).id;
  const s=stu(recStu); if(!s) return `<div class="panel pad"><div class="empty">학생을 찾을 수 없습니다</div></div>`;
  const R=S.records, f=a=>a.filter(x=>x.studentId===recStu);
  const exams=f(R.exams), mocks=f(R.mocks), tasks=f(R.tasks), cs=f(R.counsels).sort((a,b)=>a.date<b.date?1:-1);
  const cls=classesOf(recStu).map(c=>c.name);
  const pays=S.payments.filter(p=>p.studentId===recStu);
  const payDue=pays.reduce((a,p)=>a+Math.max(dueOf(p),0),0);
  const P=profileOf(recStu);
  const tbl=(title,btn,head,rows,empty)=>`<div class="panel">
    <div class="pad" style="padding-bottom:6px;display:flex;align-items:center;gap:10px">
      <div class="sub-h" style="margin:0">${title}</div><button class="btn sm ghost" style="margin-left:auto" data-add="${btn}">+ 추가</button></div>
    <div class="tw"><table class="clk" style="min-width:${head.length>6?"620px":"420px"}"><thead><tr>${head.map(h=>`<th${h[1]?' class="n"':""}>${h[0]}</th>`).join("")}</tr></thead>
    <tbody>${rows||`<tr><td colspan="${head.length}" class="empty">${empty}</td></tr>`}</tbody></table></div></div>`;
  const kv=rows=>`<div class="kv">${rows.map(([k,v])=>`<div class="kv-k">${k}</div>
    <div class="kv-v">${v?esc(v):'<span style="color:var(--ink-3)">—</span>'}</div>`).join("")}</div>`;
  const card=(sec,title,rows,memoKey)=>{
    const filled=PROF[sec].fields.some(f=>P[f[0]] && P[f[0]]!=="미입력" && P[f[0]]!=="미정");
    return `<div class="panel pad"><div style="display:flex;align-items:center;gap:10px">
      <div class="sub-h" style="margin:0">${title}</div>
      <button class="btn sm ghost" style="margin-left:auto" data-prof="${sec}">${filled?"수정":"입력"}</button></div>
      ${filled ? `<div style="margin-top:12px">${kv(rows)}</div>
        ${memoKey&&P[memoKey]?`<div class="ro" style="margin-top:10px;white-space:pre-wrap">${esc(P[memoKey])}</div>`:""}`
        : `<p class="note" style="margin:9px 0 0">아직 입력되지 않았습니다. 오른쪽 <b>입력</b>을 누르세요.</p>`}</div>`;
  };
  const sorted=[...S.students].sort((a,b)=>(a.status==="재원"?0:1)-(b.status==="재원"?0:1)||String(a.name).localeCompare(String(b.name),"ko"));
  return `<section>
    <div class="sec-row"><h2 class="sec">기록카드</h2><span class="hint">학생 내역 · 성적 · 성향 · 방향성을 한 장에 남깁니다</span>
      <span class="spacer"></span><button class="btn sm ghost" id="rec-print">인쇄</button></div>
    <div class="bar-tools no-print">
      <select class="inp" id="rec-stu" style="min-width:230px">${sorted.map(x=>`<option value="${x.id}"${x.id===recStu?" selected":""}>${esc(x.name)}${x.status!=="재원"?" ("+esc(x.status)+")":""}${x.school&&x.school!=="확인필요"?" · "+esc(x.school):""}</option>`).join("")}</select>
      <span class="chips">${top.map(id=>`<button class="chip" data-rec="${id}" aria-pressed="${id===recStu}">${esc(stuName(id))}</button>`).join("")}</span>
      ${top.length?`<span class="note" style="margin-left:auto">고1 최상위반 바로가기</span>`:""}</div>

    <div class="panel pad"><div style="display:flex;gap:14px;align-items:baseline;flex-wrap:wrap">
      <div style="font-family:'Gowun Batang',serif;font-size:23px;font-weight:700">${esc(s.name)}</div>
      <div class="note" style="font-size:13px">${esc(s.extId||"")} · ${esc(s.dept)} · ${esc(s.school||"학교 미상")}${s.gradeKey?" "+esc(s.gradeKey):""} · 담임 ${esc(s.homeroom)}</div>
      <button class="btn sm ghost no-print" style="margin-left:auto" data-stu="${s.id}">기본정보 편집</button></div></div>

    <div class="two">
      <div class="panel pad"><div class="sub-h">학생 내역</div>
        ${kv([["재원상태",s.status],["학생 연락처",s.phone],["학부모 연락처",s.guardianPhone],["학부모",s.parentName],
              ["등록일",s.enrolledAt],["수강 반",cls.join(", ")],["비고",s.note]])}
        <div class="sub-h" style="margin:16px 0 8px">개별 청구</div>
        ${pays.length?`<div class="tw"><table style="min-width:0"><tbody>${pays.map(p=>`<tr>
          <td style="font-size:12.5px">${esc(p.course)}</td>
          <td class="n" style="font-size:12.5px">${won((p.billed||0)-(p.discount||0))}</td>
          <td><span class="pill ${p.status==="완납"?"ok":p.status==="미납"?"no":p.status==="확인필요"?"wr":"nu"}">${esc(p.status)}</span></td>
          </tr>`).join("")}</tbody></table></div>
          ${payDue?`<p class="note" style="margin:8px 0 0;color:var(--due)">미납 <b style="color:var(--due)">${won(payDue)}원</b></p>`:""}`
          :`<p class="note">개별 청구가 없습니다. 월 수강료는 학원관리 [수납]에서 봅니다.</p>`}</div>

      ${card("direction","방향성",[["지도 방침",P.policy],["선행 로드맵",P.roadmap],
        ["다음 단계",P.nextStep],["이탈 리스크",P.risk&&P.risk!=="미입력"?P.risk+(P.riskWhy?" · "+P.riskWhy:""):""]],"watch")}
    </div>

    ${card("trait","성향",[["수업 태도",P.attitude],["과제 성실도",P.homework],["문제풀이 유형",P.style],
      ["강점 영역",P.strength],["약점 영역",P.weakness],["시험 대응 · 멘탈",P.mental],
      ["수업 분위기 · 또래",P.peer],["학부모 성향 · 소통",P.parent]],"traitMemo")}

    ${card("career","진로 목표",[["계열",P.track],["전형 유형",P.admType],
      ["1지망",[P.univ1,P.major1].filter(Boolean).join(" ")],["2지망",[P.univ2,P.major2].filter(Boolean).join(" ")],
      ["내신 목표 / 현재",[P.targetInner,P.curInner].filter(Boolean).join(" / ")],
      ["모의 목표 / 현재",[P.targetMock,P.curMock].filter(Boolean).join(" / ")]],"careerMemo")}

    ${tbl("내신 성적","exam",[["학년도"],["학기"],["시험"],["과목"],["원점수",1],["등급",1],["석차",1],["취약단원"]],
      exams.map(r=>`<tr data-ed="exam:${r.id}"><td class="n0">${esc(r.year)}</td><td>${esc(r.term)}</td><td>${esc(r.exam)}</td>
        <td>${esc(r.subject)}</td><td class="n">${r.score===""||r.score==null?"—":r.score}</td>
        <td class="n">${r.level||"—"}</td><td class="n">${r.rank||"—"}</td><td class="cut">${esc(r.weak||"")}</td></tr>`).join(""),
      "시험 성적이 없습니다")}

    ${tbl("모의고사","mock",[["시행일"],["주관"],["회차"],["원점수",1],["백분위",1],["등급",1],["취약단원"]],
      mocks.map(r=>`<tr data-ed="mock:${r.id}"><td class="n0">${esc(r.date)}</td><td>${esc(r.org)}</td><td>${esc(r.round)}</td>
        <td class="n">${r.raw||"—"}</td><td class="n">${r.pct||"—"}</td><td class="n">${r.level||"—"}</td>
        <td class="cut">${esc(r.weak||"")}</td></tr>`).join(""), "모의고사 기록이 없습니다")}

    ${tbl("테스트 · 과제","task",[["일자"],["구분"],["범위"],["점수",1],["만점",1],["제출"],["오답 단원"]],
      tasks.map(r=>`<tr data-ed="task:${r.id}"><td class="n0">${esc(r.date)}</td><td>${esc(r.type)}</td><td class="cut">${esc(r.scope||"")}</td>
        <td class="n">${r.score||"—"}</td><td class="n">${r.max||"—"}</td>
        <td><span class="pill ${r.submit==="제출"?"ok":r.submit==="미제출"?"no":"nu"}">${esc(r.submit||"—")}</span></td>
        <td class="cut">${esc(r.weak||"")}</td></tr>`).join(""), "테스트·과제 기록이 없습니다")}

    ${(()=>{ const ex=(S.examResults||[]).filter(r=>r.studentId===recStu); const sc=v=>v==null?"—":v+"점";
      return `<div class="panel"><div class="pad" style="padding-bottom:6px;display:flex;align-items:center;gap:10px"><div class="sub-h" style="margin:0">학원 시험 결과 (학원관리 성적과 같은 기록)</div><a class="btn sm ghost" style="margin-left:auto" href="#" data-goto="academy:exams">학원관리에서 입력</a></div>
      <div class="tw"><table style="min-width:620px"><thead><tr><th>시험일</th><th>시험</th><th>반</th><th class="n">점수</th><th class="n">우리 반 평균</th><th class="n">전체 평균</th><th class="n">전체 순위</th></tr></thead>
      <tbody>${ex.length?ex.map(r=>`<tr><td class="n0">${esc(r.date)}</td><td>${esc(r.examName)}${r.note?` <span class="hint">${esc(r.note)}</span>`:""}</td><td>${esc(r.className||"")}</td><td class="n"><b>${r.score==null?"미입력":r.score+"/"+r.maxScore}</b></td><td class="n">${sc(r.classAvg)}</td><td class="n">${sc(r.avg)}</td><td class="n">${r.rank==null?"—":(r.tie?"공동 ":"")+r.rank+"위 / "+r.total+"명"}</td></tr>`).join(""):`<tr><td colspan="7" class="empty">학원관리 성적에 이 학생의 시험이 없습니다</td></tr>`}</tbody></table></div></div>`; })()}

    ${(()=>{ const mks=makeupsOfStudent(recStu), t=today();
      const badge=st=>{ const lab=MK_LABEL[st]||st||"예정"; const cl=st==="완료"?"ok":st==="취소"?"no":"wr"; return `<span class="pill ${cl}">${esc(lab)}</span>`; };
      return `<div class="panel"><div class="pad" style="padding-bottom:6px;display:flex;align-items:center;gap:10px"><div class="sub-h" style="margin:0">보강 일정 · 보강 이력 (학원관리 보강과 같은 기록)</div><a class="btn sm ghost" style="margin-left:auto" href="#" data-goto="academy:makeup">학원관리에서 등록</a></div>
      <div class="tw"><table style="min-width:620px"><thead><tr><th>날짜</th><th>시간</th><th>반 · 내용</th><th>담당</th><th>상태</th><th>안내 문자</th></tr></thead>
      <tbody>${mks.length?mks.map(m=>{ const c=(S.classes||[]).find(x=>x.id===m.classId), tr=(S.teachers||[]).find(x=>x.id===m.teacherId);
        const others=(m.studentIds||[]).filter(id=>id!==recStu).length;
        return `<tr${m.date>=t&&m.status!=="취소"?' class="soon"':""}><td class="n0">${esc(m.date)}</td><td class="n0">${esc(m.start||"")}${m.end?"~"+esc(m.end):""}</td>
          <td>${esc(c?c.name:"개별 보강")}${m.title?` · ${esc(m.title)}`:""}${m.reason?` <span class="hint">${esc(m.reason)}</span>`:""}${others?` <span class="hint">외 ${others}명</span>`:""}</td>
          <td>${esc(tr?tr.name:"—")}</td><td>${badge(m.status)}</td><td class="hint">${m.notifiedAt?"보냄":"—"}</td></tr>`; }).join("")
        :`<tr><td colspan="6" class="empty">등록된 보강이 없습니다. 학원관리 [보강] 화면에서 등록하면 여기에 바로 나타납니다.</td></tr>`}</tbody></table></div>
      ${mks.length?`<p class="note" style="padding:0 16px 14px">예정 ${mks.filter(m=>(m.status||"예정")==="예정").length}건 · 진행완료 ${mks.filter(m=>m.status==="완료").length}건 · 취소 ${mks.filter(m=>m.status==="취소").length}건 · 최신 날짜가 위입니다. 내용은 학원관리 [보강]에서 고칩니다.</p>`:""}</div>`; })()}

    ${tbl("상담 이력 (학원관리 상담과 같은 기록)","counsel",[["일자"],["구분"],["내용"],["다음 상담"],["담당"]],
      cs.map(r=>`<tr data-ed="counsel:${r.id}"><td class="n0">${esc(r.date)}${r.time?" "+esc(r.time):""}</td><td>${esc(r.type)}</td>
        <td class="cut" style="max-width:360px">${esc(r.content||"")}</td><td class="n0">${esc(r.nextDate||"")}</td><td>${esc(memberName(r.memberId))}</td></tr>`).join(""),
      "상담 기록이 없습니다")}
  </section>`;
}
const REC = {
  exam:{list:"exams", kind:"내신", title:"내신 성적", fields:[
    ["year","학년도","number",2026],["term","학기","select",["1학기","2학기"]],
    ["exam","시험","select",["중간","기말","수행"]],["subject","과목","text","수학"],
    ["score","원점수","number",""],["avg","과목평균","number",""],
    ["rank","석차","number",""],["total","수강자수","number",""],
    ["level","등급","number",""],["weak","취약단원","text",""],["note","비고","textarea",""]]},
  mock:{list:"mocks", kind:"모의", title:"모의고사", fields:[
    ["date","시행일","date",""],["org","주관","select",["교육청","평가원","사설","학원자체"]],
    ["round","회차","text",""],["raw","원점수","number",""],["std","표준점수","number",""],
    ["pct","백분위","number",""],["level","등급","number",""],
    ["weak","취약단원","text",""],["note","비고","textarea",""]]},
  task:{list:"tasks", kind:"과제", title:"테스트 · 과제", fields:[
    ["date","일자","date",""],["type","구분","select",["주간테스트","단원평가","과제","클리닉","모의테스트"]],
    ["scope","범위 / 단원","text",""],["score","점수","number",""],["max","만점","number",100],
    ["submit","제출여부","select",["제출","미제출","지각제출","면제"]],
    ["weak","오답 단원","text",""],["note","비고","textarea",""]]},
  counsel:{list:"counsels", title:"상담", fields:[
    ["date","일자","date",""],["type","구분","select",CONSULT_TYPES.slice(1)],
    ["content","상담 내용 · 요청 · 후속 조치","textarea",""],["nextDate","다음 상담일","date",""]]},
};
function editRec(kind, id){
  const cfg=REC[kind], arr=S.records[cfg.list];
  const rec = id ? arr.find(x=>x.id===id) : null;
  const v = k => rec ? (rec[k]==null?"":rec[k]) : "";
  const body = cfg.fields.map(([k,label,type,dflt])=>{
    const cur = rec ? v(k) : (Array.isArray(dflt)?dflt[0]:(k==="date"?today():dflt));
    if(type==="select") return `<div class="fld"><label for="r-${k}">${label}</label><select class="inp" id="r-${k}">
      ${dflt.map(o=>`<option${String(cur)===o?" selected":""}>${o}</option>`).join("")}</select></div>`;
    if(type==="textarea") return `<div class="fld" style="grid-column:1/-1"><label for="r-${k}">${label}</label><textarea class="inp" id="r-${k}" rows="4">${esc(cur)}</textarea></div>`;
    return `<div class="fld"><label for="r-${k}">${label}</label><input class="inp" id="r-${k}" type="${type}" value="${esc(cur)}"></div>`;
  }).join("");
  openDrawer(cfg.title, `${esc(stuName(recStu))} · ${id?"수정":"새 기록"}`,
    `<div class="grid2" style="grid-template-columns:1fr 1fr">${body}</div>`,
    async ()=>{ const o = {};
      cfg.fields.forEach(([k,,type])=>{ const el=$("#r-"+k); if(!el) return; o[k] = type==="number" ? (el.value===""?"":+el.value) : el.value.trim(); });
      if(kind==="counsel"){
        await call("saveConsult",{consult:Object.assign({id:id||"", studentId:recStu}, o)});
      } else {
        await call("adminSave",{sheet:"gradebook", row:Object.assign({id:id||"", studentId:recStu, kind:cfg.kind}, o)});
      }
      toast("저장했습니다"); await refresh(); render(); },
    id?"저장":"추가", id ? async ()=>{
      if(kind==="counsel") await call("deleteConsult",{id}); else await call("adminDelete",{sheet:"gradebook", id});
      toast("삭제했습니다"); await refresh(); render(); } : null);
}
/* 성향 · 방향성 · 진로 — 학생당 한 줄(profiles 시트) */
const profileOf = id => S.records.profiles.find(p=>p.studentId===id) || {studentId:id};
const PROF = {
  trait:{title:"성향", hint:"수업에서 관찰한 것을 그대로 적어 두면 상담·반배정 때 그대로 씁니다", fields:[
    ["attitude","수업 태도","select",["미입력","매우 적극적","적극적","보통","소극적","산만함"]],
    ["homework","과제 성실도","select",["미입력","매우 성실","성실","보통","미흡","자주 미제출"]],
    ["style","문제풀이 유형","select",["미입력","개념 이해형","계산 정확형","계산 실수 잦음","시간 부족형","응용 취약","서술 취약","암기 의존"]],
    ["strength","강점 영역","text"],["weakness","약점 영역","text"],
    ["mental","시험 대응 · 멘탈","text"],["peer","수업 분위기 · 또래 관계","text"],
    ["parent","학부모 성향 · 소통 방식","text"],["traitMemo","성향 종합 메모","textarea"]]},
  direction:{title:"방향성", hint:"이 학생을 어디로 끌고 갈 것인지 한 줄로 정해 두면 담당이 바뀌어도 이어집니다", fields:[
    ["policy","지도 방침","textarea"],
    ["roadmap","선행 로드맵","text"],["nextStep","다음 단계","text"],
    ["risk","이탈 리스크","select",["미입력","낮음","보통","높음"]],
    ["riskWhy","리스크 사유","text"],["watch","관리 포인트","textarea"]]},
  career:{title:"진로 목표", hint:"", fields:[
    ["track","계열","select",["미정","이과","문과","의학계열","예체능"]],
    ["admType","전형 유형","select",["미정","수시-교과","수시-종합","수시-논술","정시"]],
    ["univ1","1지망 대학","text"],["major1","1지망 학과","text"],
    ["univ2","2지망 대학","text"],["major2","2지망 학과","text"],
    ["targetInner","목표 내신등급","text"],["curInner","현재 내신등급","text"],
    ["targetMock","목표 모의등급","text"],["curMock","현재 모의등급","text"],
    ["careerMemo","학습 전략 메모","textarea"]]},
};
function editProfile(sec){
  const cfg=PROF[sec], p=profileOf(recStu);
  const wide=f=>f[2]==="textarea";
  const one=([k,l,t,opt])=> t==="select"
    ? `<div class="fld"><label for="p-${k}">${l}</label><select class="inp" id="p-${k}">${opt.map(o=>`<option${p[k]===o?" selected":""}>${o}</option>`).join("")}</select></div>`
    : t==="textarea"
    ? `<div class="fld"><label for="p-${k}">${l}</label><textarea class="inp" id="p-${k}">${esc(p[k]||"")}</textarea></div>`
    : `<div class="fld"><label for="p-${k}">${l}</label><input class="inp" id="p-${k}" value="${esc(p[k]||"")}"></div>`;
  const pair=cfg.fields.filter(f=>!wide(f)), full=cfg.fields.filter(wide);
  openDrawer(cfg.title, esc(stuName(recStu)),
    `${cfg.hint?`<p class="note">${cfg.hint}</p>`:""}
     <div class="grid2">${pair.map(one).join("")}</div>${full.map(one).join("")}`,
    async ()=>{ const row=Object.assign({}, p, {studentId:recStu});
      cfg.fields.forEach(([k])=>{ const el=$("#p-"+k); if(el) row[k]=el.value.trim(); });
      const saved = await call("adminSave",{sheet:"profiles", row});
      const i=S.records.profiles.findIndex(x=>x.studentId===recStu); if(i>=0) S.records.profiles[i]=saved; else S.records.profiles.push(saved);
      toast(cfg.title+" 저장했습니다"); render(); });
}

/* ---------- 개별 청구 (특강 · 교재비 등 건별) ---------- */
let fP="unpaid";
function vPayments(){
  const all=S.payments, list = fP==="unpaid"?unpaid():fP==="check"?needCheck():all, m=money();
  return `<section>
    <div class="sec-row"><h2 class="sec">개별 청구</h2><span class="hint">미납 ${won(m.due)}원 · ${unpaid().length}건</span>
      <span class="spacer"></span><a class="btn sm ghost" href="#" data-goto="academy:pay">월 수강료 수납은 학원관리</a> <button class="btn sm" id="addpay">+ 청구 추가</button></div>
    <div class="chips">${[["unpaid","미납만 "+unpaid().length],["check","확인필요 "+needCheck().length],["all","전체 "+all.length]]
      .map(([k,l])=>`<button class="chip" data-fp="${k}" aria-pressed="${fP===k}">${l}</button>`).join("")}</div>
    <div class="tw panel"><table class="clk" style="min-width:760px"><thead><tr><th>학생</th><th>구분</th><th>과정</th><th>기간</th>
      <th>담당T</th><th class="n">청구</th><th class="n">납부</th><th class="n">미납</th><th>상태</th></tr></thead><tbody>
      ${list.map(p=>{const real=(p.billed||0)-(p.discount||0), d=dueOf(p);
        const cls=p.status==="완납"?"ok":p.status==="미납"?"no":p.status==="확인필요"?"wr":"nu";
        return `<tr data-pay="${p.id}"><td><b>${esc(p.name)}</b></td><td>${esc(p.kind)}</td>
        <td class="cut" style="font-size:12.5px">${esc(p.course)}</td><td style="font-size:12.5px">${esc(p.term||"")}</td><td>${esc(p.teacher||"")}</td>
        <td class="n">${won(real)}</td><td class="n">${won(p.paid)}</td>
        <td class="n ${d>0?"due-amt":""}">${d>0?won(d):"—"}</td><td><span class="pill ${cls}">${esc(p.status)}</span></td></tr>`;}).join("")
        || `<tr><td colspan="9" class="empty">해당 건이 없습니다</td></tr>`}</tbody></table></div>
    <p class="note">청구금액에서 할인을 뺀 값이 실청구액, 거기서 납부액을 뺀 값이 미납입니다.
      납부액을 넣으면 학원관리 [수납]에도 같은 금액이 한 줄로 기록됩니다 (선행·정규는 수강료, 교재비는 교재비, 특강 등은 기타).</p></section>`;
}
function billForm(p){
  return `
    <div class="grid2"><div class="fld"><label for="p-bill">청구금액</label><input class="inp" id="p-bill" type="number" step="10000" value="${p.billed||0}"></div>
      <div class="fld"><label for="p-disc">할인</label><input class="inp" id="p-disc" type="number" step="10000" value="${p.discount||0}"></div></div>
    <div class="grid2"><div class="fld"><label for="p-paid">납부액</label><input class="inp" id="p-paid" type="number" step="10000" value="${p.paid||0}"></div>
      <div class="fld"><label for="p-st">납부여부</label><select class="inp" id="p-st">${PAYSTATUS.map(t=>`<option${p.status===t?" selected":""}>${t}</option>`).join("")}</select></div></div>
    <div class="grid2"><div class="fld"><label for="p-m">납부방법</label><select class="inp" id="p-m">${METHODS.map(t=>`<option value="${t}"${p.method===t?" selected":""}>${t||"—"}</option>`).join("")}</select></div>
      <div class="fld"><label for="p-at">납부일</label><input class="inp" id="p-at" type="date" value="${esc(p.paidAt||"")}"></div></div>
    <div class="grid2"><div class="fld"><label for="p-h">처리자</label><input class="inp" id="p-h" value="${esc(p.handler||"")}"></div>
      <div class="fld"><label for="p-t">담당T</label><select class="inp" id="p-t">${TEACHERS.map(t=>`<option${(p.teacher||"")===t?" selected":""}>${t}</option>`).join("")}<option value=""${!p.teacher?" selected":""}>—</option></select></div></div>
    <div class="fld"><label for="p-note">비고</label><textarea class="inp" id="p-note">${esc(p.note||"")}</textarea></div>
    <button class="btn ghost" id="p-full" style="align-self:flex-start">전액 납부로 채우기</button>`;
}
function readBillForm(p){
  return Object.assign({}, p, {billed:+$("#p-bill").value||0, discount:+$("#p-disc").value||0, paid:+$("#p-paid").value||0,
    status:$("#p-st").value, method:$("#p-m").value, paidAt:$("#p-at").value, handler:$("#p-h").value.trim(), teacher:$("#p-t").value, note:$("#p-note").value.trim()});
}
function wireBillForm(){
  $("#p-full").onclick=()=>{ const r=(+$("#p-bill").value||0)-(+$("#p-disc").value||0);
    $("#p-paid").value=r; $("#p-st").value="완납"; if(!$("#p-at").value) $("#p-at").value=today(); };
}
function editPayment(id){
  const p=S.payments.find(x=>x.id===id); if(!p) return;
  const real=(p.billed||0)-(p.discount||0);
  openDrawer(esc(p.name), `${esc(p.kind)} · ${esc(p.course)}${p.term?" · "+esc(p.term):""}`,
    `<div class="ro">실청구액 <b>${won(real)}원</b> · 미납 <b>${won(real-(p.paid||0))}원</b></div>` + billForm(p),
    async ()=>{ const row=readBillForm(p); delete row.name;
      await call("adminSave",{sheet:"bills", row}); toast(p.name+" 저장했습니다"); await refresh(); render(); },
    "저장", async ()=>{ await call("adminDelete",{sheet:"bills", id}); toast("삭제했습니다"); await refresh(); render(); });
  wireBillForm();
}
function addPayment(){
  const sorted=[...S.students].sort((a,b)=>(a.status==="재원"?0:1)-(b.status==="재원"?0:1)||String(a.name).localeCompare(String(b.name),"ko"));
  openDrawer("새 청구", "특강 · 교재비 등 건별 청구", `
    <div class="fld"><label for="a-stu">학생</label><select class="inp" id="a-stu">
      ${sorted.map(s=>`<option value="${s.id}">${esc(s.name)}${s.status!=="재원"?" ("+esc(s.status)+")":""}${s.school?" · "+esc(s.school):""}</option>`).join("")}</select></div>
    <div class="grid2"><div class="fld"><label for="a-kind">구분</label><select class="inp" id="a-kind">
      ${BILL_KINDS.map(o=>`<option>${o}</option>`).join("")}</select></div>
      <div class="fld"><label for="a-course">과정 / 반명</label><input class="inp" id="a-course" placeholder="예: 공통수학I 여름특강"></div></div>
    <div class="fld"><label for="a-term">청구기간</label><input class="inp" id="a-term" value="${esc(S.meta&&S.meta.term||"")}"></div>`
    + billForm({billed:0, discount:0, paid:0, status:"미납", method:"", paidAt:"", handler:"", teacher:"", note:""}),
    async ()=>{ const sid=$("#a-stu").value, s=stu(sid);
      const row=readBillForm({id:"", studentId:sid, kind:$("#a-kind").value, course:$("#a-course").value.trim()||"미지정", term:$("#a-term").value.trim()});
      if(!row.teacher && s) row.teacher = s.homeroom==="확인필요" ? "" : s.homeroom;
      await call("adminSave",{sheet:"bills", row}); toast("청구를 추가했습니다"); fP="all"; await refresh(); render(); }, "추가");
  wireBillForm();
}

/* ---------- 달력 ---------- */
let calY=null, calM=null;
/* ---------- 달력 ---------- */
/** 보고 싶은 구분만 켜 둔다 (이 브라우저에 기억) */
const CAL_LS = "mm-admin-cal-types";
let calOff = (()=>{ try{ return new Set(JSON.parse(localStorage.getItem(CAL_LS)||"[]")); }catch(e){ return new Set(); } })();
const calSaveOff = () => { try{ localStorage.setItem(CAL_LS, JSON.stringify([...calOff])); }catch(e){} };
const CAL_KINDS = [...EVTYPES, "보강"];
const dPlus = (iso,n) => { const d=new Date(iso+"T00:00:00"); d.setDate(d.getDate()+n); return fmtDate(d); };
const dDiff = (a,b) => Math.round((new Date(b+"T00:00:00") - new Date(a+"T00:00:00"))/86400000);
const mdShort = iso => `${+iso.slice(5,7)}/${+iso.slice(8,10)}`;
/** 학교 시험기간 목록 (events 의 시험기간 구분 · 끝나는 날이 없으면 하루) */
function examPeriods(){
  return (S.events||[]).filter(e=>e.type==="시험기간")
    .map(e=>({...e, end:e.endDate||e.date}))
    .sort((a,b)=> a.date===b.date ? String(a.school||a.title).localeCompare(String(b.school||b.title),"ko") : (a.date<b.date?-1:1));
}
const examName = e => (e.school ? e.school + " " : "") + (e.title || "시험기간");
/** 곧 시작하거나 진행 중인 학교 시험기간 (원장실 홈에서도 쓴다) */
function examSoon(days){
  const t=today();
  return examPeriods().filter(e=> e.end>=t && dDiff(t,e.date)<=(days==null?7:days));
}
function vCalendar(){
  const now=new Date();
  if(calY==null){ calY=now.getFullYear(); calM=now.getMonth(); }
  const first=new Date(calY,calM,1), start=new Date(first); start.setDate(1-first.getDay());
  const cells=[]; const t=today();
  for(let i=0;i<42;i++){ const d=new Date(start); d.setDate(start.getDate()+i);
    const iso=fmtDate(d);
    cells.push({iso, day:d.getDate(), out:d.getMonth()!==calM, sun:d.getDay()===0, dow:d.getDay(), today:iso===t}); }
  while(cells.length>35 && cells.slice(35).every(c=>c.out)) cells.length=35;
  const on = k => !calOff.has(k);
  // 날짜별 일정 (시험기간은 따로 띠로 그린다)
  const byDate={}, cnt={};
  CAL_KINDS.forEach(k=>cnt[k]=0);
  const ym=`${calY}-${pad(calM+1)}`;
  S.events.forEach(e=>{
    if(String(e.date).startsWith(ym) || (e.type==="시험기간" && (e.endDate||e.date)>=ym+"-01" && e.date<=ym+"-31")) cnt[e.type]=(cnt[e.type]||0)+1;
    if(e.type==="시험기간" || !on(e.type)) return;
    (byDate[e.date]=byDate[e.date]||[]).push({...e, kindMk:false});
  });
  (S.makeups||[]).filter(m=>m.status!=="취소").forEach(m=>{
    if(String(m.date).startsWith(ym)) cnt["보강"]++;
    if(!on("보강")) return;
    (byDate[m.date]=byDate[m.date]||[]).push({id:m.id, date:m.date, type:"보강", kindMk:true, done:m.status==="완료",
      title:`${m.start?m.start+" ":""}${mkLabel(m)}`});
  });
  // 원장이 진행한 상담의 "다음 상담 예정일" (학원관리 상담 기록 그대로 · 달력에 따로 만들지 않는다)
  adminConsultsNext().forEach(k=>{
    if(String(k.nextDate).startsWith(ym)) cnt["상담"]=(cnt["상담"]||0)+1;
    if(!on("상담")) return;
    (byDate[k.nextDate]=byDate[k.nextDate]||[]).push({id:k.id, date:k.nextDate, type:"상담", kindCs:true, title:`상담 예정 · ${consultWho(k)}`});
  });
  Object.keys(byDate).forEach(k=>byDate[k].sort((a,b)=>String(a.title).localeCompare(String(b.title))));
  // 시험기간 띠: 달력에 걸치는 것만, 학교마다 색을 돌려 쓴다
  const periods = on("시험기간") ? examPeriods().filter(p=>p.end>=cells[0].iso && p.date<=cells[cells.length-1].iso) : [];
  const colorOf={}; periods.forEach(p=>{ const k=p.school||p.title||p.id; if(!colorOf[k]) colorOf[k]="c"+((Object.keys(colorOf).length%5)+1); });   // 학교마다 색 하나 (요약줄과 띠가 같은 색)
  const bandsOf = c => periods.filter(p=>p.date<=c.iso && c.iso<=p.end).map(p=>{
    const s0=p.date===c.iso, e0=p.end===c.iso, head=s0||c.dow===0;
    return `<span class="band ${colorOf[p.school||p.title||p.id]}${s0?" s":""}${e0?" e":""}${head?"":" mid"}" data-ev="${esc(p.id)}"
      title="${esc(examName(p))} ${esc(mdShort(p.date))}~${esc(mdShort(p.end))}">${head?esc(examName(p)):"&nbsp;"}</span>`;
  }).join("");
  const monthEv=S.events.filter(e=>String(e.date).startsWith(ym)).length, monthMk=(S.makeups||[]).filter(m=>m.status!=="취소"&&String(m.date).startsWith(ym)).length;
  const hidden=CAL_KINDS.filter(k=>!on(k));
  const soon=on("시험기간") ? examSoon(60).filter(p=>p.date<=ym+"-31") : [];   // 구분을 꺼 두면 위 요약줄도 같이 숨긴다
  return `<section>
    <div class="sec-row"><h2 class="sec">운영 캘린더</h2><span class="hint">이번 달 일정 ${monthEv}건 · 보강 ${monthMk}건${hidden.length?` · <b>${hidden.join("·")}</b> 숨김`:""}</span></div>
    <div class="cal-head">
      <button class="btn ghost sm" data-cal="-1">‹ 이전</button>
      <span class="m">${calY}년 ${calM+1}월</span>
      <button class="btn ghost sm" data-cal="1">다음 ›</button>
      <button class="btn ghost sm" data-cal="0">오늘</button>
      <button class="btn sm" data-caladd>+ 일정 추가</button>
      <span class="legend" style="margin:0 0 0 auto">
        ${CAL_KINDS.map(k=>`<button type="button" data-ctype="${k}" aria-pressed="${on(k)}" title="누르면 달력에서 숨기거나 다시 보여 줍니다">
          <i class="ev ${k}" style="width:11px;height:11px;padding:0;border-radius:3px;border-left-width:11px"></i>${k}<span class="n">${cnt[k]||0}</span></button>`).join("")}
        ${hidden.length?`<button type="button" data-ctype="__all" aria-pressed="true" style="font-weight:700">모두 보기</button>`:""}
      </span>
    </div>
    ${soon.length?`<div class="exambar">${soon.map(p=>{ const d=dDiff(t,p.date), run=p.date<=t&&t<=p.end;
      return `<button type="button" class="x" data-ev="${esc(p.id)}">
        <span class="sw band ${colorOf[p.school||p.title||p.id]||"c1"}" style="padding:0"></span><span class="nm">${esc(p.school||"학교 미정")}</span>
        <span>${esc(p.title||"시험기간")}</span>
        <span class="dd ${run||d<=3?"on":""}">${esc(mdShort(p.date))}~${esc(mdShort(p.end))} · ${run?"진행 중":(d===0?"오늘 시작":`D-${d}`)}</span></button>`;}).join("")}</div>`:""}
    <div class="cal">
      ${["일","월","화","수","목","금","토"].map((d,i)=>`<div class="dow${i===0?" sun":""}">${d}</div>`).join("")}
      ${cells.map(c=>{ const list=byDate[c.iso]||[], nb=periods.filter(p=>p.date<=c.iso&&c.iso<=p.end).length, room=Math.max(1,3-nb);
        return `<button class="cell${c.out?" out":""}${c.sun?" sun":""}${c.today?" today":""}" data-day="${c.iso}">
        <span class="dn">${c.day}</span>
        ${bandsOf(c)}
        ${list.slice(0,room).map(e=>`<span class="ev ${e.type}${e.done?" done":""}" data-${e.kindMk?"mk":e.kindCs?"cs":"ev"}="${e.id}">${esc(e.title)}</span>`).join("")}
        ${list.length>room?`<span class="ev" style="border:0;background:none;color:var(--ink-3)" data-more="${c.iso}">+${list.length-room}건 더 보기</span>`:""}
      </button>`;}).join("")}
    </div>
    <p class="note"><b>+ 일정 추가</b>로 새 일정을 넣습니다. 일정을 누르면 내용을 보고([수정]으로 고침), 날짜 빈 곳을 누르면 그 날 일정 목록이 나옵니다. 위 <b>구분 단추</b>를 눌러 보고 싶은 것만 볼 수 있습니다(이 기기에 기억됩니다).
      학교 <b>시험기간</b>은 구분을 "시험기간"으로 고르고 학교·시작일·끝나는 날을 넣으면 띠로 깔립니다.
      <b>보강</b>은 학원관리 [보강] 화면에서 등록·수정·삭제한 것이 그대로 보입니다 (달력에 따로 만들지 않으므로 중복되지 않습니다).</p>
  </section>`;
}
/** 하루치 전체 목록 (칸에 다 안 들어갈 때 [+N건 더 보기]) */
function dayList(iso){
  const evs=(S.events||[]).filter(e=>e.type!=="시험기간" && e.date===iso);
  const per=examPeriods().filter(p=>p.date<=iso && iso<=p.end);
  const mks=(S.makeups||[]).filter(m=>m.status!=="취소" && m.date===iso), css=adminConsultsNext().filter(k=>k.nextDate===iso);
  const row=(cls,label,attr)=>`<button type="button" class="x" ${attr}><span class="sw" style="background:var(--accent)"></span><span>${label}</span></button>`;
  openDrawer(`${iso} 일정`, `${evs.length+per.length+mks.length+css.length}건`, `
    <div class="exambar">
      ${per.map(p=>row("", `<b>시험기간</b> ${esc(examName(p))} <span class="dd">${esc(mdShort(p.date))}~${esc(mdShort(p.end))}</span>`, `data-devt="${esc(p.id)}"`)).join("")}
      ${evs.map(e=>row("", `<b>${esc(e.type)}</b> ${esc(e.title)}${e.target?` <span class="dd">${esc(e.target)}</span>`:""}`, `data-devt="${esc(e.id)}"`)).join("")}
      ${mks.map(m=>row("", `<b>보강</b> ${esc(m.start||"")} ${esc(mkLabel(m))}`, `data-dmk="${esc(m.id)}"`)).join("")}
      ${css.map(k=>row("", `<b>상담 예정</b> ${esc(consultWho(k))} <span class="dd">${esc(k.type||"")}</span>`, `data-dcs="${esc(k.id)}"`)).join("")}
      ${evs.length+per.length+mks.length+css.length?"":`<p class="note">이 날은 일정이 없습니다.</p>`}
    </div>
    <p class="note" style="margin-top:10px">누르면 그 일정을 엽니다. 보강은 학원관리 [보강] 화면에서 고칩니다.</p>`,
    async ()=>{ editEvent(null, iso); }, "이 날에 일정 추가", null);
  setTimeout(()=>{ $$("[data-devt]").forEach(b=>b.onclick=()=>viewEvent(b.dataset.devt));
                   $$("[data-dmk]").forEach(b=>b.onclick=()=>viewMakeup(b.dataset.dmk));
                   $$("[data-dcs]").forEach(b=>b.onclick=()=>openConsultById(b.dataset.dcs)); }, 30);
}
/** 원장(관리자) 아이디로 쓴 상담 중 다음 상담 예정일이 있는 것 */
const isAdminMember = id => { const m=MEMBERS.get(id); return !!m && m.role==="admin"; };
const adminConsultsNext = () => (S.records.counsels||[]).filter(k=>k.nextDate && isAdminMember(k.memberId));
const consultWho = k => k.studentId ? nameOfStudent(k.studentId) : (k.name || "신규 문의");
/** 상담은 학원관리 상담 창에서 연다 (같은 기록) */
function openConsultById(id){ const k=(S.records.counsels||[]).find(x=>x.id===id); if(k){ closeDrawer(); CTX.openConsult(k); } }
const MK_LABEL = {예정:"예정", 완료:"진행완료", 취소:"취소"};   // 저장값은 학원관리와 같은 예정/완료/취소 · 화면에만 "진행완료"로 쓴다
/** 한 학생의 보강 (makeups 원본에서 studentIds 에 그 학생이 들어간 것만, 최신 날짜가 위) */
function makeupsOfStudent(id){
  return (S.makeups||[]).filter(m=>(m.studentIds||[]).includes(id))
    .sort((a,b)=> a.date===b.date ? String(b.start||"").localeCompare(String(a.start||"")) : (a.date<b.date?1:-1));
}
/** 달력에 쓰는 보강 한 줄 이름: 반 이름(없으면 제목) + 학생 수 */
function mkLabel(m){
  const cls=(S.classes||[]).find(c=>c.id===m.classId);
  const who=(m.studentIds||[]).length===1 ? nameOfStudent(m.studentIds[0]) : `${(m.studentIds||[]).length}명`;
  return `보강 · ${m.title || (cls?cls.name:"") || "보강"} (${who})`;
}
function nameOfStudent(id){ const s=(S.students||[]).find(x=>x.id===id); return s?s.name:"학생"; }
/** 보강은 학원관리에서 관리하므로 달력에서는 내용만 보여준다 (읽기 전용) */
function viewMakeup(id){
  const m=(S.makeups||[]).find(x=>x.id===id); if(!m) return;
  const cls=(S.classes||[]).find(c=>c.id===m.classId), t=(S.teachers||[]).find(x=>x.id===m.teacherId);
  const names=(m.studentIds||[]).map(nameOfStudent).join(", ");
  openDrawer("보강 일정", `${m.date} ${m.start||""}${m.end?"~"+m.end:""}`, `
    <div class="kv2"><span>구분</span><b>보강 (${esc(m.status||"예정")})</b></div>
    <div class="kv2"><span>날짜·시간</span><b>${esc(m.date)} ${esc(m.start||"")}${m.end?"~"+esc(m.end):""}</b></div>
    <div class="kv2"><span>반</span><b>${esc(cls?cls.name:"반 없음 (개별 보강)")}</b></div>
    <div class="kv2"><span>대상 학생</span><b>${esc(names||"-")}</b></div>
    <div class="kv2"><span>담당 선생님</span><b>${esc(t?t.name:"-")}</b></div>
    <div class="kv2"><span>내용</span><b>${esc(m.title||"-")}</b></div>
    <div class="kv2"><span>사유</span><b>${esc(m.reason||"-")}</b></div>
    <div class="kv2"><span>메모</span><b>${esc(m.memo||"-")}</b></div>
    <div class="kv2"><span>안내 문자</span><b>${m.notifiedAt?"보냄":"아직 안 보냄"}</b></div>
    <p class="note" style="margin-top:10px">보강 일정은 <b>학원관리 → 보강</b> 화면에서 등록·수정·삭제합니다. 여기서 고친 내용은 달력에 바로 반영됩니다.</p>`, null);
}
/** 일정 내용 보기 (달력에서 누르면 먼저 이것) · [수정] 으로 편집 */
function viewEvent(id){
  const ev=S.events.find(x=>x.id===id); if(!ev) return;
  const when = ev.endDate && ev.endDate!==ev.date ? `${ev.date} ~ ${ev.endDate}` : ev.date;
  const row=(k,v)=>v?`<div class="kv2"><span>${k}</span><b style="white-space:pre-wrap">${esc(v)}</b></div>`:"";
  openDrawer(esc(ev.title||"(제목 없음)"), `${esc(ev.type||"")} · ${esc(when)}`, `
    ${row("구분", ev.type)}${row("날짜", when)}${row("학교", ev.school)}${row("제목", ev.title)}${row("대상", ev.target)}${row("메모", ev.note)}
    <p class="note" style="margin-top:10px">고치거나 지우려면 아래 <b>수정</b>을 누르세요.</p>`,
    async ()=>{ setTimeout(()=>editEvent(id), 0); }, "수정", null);
}
function editEvent(id, date){
  const ev = id ? S.events.find(x=>x.id===id) : null;
  const schools=[...new Set((S.students||[]).map(x=>x.school).filter(x=>x&&x!=="확인필요"))].sort((a,b)=>a.localeCompare(b,"ko"));
  openDrawer(ev?"일정 수정":"일정 추가", ev?ev.date:date, `
    <div class="grid2">
      <div class="fld"><label for="e-date">날짜</label><input class="inp" id="e-date" type="date" value="${esc(ev?ev.date:date)}"></div>
      <div class="fld"><label for="e-type">구분</label><select class="inp" id="e-type">${EVTYPES.map(t=>`<option${ev&&ev.type===t?" selected":""}>${t}</option>`).join("")}</select></div></div>
    <div class="grid2">
      <div class="fld"><label for="e-end">끝나는 날 <span class="hint">며칠 이어지면</span></label><input class="inp" id="e-end" type="date" value="${esc(ev&&ev.endDate?ev.endDate:"")}"></div>
      <div class="fld"><label for="e-school">학교 <span class="hint">시험기간일 때</span></label><input class="inp" id="e-school" list="e-schools" value="${esc(ev&&ev.school?ev.school:"")}" placeholder="예: 성광중">
        <datalist id="e-schools">${schools.map(x=>`<option value="${esc(x)}">`).join("")}</datalist></div></div>
    <div class="fld"><label for="e-title">제목</label><input class="inp" id="e-title" value="${esc(ev?ev.title:"")}" placeholder="예: 2학기 중간고사"></div>
    <div class="fld"><label for="e-target">대상</label><input class="inp" id="e-target" value="${esc(ev?ev.target:"")}" placeholder="예: 중2 전체 / 김도윤"></div>
    <div class="fld"><label for="e-note">메모</label><textarea class="inp" id="e-note">${esc(ev?ev.note:"")}</textarea></div>
    <p class="note">구분을 <b>시험기간</b>으로 하고 학교·시작일·끝나는 날을 넣으면 달력에 학교별 색 띠로 깔리고, 시작이 가까우면 달력 위와 대시보드에 <b>D-일</b>로 뜹니다.</p>`,
    async ()=>{ const row={id:ev?ev.id:"", date:$("#e-date").value||date, type:$("#e-type").value, title:$("#e-title").value.trim()||"(제목 없음)",
        endDate:$("#e-end").value||"", school:$("#e-school").value.trim(),
        target:$("#e-target").value.trim(), note:$("#e-note").value.trim()};
      const saved=await call("adminSave",{sheet:"events", row});
      const i=S.events.findIndex(x=>x.id===saved.id); if(i>=0) S.events[i]=saved; else S.events.push(saved);
      toast("저장했습니다"); render(); },
    ev?"저장":"추가",
    ev ? async ()=>{ await call("adminDelete",{sheet:"events", id}); S.events=S.events.filter(x=>x.id!==id); toast("삭제했습니다"); render(); } : null);
}

/* ---------- 테스트 일정 ---------- */
const TEST_TYPE=["주간테스트","단원평가","모의고사","내신대비","레벨테스트","기타"];
function vTests(){
  const up=nextTests(), donePast=S.ops.tests.filter(t=>t.done||(t.date&&dday(t.date)<0))
    .sort((a,b)=>a.date<b.date?1:-1);
  const soon=soonTests();
  const row=t=>{const n=t.date?dday(t.date):null, near=n!=null&&n>=0&&n<=2;
    return `<tr data-op="test:${t.id}"${near&&!t.done?' style="background:var(--warn-bg)"':""}>
    <td class="n0">${esc(t.date||"—")}</td>
    <td>${t.date?`<span class="pill ${n===0?"no":near?"wr":"nu"}">${ddayLabel(t.date)}</span>`:""}</td>
    <td><b>${esc(t.title)}</b></td><td>${esc(t.type||"")}</td><td>${esc(t.target||"")}</td>
    <td class="cut">${esc(t.scope||"")}</td><td>${esc(t.teacher||"")}</td>
    <td>${t.done?'<span class="pill ok">완료</span>':'<span class="pill nu">예정</span>'}</td></tr>`;};
  return `<section>
    <div class="sec-row"><h2 class="sec">테스트 일정</h2><span class="hint">예정 ${up.length}건</span>
      <span class="spacer"></span><button class="btn sm" data-addop="test">+ 테스트 추가</button></div>
    ${soon.length?`<div class="banner warn"><b>이틀 안에 테스트가 ${soon.length}건 있습니다.</b><br>
      ${soon.map(t=>`${ddayLabel(t.date)} · ${esc(t.title)}${t.target?" ("+esc(t.target)+")":""}`).join("<br>")}</div>`:""}
    <div class="tw panel"><table class="clk" style="min-width:760px"><thead><tr><th>일자</th><th>남은날</th>
      <th>테스트명</th><th>구분</th><th>대상</th><th>범위</th><th>담당T</th><th>상태</th></tr></thead><tbody>
      ${up.map(row).join("") || `<tr><td colspan="8" class="empty">예정된 테스트가 없습니다</td></tr>`}
    </tbody></table></div>
    ${donePast.length?`<div class="sec-row" style="margin-top:8px"><h2 class="sec" style="font-size:18px">지난 테스트</h2>
      <span class="hint">${donePast.length}건</span></div>
      <div class="tw panel"><table class="clk" style="min-width:760px"><thead><tr><th>일자</th><th></th>
        <th>테스트명</th><th>구분</th><th>대상</th><th>범위</th><th>담당T</th><th>상태</th></tr></thead>
        <tbody>${donePast.slice(0,25).map(row).join("")}</tbody></table></div>`:""}
    <p class="note">테스트 날짜가 <b>이틀 앞</b>으로 다가오면 이 화면과 대시보드 맨 위에 경고가 뜹니다. 반 단위 시험 점수 입력은 학원관리 [성적]입니다.</p></section>`;
}

/* ---------- 운영 항목 편집 (시재 · 테스트) ---------- */
const OPS={
  supply:{list:"supplies", sheet:"supplies", title:"시재 품목", fields:[
    ["name","품목명","text"],["category","구분","select",SUP_CAT],
    ["qty","현재 수량","number"],["minQty","최소 보유량","number"],
    ["unit","단위","text"],["lastIn","최근 입고일","date"],
    ["vendor","구입처","text"],["note","비고","textarea"]]},
  test:{list:"tests", sheet:"tests", title:"테스트", fields:[
    ["date","일자","date"],["title","테스트명","text"],
    ["type","구분","select",TEST_TYPE],["target","대상 반 / 학생","text"],
    ["teacher","담당T","select",TEACHERS],["scope","범위","text"],
    ["note","준비물 · 비고","textarea"]]},
};
function editOp(kind, id){
  const cfg=OPS[kind], arr=S.ops[cfg.list];
  const rec = id ? arr.find(x=>x.id===id) : null;
  const wide=f=>f[2]==="textarea";
  const one=([k,label,type,opt])=>{
    const cur = rec ? (rec[k]==null?"":rec[k]) : (k==="date"?today():"");
    const opts = k==="teacher" ? TEACHERS : opt;
    if(type==="select") return `<div class="fld"><label for="o-${k}">${label}</label><select class="inp" id="o-${k}">
      <option value=""></option>${opts.map(o=>`<option${String(cur)===o?" selected":""}>${o}</option>`).join("")}</select></div>`;
    if(type==="textarea") return `<div class="fld"><label for="o-${k}">${label}</label><textarea class="inp" id="o-${k}">${esc(cur)}</textarea></div>`;
    return `<div class="fld"><label for="o-${k}">${label}</label><input class="inp" id="o-${k}" type="${type}" value="${esc(cur)}"></div>`;
  };
  const pair=cfg.fields.filter(f=>!wide(f)), full=cfg.fields.filter(wide);
  openDrawer(cfg.title, id?"수정":"새 항목",
    `<div class="grid2">${pair.map(one).join("")}</div>${full.map(one).join("")}
     ${kind==="supply"?`<p class="note">현재 수량을 비워두면 알림 대상에서 빠집니다.</p>`:""}
     ${kind==="test"&&rec?`<label style="display:flex;gap:8px;align-items:center;font-size:13.5px;color:var(--ink-2)">
       <input type="checkbox" id="o-done" ${rec.done?"checked":""} style="width:16px;height:16px;accent-color:var(--accent)">완료 처리</label>`:""}`,
    async ()=>{ const o = {id: rec?rec.id:""};
      cfg.fields.forEach(([k,,type])=>{ const el=$("#o-"+k); if(!el) return; o[k] = type==="number" ? (el.value===""?"":Number(el.value)) : el.value.trim(); });
      if($("#o-done")) o.done=$("#o-done").checked; else o.done = rec ? !!rec.done : false;
      const saved=await call("adminSave",{sheet:cfg.sheet, row:o});
      const i=arr.findIndex(x=>x.id===saved.id); if(i>=0) arr[i]=saved; else arr.push(saved);
      toast("저장했습니다"); render(); },
    id?"저장":"추가",
    id ? async ()=>{ await call("adminDelete",{sheet:cfg.sheet, id}); S.ops[cfg.list]=arr.filter(x=>x.id!==id); toast("삭제했습니다"); render(); } : null);
}

/* ---------- 점검 · 옛 자료 가져오기 ---------- */
function vIssues(){
  const P={"높음":0,"중간":1,"낮음":2};
  const list=[...S.issues].sort((a,b)=>(a.done-b.done)||((P[a.priority]??3)-(P[b.priority]??3)));
  const n=p=>S.issues.filter(i=>i.priority===p&&!i.done).length, tot=Math.max(openIssues().length,1);
  return `<section><div class="sec-row"><h2 class="sec">데이터 정합성</h2><span class="hint">미처리 ${openIssues().length} / ${S.issues.length}건</span></div>
  <div class="panel pad">
    <div style="display:flex;height:10px;border-radius:5px;overflow:hidden;gap:2px">
      <i style="background:var(--due);width:${n("높음")/tot*100}%"></i>
      <i style="background:var(--warn);width:${n("중간")/tot*100}%"></i>
      <i style="background:var(--accent);width:${n("낮음")/tot*100}%"></i></div>
    <div class="legend" style="margin:10px 0 0">
      <span><i style="background:var(--due)"></i>높음 ${n("높음")}건</span>
      <span><i style="background:var(--warn)"></i>중간 ${n("중간")}건</span>
      <span><i style="background:var(--accent)"></i>낮음 ${n("낮음")}건</span></div></div>
  <div class="panel pad"><div class="flags">${list.map(i=>`<div class="issue${i.done?" done":""}">
    <input type="checkbox" data-iss="${i.id}"${i.done?" checked":""} aria-label="${esc(i.target)} 처리 완료">
    <div><div class="ti">${esc(i.category)} — ${esc(i.target)}</div><div class="de">${esc(i.detail)}</div>
    <div class="ac">→ ${esc(i.action)}</div></div>
    <span class="pill ${i.priority==="높음"?"no":i.priority==="중간"?"wr":"nu"}">${esc(i.priority||"")}</span></div>`).join("") || `<div class="empty">점검 항목이 없습니다</div>`}</div></div>
  <p class="note">체크하면 처리 완료로 저장됩니다. 원본 데이터는 <a href="${LINKS.sheet}" target="_blank" rel="noopener">구글 시트</a>에 그대로 있습니다.</p>
  <div class="panel pad"><div class="sub-h">옛 원장실(Claude) 자료 가져오기</div>
    <p class="note">Claude 원장실에서 내려받은 JSON 파일(달력·시재·점검·개별 청구·기록카드)을 이 시트에 넣습니다.
      학생·반·수강은 이미 학원관리에 있으므로 가져오지 않습니다. 같은 파일을 다시 넣어도 중복되지 않습니다.</p>
    <div class="bar-tools"><input type="file" id="imp-file" accept=".json,application/json" class="inp">
      <button class="btn sm" id="imp-go" disabled>가져오기</button></div>
    <p class="note" style="margin-top:8px">휴대폰이라 파일을 올리기 어려우면, 옛 자료를 옮겨 둔 <b>구글 시트 주소</b>를 넣어 가져올 수 있습니다
      (첫 탭 A열에 내보내기 JSON 을 그대로 붙여 넣은 시트, 또는 탭 이름이 events·supplies·issues·gradebook·profiles·bills·meta 인 시트).
      원장 구글 계정이 열 수 있는 시트여야 합니다.</p>
    <div class="bar-tools"><button class="btn sm" id="imp-sheet">구글 시트에서 가져오기</button></div>
    <div class="note" id="imp-out" style="margin-top:8px;white-space:pre-wrap">${esc(impReport)}</div></div>
  </section>`;
}
let impData=null, impReport="";
function impDone(r){
  const label={events:"달력",tests:"테스트",supplies:"시재",issues:"점검",gradebook:"기록",profiles:"프로필",bills:"청구",meta:"학기/수강료표"};
  impReport = "가져오기 완료 (" + new Date().toLocaleString("ko-KR") + "): " + Object.keys(r).filter(k=>label[k]).map(k=>`${label[k]} ${r[k]===true?"저장":r[k]}`).join(" · ")
    + (r.sheet ? `\n시트: ${r.sheet}` : "")
    + (r.skippedCount ? `\n건너뜀 ${r.skippedCount}건: ${r.skipped.join(", ")}` : "");
}
async function importSheet(){
  const id=prompt("옛 자료가 든 구글 시트의 주소(URL) 또는 ID 를 넣어 주세요.");
  if(!id || !id.trim()) return;
  if(!confirm("이 시트의 자료를 원장실 시트에 넣습니다.\n청구의 납부액은 학원관리 수납에도 기록됩니다. 진행할까요?")) return;
  const btn=$("#imp-sheet"), out=$("#imp-out"); btn.disabled=true; btn.textContent="넣는 중… (1~2분)"; out.textContent="";
  try{
    const r = await call("adminImportSheet", {sheetId:id.trim()});
    impDone(r); await refresh(); render(); toast("옛 자료를 넣었습니다");
  }catch(err){ out.textContent="실패: "+friendly(err); btn.disabled=false; btn.textContent="구글 시트에서 가져오기"; }
}
async function importOld(){
  if(!impData) return;
  const cnt=k=>Array.isArray(impData[k])?impData[k].length:0;
  const summary=`달력 ${cnt("events")} · 테스트 ${cnt("tests")} · 시재 ${cnt("supplies")} · 점검 ${cnt("issues")} · 기록 ${cnt("gradebook")} · 프로필 ${cnt("profiles")} · 청구 ${cnt("bills")}`;
  if(!confirm("옛 원장실 자료를 시트에 넣습니다.\n"+summary+"\n\n청구의 납부액은 학원관리 수납에도 기록됩니다. 진행할까요?")) return;
  const btn=$("#imp-go"), out=$("#imp-out"); btn.disabled=true; btn.textContent="넣는 중… (1~2분)"; out.textContent="";
  try{
    const r = await call("adminImport", impData);
    impDone(r); impData=null; await refresh(); render(); toast("옛 자료를 넣었습니다");
  }catch(err){ out.textContent="실패: "+friendly(err); btn.disabled=false; btn.textContent="가져오기"; }
}

/* ---------- drawer ---------- */
let onSave=null;
function openDrawer(title, sub, body, saver, label, remover){
  onSave=saver;
  $("#drawer").innerHTML=`<div class="dr-head"><div><h3 id="dr-title">${title}</h3><div class="sub">${sub}</div></div>
    <button class="x" id="dr-x" aria-label="닫기">×</button></div>
    <div class="dr-body">${body}</div>
    ${saver?`<div class="dr-foot"><button class="btn" id="dr-save">${label||"저장"}</button>
      <button class="btn ghost" id="dr-cancel">취소</button>
      ${remover?`<button class="btn danger sp" id="dr-del">삭제</button>`:""}</div>`:""}`;
  $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
  const f=$(".dr-body input,.dr-body select,.dr-body textarea"); if(f) f.focus();
  $("#dr-x").onclick=closeDrawer;
  if($("#dr-cancel")) $("#dr-cancel").onclick=closeDrawer;
  if($("#dr-save")) $("#dr-save").onclick=async e=>{ e.target.disabled=true;
    try{ await onSave(); closeDrawer(); }
    catch(err){ e.target.disabled=false; failedInDrawer(err); } };
  /* 삭제는 두 번 누르기로 확인한다 */
  if($("#dr-del")) $("#dr-del").onclick=async e=>{
    const b=e.target;
    if(b.dataset.arm!=="1"){ b.dataset.arm="1"; b.textContent="정말 삭제"; setTimeout(()=>{ if(b.isConnected){ b.dataset.arm=""; b.textContent="삭제"; } }, 4000); return; }
    b.disabled=true;
    try{ await remover(); closeDrawer(); }catch(err){ b.disabled=false; failedInDrawer(err); } };
}
/* 서버가 거부한 게 아니라 그 전에 화면 스크립트가 터진 경우도 숨기지 않는다 */
function failedInDrawer(err){
  if(err && err.code) return;   // 서버 오류는 call() 이 이미 알렸다
  const text = "저장 전에 오류가 났습니다: " + (err && (err.name + ": " + err.message) || String(err));
  console.error("drawer", err);
  showDrawerError(text, false); showBanner(text, false); toast("저장하지 못했습니다", true);
}
function closeDrawer(){ $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); onSave=null; }
$("#scrim").onclick=closeDrawer;
addEventListener("keydown", e=>{ if(e.key==="Escape") closeDrawer(); });

/* ---------- wiring ---------- */
function wire(){
  const app=$("#app");
  $$("[data-goto]",app).forEach(b=>b.onclick=e=>{e.preventDefault(); const t=b.dataset.goto; if(t.startsWith("academy:")){ CTX.go(t.slice(8)); return; } go(t);});
  $$("[data-stu]",app).forEach(r=>r.onclick=e=>{e.stopPropagation(); CTX.openStudent(r.dataset.stu);});
  $$("[data-pay]",app).forEach(r=>r.onclick=()=>editPayment(r.dataset.pay));
  $$("[data-cls]",app).forEach(r=>r.onclick=()=>CTX.go("classes"));
  $$("[data-fp]",app).forEach(b=>b.onclick=()=>{fP=b.dataset.fp; render();});
  $$("[data-rec]",app).forEach(b=>b.onclick=()=>{recStu=b.dataset.rec; render();});
  $$("[data-ed]",app).forEach(r=>r.onclick=()=>{const [k,id]=r.dataset.ed.split(":"); editRec(k,id);});
  $$("[data-add]",app).forEach(b=>b.onclick=()=>editRec(b.dataset.add,null));
  $$("[data-prof]",app).forEach(b=>b.onclick=()=>editProfile(b.dataset.prof));
  $$("[data-op]",app).forEach(r=>r.onclick=()=>{const [k,id]=r.dataset.op.split(":"); editOp(k,id);});
  $$("[data-addop]",app).forEach(b=>b.onclick=()=>editOp(b.dataset.addop,null));
  const pr=$("#rec-print"); if(pr) pr.onclick=()=>CTX.print(HOST);
  $$("[data-cal]",app).forEach(b=>b.onclick=()=>{ const d=+b.dataset.cal;
    if(d===0){ const n=new Date(); calY=n.getFullYear(); calM=n.getMonth(); }
    else { calM+=d; if(calM<0){calM=11;calY--;} if(calM>11){calM=0;calY++;} } render(); });
  $$("[data-day]",app).forEach(c=>c.onclick=e=>{ const mk=e.target.closest("[data-mk]"), ev=e.target.closest("[data-ev]"), more=e.target.closest("[data-more]"), cs=e.target.closest("[data-cs]");
    if(more) dayList(more.dataset.more); else if(cs) openConsultById(cs.dataset.cs); else if(mk) viewMakeup(mk.dataset.mk); else if(ev) viewEvent(ev.dataset.ev); else dayList(c.dataset.day); });   // 일정을 누르면 내용 보기 · 빈 곳을 누르면 그 날 목록 (+ 그 날에 추가)
  $$("[data-caladd]",app).forEach(b=>b.onclick=()=>editEvent(null, today()));
  $$("[data-ctype]",app).forEach(b=>b.onclick=()=>{ const k=b.dataset.ctype;
    if(k==="__all") calOff.clear(); else if(calOff.has(k)) calOff.delete(k); else calOff.add(k);
    calSaveOff(); render(); });
  $$(".exambar [data-ev]",app).forEach(b=>b.onclick=()=>viewEvent(b.dataset.ev));
  const rs=$("#rec-stu"); if(rs) rs.onchange=()=>{recStu=rs.value; render();};
  /* 검색: 화면을 다시 그리면 입력칸이 새로 만들어지므로, 한글을 조합하는 동안(ㅇ→은→은섭)에는 그리지 않고
     조합이 끝난 뒤·타이핑이 잠깐 멈춘 뒤에만 그린다. 안 그러면 "ㅇㅡㄴㅅㅓㅂ" 처럼 자모가 분리된다. */
  const q=$("#q");
  if(q){
    let qt=null, composing=false;
    const draw=()=>{ if(composing) return; const p=q.selectionStart, v=q.value; fS.q=v.trim(); render();
      const n=$("#q"); if(n){ n.value=v; n.focus(); try{ n.setSelectionRange(p,p); }catch(e){} } };
    const later=()=>{ clearTimeout(qt); qt=setTimeout(draw,220); };
    q.addEventListener("compositionstart",()=>{ composing=true; clearTimeout(qt); });
    q.addEventListener("compositionend",()=>{ composing=false; later(); });
    q.oninput=later;
    q.onkeydown=e=>{ if(e.key==="Enter"){ e.preventDefault(); clearTimeout(qt); composing=false; draw(); } };
  }
  const st=$("#st"); if(st) st.onchange=()=>{fS.status=st.value; render();};
  const d=$("#dept"); if(d) d.onchange=()=>{fS.dept=d.value; render();};
  const h=$("#hr"); if(h) h.onchange=()=>{fS.hr=h.value; render();};
  const fl=$("#flag"); if(fl) fl.onclick=()=>{fS.flag=!fS.flag; render();};
  const cc=$("#cls-closed"); if(cc) cc.onclick=()=>{fC.closed=!fC.closed; render();};
  const ap=$("#addpay"); if(ap) ap.onclick=addPayment;
  $$("[data-iss]",app).forEach(cb=>cb.onchange=async()=>{ const i=S.issues.find(x=>x.id===cb.dataset.iss); if(!i) return;
    const was=i.done; i.done=cb.checked;
    try{ await call("adminSave",{sheet:"issues", row:i}); render(); }catch(e){ i.done=was; cb.checked=was; } });
  const f=$("#imp-file"); if(f) f.onchange=()=>{ const file=f.files[0]; impData=null; $("#imp-go").disabled=true; if(!file) return;
    file.text().then(t=>{ try{ const j=JSON.parse(t); if(!j || typeof j!=="object" || !("events" in j || "bills" in j || "supplies" in j)) throw new Error("형식");
      impData=j; $("#imp-go").disabled=false; $("#imp-out").textContent=`파일 확인: 달력 ${(j.events||[]).length} · 시재 ${(j.supplies||[]).length} · 점검 ${(j.issues||[]).length} · 청구 ${(j.bills||[]).length} · 기록 ${(j.gradebook||[]).length} · 프로필 ${(j.profiles||[]).length}`; }
      catch(e){ $("#imp-out").textContent="원장실 내보내기 파일이 아닙니다."; } }); };
  const ig=$("#imp-go"); if(ig) ig.onclick=importOld;
  const is=$("#imp-sheet"); if(is) is.onclick=importSheet;
}

/* ---------- 개별 청구 화면 = 원장실 대시보드의 "개별 청구 현황" + 청구 목록 ---------- */
function vBills() {
  const m = money(), sp = byKind("특강"), sh = byKind("선행");
  const scale = Math.max(Math.ceil(Math.max(sp.bill, sh.bill, 1) / 1e6) * 1e6, 1);
  const bar = (k, d) => { const pw = d.bill ? d.paid / scale * 100 : 0, dw = d.bill ? (d.bill - d.paid) / scale * 100 : 0;
    return `<div class="row"><div class="lab"><b>${k}</b>${d.n}건 · 수납 ${d.rate}%</div>
      <div class="track" title="${k} 청구 ${won(d.bill)}원 — 납부 ${won(d.paid)} / 미납 ${won(d.due)}">
        <div class="seg p" style="left:0;width:${pw}%"><div class="fill"></div></div>
        <div class="seg d" style="left:${pw}%;width:${dw}%;padding-left:2px"><div class="fill"></div></div>
      </div><span class="val">${Math.round(d.bill / 1e4)}만</span></div>`; };
  return `<section><div class="sec-row"><h2 class="sec">개별 청구 현황</h2><span class="hint">특강 · 교재비 등 건별 청구 ${S.payments.length}건${S.meta && S.meta.term ? " · " + esc(S.meta.term) : ""} · 월 수강료는 [수납]</span></div>
    <div class="kpis">
      <div class="kpi"><div class="k">청구 합계</div><div class="v">${won(m.bill)}<small>원</small></div><div class="s">${S.payments.length}건</div></div>
      <div class="kpi"><div class="k">납부 완료</div><div class="v">${won(m.paid)}<small>원</small></div><div class="s">${S.payments.filter(p => p.status === "완납").length}건 완납</div></div>
      <div class="kpi hi"><div class="k">미납</div><div class="v">${won(m.due)}<small>원</small></div><div class="s">${unpaid().length}건</div></div>
      <div class="kpi"><div class="k">수납률</div><div class="v">${m.rate}<small>%</small></div><div class="s">특강 ${sp.rate}% · 선행 ${sh.rate}%</div></div>
    </div>
    <div class="panel pad"><div class="legend"><span><i style="background:var(--paid)"></i>납부</span><span><i style="background:var(--due)"></i>미납</span>
      <span style="margin-left:auto;color:var(--ink-3)">막대 길이 = 청구액</span></div>${bar("특강", sp)}${bar("선행", sh)}</div>
  </section>` + vPayments();
}

/* ---------- 홈 카드 "지금 확인할 것" (원장 홈 맨 위) ---------- */
function homeActs() {
  const acts = [], m = money(), nc = needCheck().length;
  const noHome = S.students.filter(s => s.status === "재원" && s.homeroom === "확인필요").length;
  const noSchool = S.students.filter(s => s.status === "재원" && (s.school === "확인필요" || !s.school)).length;
  soonTests().forEach(t => acts.push(["crit", "tests", `${ddayLabel(t.date)} · ${t.title}`, [t.target, t.scope, t.teacher].filter(Boolean).join(" · ") || "테스트 예정", t.date.slice(5).replace("-", "/")]));
  examSoon(14).forEach(p => { const d = dDiff(today(), p.date), run = p.date <= today() && today() <= p.end;
    acts.push([run || d <= 3 ? "crit" : "warn", "calendar", `${p.school || "학교 미정"} ${p.title || "시험기간"}`, `${mdShort(p.date)}~${mdShort(p.end)} 학교 시험기간입니다${run ? " (진행 중)" : ""}`, run ? "진행 중" : (d === 0 ? "오늘 시작" : `D-${d}`)]); });
  if (m.due > 0) acts.push(["crit", "payments", `개별 청구 미납 ${unpaid().length}건`, "특강·교재비 등 건별 청구 중 아직 들어오지 않은 금액입니다", won(m.due) + "원"]);
  if (nc) acts.push(["warn", "payments", `금액 미기재 ${nc}건`, "청구 금액·납부여부가 비어 있는 건입니다", "확인 필요"]);
  if (noSchool) acts.push(["warn", "students", `학교 미상 ${noSchool}명`, "재원생 중 학교가 확인되지 않은 학생입니다", noSchool + "명"]);
  if (noHome) acts.push(["info", "students", `담임 미지정 ${noHome}명`, "정규반에 편성되지 않았거나 반 담당이 비어 있는 재원생입니다", noHome + "명"]);
  if (openIssues().length) acts.push(["info", "issues", `정합성 점검 ${openIssues().length}건`, "데이터 정리가 필요한 항목입니다", openIssues().length + "건"]);
  return acts;
}
function drawHome() {
  if (!HOMEHOST.isConnected) return;
  const box = HOMEROOT.querySelector("#home");
  if (!loaded) { box.innerHTML = loadErr ? `<div class="panel pad note">원장 확인 항목을 불러오지 못했습니다: ${esc(loadErr)}</div>` : ""; return; }
  const acts = homeActs();
  box.innerHTML = acts.length ? `<section class="homeacts"><div class="sec-row" style="padding-bottom:8px"><h2 class="sec" style="font-size:16px">지금 확인할 것</h2><span class="hint">원장님만 보입니다 · 누르면 해당 화면으로</span></div>
    <div class="acts">${acts.map(([lv, tab, t, d, f]) => `<button class="act ${lv}" data-goto="${tab}"><span class="bar"></span><span class="bd"><span class="t">${esc(t)}</span><span class="d">${esc(d)}</span></span><span class="fg">${esc(f)}</span></button>`).join("")}</div></section>` : "";
  Array.from(box.querySelectorAll("[data-goto]")).forEach(b => b.onclick = () => go(b.dataset.goto));
}

/* ---------- 그리기 ---------- */
const VIEWS = { cal: vCalendar, rec: vRecords, bills: vBills, tests: vTests, issues: vIssues };
function draw() {
  if (!HOST.isConnected) return;
  const app = $("#app");
  if (!loaded) { app.innerHTML = `<div class="panel pad"><div class="empty">${loadErr ? esc(loadErr) + '<br><br><button class="btn" id="reload">다시 불러오기</button>' : "불러오는 중…"}</div></div>`;
    const r = $("#reload"); if (r) r.onclick = () => { loadErr = ""; draw(); ensure(); }; return; }
  app.innerHTML = (VIEWS[view] || vCalendar)();
  wire();
}

window.MMOffice = {
  init(ctx) { CTX = ctx; },
  /** 원장 도구 화면을 el 안에 그린다 (cal · rec · bills · tests · issues) */
  show(v, el) { view = v; if (HOST.parentNode !== el) el.appendChild(HOST); draw(); if (!loaded || stale) ensure(); },
  /** 원장 홈 맨 위 "지금 확인할 것" */
  home(el) { if (HOMEHOST.parentNode !== el) el.appendChild(HOMEHOST); drawHome(); if (!loaded || stale) ensure(); },
  /** 학생 상세에서 [기록카드] → 그 학생으로 */
  record(id) { recStu = id; },
  /** 왼쪽 메뉴 숫자 (불러오기 전에는 null) */
  counts() { return loaded ? { tests: soonTests().length, issues: openIssues().length, bills: unpaid().length + needCheck().length } : null; },
  /** 학원관리가 데이터를 새로 읽었을 때 → 다음에 보일 때 다시 읽는다 */
  invalidate() { stale = true; },
  /** 로그아웃 */
  reset() { loaded = false; stale = false; loadErr = ""; closeDrawer(); },
  preload() { return ensure(); },
};
})();
