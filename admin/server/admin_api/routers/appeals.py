"""内容申诉接口（/v1）。

覆盖三条链路：
1. 被驳回后查看"为什么被驳回"（上下文接口）
2. 修改内容后重新提交 -> 自动重审，能过就立刻上线，过不了就给出新的驳回理由
3. 不改内容单纯申诉 -> 进人工队列，由审核员裁决

约定：一条内容最多申诉 3 轮，同一时间只能有一张待处理申诉单。
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, require_app_admin
from ..models import Appeal, AuditRecord, Post, Recipe, RecipeMaterial, RecipeStep, User
from ..moderation import audit, apply_verdict, decision_text, public_verdict, save_record
from .miniapp import fail, iso, post_v1, recipe_v1

router = APIRouter(prefix="/v1", tags=["申诉"])

MAX_APPEAL_ROUNDS = 3

MODEL_BY_KIND = {"post": Post, "recipe": Recipe}
KIND_TEXT = {"post": "帖子", "recipe": "菜谱"}


# ---------------- 公共小工具 ----------------


def _model(kind: str):
    model = MODEL_BY_KIND.get(kind)
    if model is None:
        fail(400, "BAD_KIND")
    return model


def _get_own_target(db: Session, user: User, kind: str, target_id: int):
    row = db.get(_model(kind), int(target_id))
    if row is None:
        fail(404, "NOT_FOUND")
    if row.owner_id != user.uid:
        fail(403, "NOT_OWNER")
    return row


def _snapshot(db: Session, kind: str, row) -> dict:
    if kind == "post":
        return {
            "title": row.title,
            "content": row.content or "",
            "media": list(row.media or []),
            "video_url": row.video_url or "",
        }
    materials = (
        db.query(RecipeMaterial).filter(RecipeMaterial.recipe_id == row.id).order_by(RecipeMaterial.sort).all()
    )
    steps = db.query(RecipeStep).filter(RecipeStep.recipe_id == row.id).order_by(RecipeStep.sort).all()
    return {
        "name": row.name,
        "summary": row.summary or "",
        "tags": list(row.tags or []),
        "materials": [{"name": item.name, "dosage": item.dosage or ""} for item in materials],
        "steps": [{"content": item.content, "img_url": item.img_url or ""} for item in steps],
    }


def _audit_fields(db: Session, kind: str, row, content: dict | None) -> dict:
    """组装送审文本。content 为用户改后的内容，未改则用库里现存的。"""
    if kind == "post":
        title = (content or {}).get("title", row.title) or ""
        body = (content or {}).get("content", row.content) or ""
        return {"标题": title, "正文": body}

    name = (content or {}).get("name", row.name) or ""
    summary = (content or {}).get("summary", row.summary) or ""
    materials = (content or {}).get("materials")
    steps = (content or {}).get("steps")
    if materials is None:
        materials = [
            {"name": item.name}
            for item in db.query(RecipeMaterial).filter(RecipeMaterial.recipe_id == row.id).all()
        ]
    if steps is None:
        steps = [
            {"content": item.content}
            for item in db.query(RecipeStep).filter(RecipeStep.recipe_id == row.id).all()
        ]
    return {
        "菜名": name,
        "简介": summary,
        "食材": " ".join((item.get("name") or "") for item in materials if isinstance(item, dict)),
        "步骤": " ".join((item.get("content") or "") for item in steps if isinstance(item, dict)),
    }


def _materials_of(db: Session, row) -> list:
    return list(db.query(RecipeMaterial).filter(RecipeMaterial.recipe_id == row.id).all())


def _apply_edit(db: Session, kind: str, row, content: dict) -> None:
    """把用户在申诉页改过的内容写回数据库。"""
    if kind == "post":
        if "title" in content:
            title = (content.get("title") or "").strip()
            if not title:
                fail(400, "EMPTY_TITLE")
            row.title = title[:120]
        if "content" in content:
            row.content = (content.get("content") or "").strip()
        if "media" in content:
            row.media = [item for item in (content.get("media") or []) if item][:9]
        return

    if "name" in content:
        name = (content.get("name") or "").strip()
        if not name:
            fail(400, "EMPTY_NAME")
        row.name = name[:64]
    if "summary" in content:
        row.summary = (content.get("summary") or "").strip()
    if "tags" in content:
        row.tags = list(content.get("tags") or [])[:12]
        row.fit_quick = "快手菜" in row.tags
        row.fit_takeaway = "适合外卖" in row.tags
    if "materials" in content:
        db.query(RecipeMaterial).filter(RecipeMaterial.recipe_id == row.id).delete()
        for index, item in enumerate(content.get("materials") or []):
            if not isinstance(item, dict) or not (item.get("name") or "").strip():
                continue
            db.add(
                RecipeMaterial(
                    recipe_id=row.id,
                    name=item["name"].strip()[:64],
                    dosage=(item.get("dosage") or "").strip()[:64],
                    sort=index + 1,
                )
            )
    if "steps" in content:
        db.query(RecipeStep).filter(RecipeStep.recipe_id == row.id).delete()
        for index, item in enumerate(content.get("steps") or []):
            if not isinstance(item, dict) or not (item.get("content") or "").strip():
                continue
            db.add(
                RecipeStep(
                    recipe_id=row.id,
                    sort=index + 1,
                    content=item["content"].strip(),
                    img_url=item.get("img_url") or "",
                )
            )
    row.updated_at = datetime.now()
    # autoflush 关闭，这里显式 flush，保证后面的 _snapshot 读到的是改后数据
    db.flush()


def _appeal_stats(db: Session, kind: str, target_id: int) -> tuple[int, Appeal | None]:
    """返回（已申诉轮数, 待处理的申诉单）。"""
    rows = (
        db.query(Appeal)
        .filter(Appeal.target_type == kind, Appeal.target_id == target_id)
        .order_by(Appeal.created_at.asc())
        .all()
    )
    pending = next((row for row in rows if row.status == 0), None)
    return len(rows), pending


def _appeal_item(db: Session, row: Appeal) -> dict:
    return {
        "id": row.id,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "target_text": KIND_TEXT.get(row.target_type, "内容"),
        "title": row.title,
        "reason": row.reason or "",
        "reject_reason": row.reject_reason or "",
        "status": row.status,
        "status_text": {0: "待处理", 1: "申诉通过", 2: "维持驳回"}.get(row.status, ""),
        "rounds": row.rounds,
        "auto": bool(row.auto),
        "reply": row.reply or "",
        "created_at": iso(row.created_at),
        "handled_at": iso(row.handled_at),
    }


# ---------------- 用户端 ----------------


@router.get("/appeals/context")
def appeal_context(
    target_type: str = Query("post"),
    target_id: int = Query(0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _model(target_type)
    row = _get_own_target(db, user, target_type, target_id)
    content = _snapshot(db, target_type, row)
    rounds, pending = _appeal_stats(db, target_type, target_id)

    latest = (
        db.query(AuditRecord)
        .filter(AuditRecord.target_type == target_type, AuditRecord.target_id == target_id)
        .order_by(AuditRecord.created_at.desc())
        .first()
    )
    history = (
        db.query(Appeal)
        .filter(Appeal.target_type == target_type, Appeal.target_id == target_id)
        .order_by(Appeal.created_at.desc())
        .limit(10)
        .all()
    )

    return {
        "target_type": target_type,
        "target_id": target_id,
        "title": row.name if target_type == "recipe" else row.title,
        "audit_status": row.audit_status,
        "reject_reason": row.reject_reason or "",
        "appealable": row.audit_status == 3,
        "appeal_count": rounds,
        "appeal_limit": MAX_APPEAL_ROUNDS,
        "appeal_left": max(MAX_APPEAL_ROUNDS - rounds, 0),
        "pending_appeal": _appeal_item(db, pending) if pending else None,
        "content": content,
        "verdict": (
            {
                "decision": latest.decision,
                "score": latest.score,
                "code": latest.code,
                "reasons": latest.reasons or [],
                "checked_at": iso(latest.created_at),
            }
            if latest
            else None
        ),
        "history": [_appeal_item(db, item) for item in history],
    }


class AppealBody(BaseModel):
    target_type: str = "post"
    target_id: int = 0
    reason: str = ""
    content: dict | None = None
    resubmit: bool = False  # true 表示"改完直接重发"，false 表示"只申诉不改内容"


@router.post("/appeals")
def create_appeal(body: AppealBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    _model(body.target_type)
    row = _get_own_target(db, user, body.target_type, body.target_id)

    if row.audit_status != 3:
        fail(400, "NOT_REJECTED")

    rounds, pending = _appeal_stats(db, body.target_type, body.target_id)
    if pending is not None:
        fail(400, "APPEAL_PENDING")
    if rounds >= MAX_APPEAL_ROUNDS:
        fail(400, "APPEAL_LIMIT")

    reason = (body.reason or "").strip()
    changed = bool(body.content) and body.content != _snapshot(db, body.target_type, row)

    # 只申诉不改内容：必须写清楚理由
    if not reason and not changed:
        fail(400, "EMPTY_REASON")

    if changed:
        _apply_edit(db, body.target_type, row, body.content or {})

    appeal = Appeal(
        target_type=body.target_type,
        target_id=row.id,
        owner_id=user.uid,
        owner_name=user.nickname or "美食爱好者",
        title=(row.name if body.target_type == "recipe" else row.title)[:120],
        reason=reason[:500],
        reject_reason=(row.reject_reason or "")[:255],
        content=_snapshot(db, body.target_type, row),
        rounds=rounds + 1,
        auto=False,
        status=0,
    )
    db.add(appeal)
    db.flush()

    result = {
        "appeal_id": appeal.id,
        "rounds": appeal.rounds,
        "appeal_status": 0,
        "audit_status": row.audit_status,
        "decision": "review",
        "message": "已提交申诉，审核员会尽快处理",
    }

    # 改了内容 -> 重新跑自动审核，能过就当场放行，不用等人工
    if changed:
        verdict = audit(
            db,
            _audit_fields(db, body.target_type, row, body.content),
            _media_of(body.target_type, row),
            source="appeal",
        )
        save_record(db, body.target_type, row.id, row.owner_id, verdict)
        apply_verdict(row, verdict)
        appeal.content = _snapshot(db, body.target_type, row)
        result["audit"] = public_verdict(verdict)

        if verdict["decision"] == "pass":
            appeal.status = 1
            appeal.auto = True
            appeal.reply = "内容修改后通过自动审核"
            appeal.handled_by = "自动审核"
            appeal.handled_at = datetime.now()
            result.update(
                {
                    "appeal_status": 1,
                    "audit_status": 2,
                    "decision": "pass",
                    "message": "修改后的内容已通过自动审核，已重新发布",
                }
            )
        elif verdict["decision"] == "reject":
            appeal.status = 2
            appeal.auto = True
            appeal.reply = decision_text(verdict)
            appeal.handled_by = "自动审核"
            appeal.handled_at = datetime.now()
            result.update(
                {
                    "appeal_status": 2,
                    "audit_status": 3,
                    "decision": "reject",
                    "message": decision_text(verdict),
                }
            )
        else:
            row.audit_status = 1
            result.update(
                {
                    "audit_status": 1,
                    "decision": "review",
                    "message": "内容已更新，正在人工复核",
                }
            )

    db.commit()
    db.refresh(appeal)
    result["appeal"] = _appeal_item(db, appeal)
    return result


def _media_of(kind: str, row) -> list[str]:
    if kind == "post":
        return [item for item in (row.media or []) if item]
    return [row.cover_img] if row.cover_img else []


@router.get("/me/appeals")
def my_appeals(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Appeal)
        .filter(Appeal.owner_id == user.uid)
        .order_by(Appeal.created_at.desc())
        .limit(50)
        .all()
    )
    return {"list": [_appeal_item(db, row) for row in rows]}


# ---------------- 管理端 ----------------


@router.get("/admin/appeals")
def admin_appeals(
    status: int | None = None,
    user: User = Depends(require_app_admin),
    db: Session = Depends(get_db),
):
    query = db.query(Appeal)
    if status in (0, 1, 2):
        query = query.filter(Appeal.status == status)
    rows = query.order_by(Appeal.created_at.desc()).limit(100).all()

    items = []
    for row in rows:
        item = _appeal_item(db, row)
        target = db.get(_model(row.target_type), row.target_id)
        if target is not None:
            item["current"] = (
                {"title": target.title, "content": target.content, "audit_status": target.audit_status}
                if row.target_type == "post"
                else {
                    "title": target.name,
                    "content": target.summary or "",
                    "audit_status": target.audit_status,
                }
            )
        items.append(item)

    pending = db.query(Appeal).filter(Appeal.status == 0).count()
    return {"list": items, "pending": pending}


class HandleAppealBody(BaseModel):
    accepted: bool = False
    reply: str = ""


@router.post("/admin/appeals/{appeal_id}/handle")
def handle_appeal(
    appeal_id: int,
    body: HandleAppealBody,
    user: User = Depends(require_app_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Appeal, appeal_id)
    if row is None:
        fail(404, "NOT_FOUND")
    if row.status != 0:
        fail(400, "ALREADY_HANDLED")

    target = db.get(_model(row.target_type), row.target_id)
    if target is None:
        fail(404, "TARGET_NOT_FOUND")

    if body.accepted:
        target.audit_status = 2
        target.reject_reason = ""
        row.status = 1
        row.reply = (body.reply or "申诉通过，内容已恢复展示").strip()[:255]
    else:
        target.audit_status = 3
        reply = (body.reply or "").strip()
        if not reply:
            fail(400, "EMPTY_REPLY")
        target.reject_reason = reply[:255]
        row.status = 2
        row.reply = reply[:255]

    if row.target_type == "recipe":
        target.updated_at = datetime.now()

    row.handled_by = user.nickname or user.uid
    row.handled_at = datetime.now()

    db.add(
        AuditRecord(
            target_type=row.target_type,
            target_id=row.target_id,
            owner_id=row.owner_id,
            decision="pass" if body.accepted else "reject",
            score=0,
            code="MANUAL_APPEAL",
            reasons=[row.reply],
            hits=[],
            engine="manual",
            source="appeal",
        )
    )
    db.commit()
    return {"ok": True, "status": row.status, "audit_status": target.audit_status}


@router.get("/admin/audit-records")
def admin_audit_records(
    target_type: str = "post",
    target_id: int = 0,
    user: User = Depends(require_app_admin),
    db: Session = Depends(get_db),
):
    query = db.query(AuditRecord)
    if target_type in MODEL_BY_KIND:
        query = query.filter(AuditRecord.target_type == target_type)
    if target_id:
        query = query.filter(AuditRecord.target_id == target_id)
    rows = query.order_by(AuditRecord.created_at.desc()).limit(50).all()
    return {
        "list": [
            {
                "id": row.id,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "decision": row.decision,
                "score": row.score,
                "code": row.code,
                "reasons": row.reasons or [],
                "engine": row.engine,
                "source": row.source,
                "created_at": iso(row.created_at),
            }
            for row in rows
        ]
    }
