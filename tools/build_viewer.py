#!/usr/bin/env python3
"""앱 DB 스냅샷 + 계정 정보 -> 암호화된 열람판 생성.

  1. Claude Code 에서 Artifact read_db (db_op: list, out_dir) 로
     dbsnap/academy/*.json 를 내려받는다
  2. tools/accounts.example.json 을 tools/accounts.json 으로 복사해 채운다
  3. python tools/build_viewer.py

vault.json 과 mm-viewer.html 이 나온다. mm-viewer.html 을 그대로 게시하면 된다.
두 파일 모두 학생 자료가 들어가므로 .gitignore 로 빠져 있다.

암호 구조 (src/viewer_template.html 의 unlock() 과 짝을 이룬다)

  등급마다 무작위 콘텐츠 키(ck)를 하나 만들어 그 등급 본문을 AES-GCM 으로 잠근다.
  계정마다 PBKDF2(아이디:비밀번호) 로 KEK 를 만들고, 그 KEK 로 자기 등급의 ck 만
  감싸 둔다. 그래서 limited 계정은 full 본문을 복호화할 열쇠 자체를 갖지 못한다.
"""

import argparse
import base64
import json
import os
import sys
from datetime import date
from pathlib import Path

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
except ImportError:
    sys.exit("cryptography 가 필요합니다:  pip install cryptography")

ROOT = Path(__file__).resolve().parent.parent
ITER = 250_000  # 템플릿은 V.iter 를 읽으므로 바꿔도 되지만, 낮추지는 말 것
TIERS = ("full", "limited")

b64 = lambda raw: base64.b64encode(raw).decode()


# ── 스냅샷 읽기 ────────────────────────────────────────────────────────────
def load_doc(snap_dir, name, key):
    """dbsnap/academy/<name>.json 에서 배열 하나를 꺼낸다. 없으면 빈 배열."""
    path = snap_dir / f"{name}.json"
    if not path.exists():
        print(f"  · {name}.json 없음 — 건너뜁니다")
        return [] if key else {}
    doc = json.loads(path.read_text(encoding="utf-8"))
    # read_db 가 문서를 그대로 쓸 때도, 메타로 한 겹 감쌀 때도 견디게 한다
    if key and key not in doc and isinstance(doc.get("data"), dict):
        doc = doc["data"]
    if not key:
        return doc
    val = doc.get(key, [])
    if not isinstance(val, list):
        sys.exit(f"{path}: '{key}' 가 배열이 아닙니다")
    return val


def load_snapshot(snap_dir):
    if not snap_dir.is_dir():
        sys.exit(f"스냅샷 폴더가 없습니다: {snap_dir}\n"
                 "  Artifact read_db 로 dbsnap/academy/*.json 을 먼저 내려받으세요.")
    print(f"스냅샷 읽는 중: {snap_dir}")
    return {
        "students":    load_doc(snap_dir, "roster", "students"),
        "staff":       load_doc(snap_dir, "staff", "teachers"),
        "classes":     load_doc(snap_dir, "classes", "classes"),
        "enrollments": load_doc(snap_dir, "enrollments", "rows"),
        "payments":    load_doc(snap_dir, "payments", "payments"),
        "issues":      load_doc(snap_dir, "issues", "issues"),
        "events":      load_doc(snap_dir, "calendar", "events"),
        "meta":        load_doc(snap_dir, "meta", None),
    }


# ── 열람판이 읽는 모양으로 정리 ────────────────────────────────────────────
def build_payloads(db):
    students = db["students"]
    by_id = {s.get("id"): s for s in students}
    generated = date.today().isoformat()
    term = (db["meta"] or {}).get("term", "")

    members = {}
    for row in db["enrollments"]:
        s = by_id.get(row.get("studentId"))
        if s:
            members.setdefault(row.get("classId"), []).append({
                "name": s.get("name", ""),
                "school": s.get("school", ""),
                "grade": s.get("grade"),
            })

    classes = [{
        "name": c.get("name", ""), "teacher": c.get("teacher", ""),
        "day": c.get("day", ""), "program": c.get("program", ""),
        "fee": c.get("fee"), "dept": c.get("dept", "기타"),
        "note": c.get("note", ""), "students": members.get(c.get("id"), []),
    } for c in db["classes"]]

    events = sorted(
        ({"date": e.get("date", ""), "type": e.get("type", ""), "title": e.get("title", "")}
         for e in db["events"] if e.get("date")),
        key=lambda e: e["date"])

    payments, billed, paid_sum = [], 0, 0
    for p in db["payments"]:
        real = (p.get("billed") or 0) - (p.get("discount") or 0)
        paid = p.get("paid") or 0
        billed += real
        paid_sum += paid
        payments.append({
            "name": p.get("name") or (by_id.get(p.get("studentId"), {})).get("name", ""),
            "kind": p.get("kind", ""), "course": p.get("course", ""),
            "teacher": p.get("teacher", ""), "real": real, "paid": paid,
            "owed": real - paid, "status": p.get("status", ""),
        })

    issues = [{
        "category": i.get("category", ""), "target": i.get("target", ""),
        "detail": i.get("detail", ""), "action": i.get("action", ""),
        "priority": i.get("priority", "낮음"), "done": bool(i.get("done")),
    } for i in db["issues"]]

    staff = [{
        "id": t.get("id", ""), "name": t.get("name", ""), "label": t.get("label", ""),
        "role": t.get("role", ""), "dept": t.get("dept", ""),
        "status": t.get("status", ""), "note": t.get("note", ""),
    } for t in db["staff"]]

    summary = {
        "students": len(students),
        "enrolled": sum(1 for s in students if s.get("status") == "재원"),
        "classes": len(classes),
        "enrollments": len(db["enrollments"]),
        "billed": billed, "paid": paid_sum, "due": billed - paid_sum,
        "unpaid": sum(1 for p in payments if p["owed"] > 0),
        "openIssues": sum(1 for i in issues if not i["done"]),
        "events": len(events),
    }

    common = {"term": term, "generated": generated, "classes": classes, "events": events}
    return {
        "full": dict(common, tier="full", summary=summary, payments=payments,
                     issues=issues, staff=staff, students=[{
                         "id": s.get("id", ""), "name": s.get("name", ""),
                         "dept": s.get("dept", ""), "school": s.get("school", ""),
                         "grade": s.get("grade"), "homeroom": s.get("homeroom", ""),
                         "status": s.get("status", ""), "phone": s.get("phone", ""),
                         "guardianPhone": s.get("guardianPhone", ""),
                         "note": s.get("note", ""),
                     } for s in students]),
        # 제한 계정은 반 편성과 일정만. 수납·연락처·점검은 아예 담지 않는다.
        "limited": dict(common, tier="limited"),
    }


# ── 잠그기 ────────────────────────────────────────────────────────────────
def load_accounts(path):
    if not path.exists():
        sys.exit(f"계정 파일이 없습니다: {path}\n"
                 "  tools/accounts.example.json 을 복사해 채우세요.")
    doc = json.loads(path.read_text(encoding="utf-8"))
    accounts = doc["accounts"] if isinstance(doc, dict) else doc
    if not accounts:
        sys.exit(f"{path}: 계정이 하나도 없습니다")
    seen = set()
    for a in accounts:
        uid = str(a.get("id", "")).strip().lower()
        if not uid or not a.get("pw"):
            sys.exit(f"{path}: 아이디와 비밀번호가 모두 있어야 합니다 -> {a}")
        if a.get("tier") not in TIERS:
            sys.exit(f"{path}: '{uid}' 의 tier 는 {' 또는 '.join(TIERS)} 여야 합니다")
        if uid in seen:
            sys.exit(f"{path}: 아이디가 겹칩니다 -> {uid}")
        seen.add(uid)
        a["id"] = uid
    return accounts


def seal(payloads, accounts):
    """등급별 본문을 잠그고, 계정마다 자기 등급의 콘텐츠 키만 감싸 준다."""
    used = {a["tier"] for a in accounts}
    tiers, content_keys = {}, {}
    for tier in TIERS:
        if tier not in used:
            print(f"  · {tier} 등급 계정이 없어 본문을 넣지 않습니다")
            continue
        ck, iv = os.urandom(32), os.urandom(12)
        content_keys[tier] = ck
        plain = json.dumps(payloads[tier], ensure_ascii=False,
                           separators=(",", ":")).encode()
        tiers[tier] = {"iv": b64(iv), "payload": b64(AESGCM(ck).encrypt(iv, plain, None))}
        print(f"  · {tier}: 본문 {len(plain):,} 바이트 잠금")

    sealed = []
    for a in accounts:
        salt, iv = os.urandom(16), os.urandom(12)
        kek = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32,
                         salt=salt, iterations=ITER).derive(
                             f"{a['id']}:{a['pw']}".encode())
        # 아이디를 AAD 로 묶어, 감싼 키를 다른 계정 자리에 옮겨 붙일 수 없게 한다
        wrapped = AESGCM(kek).encrypt(iv, content_keys[a["tier"]], a["id"].encode())
        sealed.append({"id": a["id"], "tier": a["tier"], "salt": b64(salt),
                       "iv": b64(iv), "key": b64(wrapped)})
        print(f"  · 계정 {a['id']} ({a['tier']})")

    return {"v": 2, "iter": ITER, "tiers": tiers, "accounts": sealed}


def main():
    ap = argparse.ArgumentParser(description="더블엠 열람판 빌드")
    ap.add_argument("--snap", type=Path, default=ROOT / "dbsnap" / "academy")
    ap.add_argument("--accounts", type=Path, default=ROOT / "tools" / "accounts.json")
    ap.add_argument("--template", type=Path, default=ROOT / "src" / "viewer_template.html")
    ap.add_argument("--out-vault", type=Path, default=ROOT / "vault.json")
    ap.add_argument("--out-html", type=Path, default=ROOT / "mm-viewer.html")
    args = ap.parse_args()

    db = load_snapshot(args.snap)
    if not db["students"]:
        sys.exit("roster 가 비어 있습니다. 스냅샷을 다시 내려받으세요.")
    payloads = build_payloads(db)
    print(f"학생 {len(db['students'])}명 · 반 {len(db['classes'])}개 · "
          f"수납 {len(db['payments'])}건 · 일정 {len(db['events'])}건")

    print("잠그는 중…")
    vault = seal(payloads, load_accounts(args.accounts))
    args.out_vault.write_text(json.dumps(vault, ensure_ascii=False,
                                         separators=(",", ":")), encoding="utf-8")

    template = args.template.read_text(encoding="utf-8")
    if template.count("__VAULT__") != 1:
        sys.exit(f"{args.template}: __VAULT__ 자리가 정확히 하나여야 합니다")
    args.out_html.write_text(
        template.replace("__VAULT__", json.dumps(vault, ensure_ascii=False,
                                                 separators=(",", ":"))),
        encoding="utf-8")

    print(f"\n{args.out_vault}  ({args.out_vault.stat().st_size:,} 바이트)")
    print(f"{args.out_html}  ({args.out_html.stat().st_size:,} 바이트)  ← 이 파일을 게시합니다")


if __name__ == "__main__":
    main()
