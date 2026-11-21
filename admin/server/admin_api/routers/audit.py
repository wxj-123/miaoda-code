from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import log_action, require_perm
from ..models import Admin, OperationLog, Post, Recipe
from ..serializers import post_brief, recipe_brief

router = APIRouter(prefix="/api/audit", tags=["审核中心"])


class DecideBody(BaseModel):
    kind: str
    id: int
    passed: bool = True
    reason: str = ""


@router.get("/pending")
def pending(
    kind: str = "all",
    page: int = 1,
    page_size: int = 10,
    db: Session = Depends(get_db),
    _=Depends(require_perm("audit:review")),
):
    rows = []
    if kind in ("all", "recipe"):
        for row in (
            db.query(Recipe)
            .filter(Recipe.audit_status == 1)
            .order_by(Recipe.created_at.asc())
            .limit(100)
            .all()
        ):
            item = recipe_brief(row)
            item["kind"] = "recipe"
            item["kind_text"] = "菜谱"
            item["title"] = row.name
            rows.append(item)
    if kind in ("all", "post"):
        for row in (
            db.query(Post).filter(Post.audit_status == 1).order_by(Post.created_at.asc()).limit(100).all()
        ):
            item = post_brief(row)
            item["kind"] = "post"
            item["kind_text"] = "帖子"
            rows.append(item)

    rows.sort(key=lambda item: item["created_at"])
    total = len(rows)
    start = (page - 1) * page_size
    return {"list": rows[start : start + page_size], "total": total}


@router.post("/decide")
def decide(
    body: DecideBody,
    request: Request,
    admin: Admin = Depends(require_perm("audit:review")),
    db: Session = Depends(get_db),
):
    if body.kind == "recipe":
        row = db.get(Recipe, body.id)
    elif body.kind == "post":
        row = db.get(Post, body.id)
    else:
        raise HTTPException(status_code=400, detail="内容类型不正确")

    if not row:
        raise HTTPException(status_code=404, detail="内容不存在")

    if body.passed:
        row.audit_status = 2
        row.reject_reason = ""
    else:
        reason = (body.reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="驳回理由必填")
        row.audit_status = 3
        row.reject_reason = reason

    title = row.name if body.kind == "recipe" else row.title
    log_action(
        db,
        admin,
        "审核通过" if body.passed else "审核驳回",
        f"{'菜谱' if body.kind == 'recipe' else '帖子'}#{row.id}",
        f"{title}" + ("" if body.passed else f"｜理由：{body.reason}"),
        request,
    )
    db.commit()
    return {"ok": True}


@router.get("/logs")
def logs(
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _=Depends(require_perm("audit:review")),
):
    query = db.query(OperationLog).filter(OperationLog.action.like("审核%"))
    total = query.count()
    rows = (
        query.order_by(OperationLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "total": total,
        "list": [
            {
                "id": row.id,
                "admin_name": row.admin_name,
                "action": row.action,
                "target": row.target,
                "detail": row.detail,
                "created_at": row.created_at.strftime("%Y-%m-%d %H:%M"),
            }
            for row in rows
        ],
    }
