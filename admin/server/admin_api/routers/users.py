from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import log_action, require_perm
from ..models import Admin, Comment, Post, Recipe, User
from ..serializers import user_brief

router = APIRouter(prefix="/api/users", tags=["用户管理"])


class BanBody(BaseModel):
    reason: str = ""


@router.get("")
def list_users(
    keyword: str = "",
    status: int | None = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _=Depends(require_perm("user:manage")),
):
    query = db.query(User)
    if keyword.strip():
        like = f"%{keyword.strip()}%"
        query = query.filter(or_(User.nickname.like(like), User.uid.like(like), User.email.like(like)))
    if status in (0, 1):
        query = query.filter(User.status == status)
    total = query.count()
    rows = query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"total": total, "list": [user_brief(row) for row in rows]}


@router.get("/{uid}")
def user_detail(
    uid: str,
    db: Session = Depends(get_db),
    _=Depends(require_perm("user:manage")),
):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    data = user_brief(user)
    data["stats"] = {
        "recipe": db.query(func.count(Recipe.id)).filter(Recipe.owner_id == uid).scalar() or 0,
        "post": db.query(func.count(Post.id)).filter(Post.owner_id == uid).scalar() or 0,
        "comment": db.query(func.count(Comment.id)).filter(Comment.owner_id == uid).scalar() or 0,
    }
    return data


@router.post("/{uid}/ban")
def ban_user(
    uid: str,
    body: BanBody,
    request: Request,
    admin: Admin = Depends(require_perm("user:manage")),
    db: Session = Depends(get_db),
):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="封禁需要填写原因")
    user.status = 1
    user.ban_reason = reason
    user.ban_at = datetime.now()
    log_action(db, admin, "封禁用户", uid, f"{user.nickname}｜{reason}", request)
    db.commit()
    return {"ok": True}


@router.post("/{uid}/unban")
def unban_user(
    uid: str,
    request: Request,
    admin: Admin = Depends(require_perm("user:manage")),
    db: Session = Depends(get_db),
):
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.status = 0
    user.ban_reason = ""
    user.ban_at = None
    log_action(db, admin, "解封用户", uid, user.nickname, request)
    db.commit()
    return {"ok": True}
