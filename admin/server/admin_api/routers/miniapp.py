"""小程序业务接口（/v1）。

语义与托管云版本保持一致：同样的字段名、同样的错误码，客户端只换实现、不改页面。
差别在于权限不再由数据库行级策略兜底，而在服务端逐个接口校验。
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import time
import urllib.parse
import urllib.request
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user, get_optional_user, log_app_action, require_app_admin
from ..models import (
    AppAdmin,
    AppConfig,
    Appeal,
    Collect,
    Comment,
    Follow,
    Like,
    Notice,
    Post,
    Recipe,
    RecipeMaterial,
    RecipeStep,
    Report,
    SensitiveWord,
    ShoppingItem,
    User,
)
from ..security import create_user_token
from ..serializers import media_url, stored_media
from ..moderation import audit, apply_verdict, decision_text, public_verdict, save_record

router = APIRouter(prefix="/v1", tags=["miniapp"])

MAX_PAGE_SIZE = 50


# ---------------- 通用小工具 ----------------


def iso(value: datetime | None) -> str:
    return value.isoformat(timespec="seconds") if value else ""


def page_args(page: int, page_size: int) -> tuple[int, int]:
    page = max(int(page or 1), 1)
    size = min(max(int(page_size or 10), 1), MAX_PAGE_SIZE)
    return page, size


def fail(status: int, code: str):
    raise HTTPException(status_code=status, detail=code)


def check_text(db: Session, *texts: str | None):
    """敏感词强制拦截，替代云端的数据库触发器。"""
    blob = " ".join(item or "" for item in texts)
    if not blob.strip():
        return
    for row in db.query(SensitiveWord).filter(SensitiveWord.level == 1).all():
        if row.word and row.word in blob:
            fail(400, "SENSITIVE_WORD:" + row.word)


def ensure_active(user: User):
    if user.status != 0:
        fail(403, "USER_BANNED")


def is_app_admin(db: Session, uid: str | None) -> bool:
    if not uid:
        return False
    return db.query(AppAdmin).filter(AppAdmin.uid == uid).first() is not None


# ---------------- 序列化 ----------------


def recipe_v1(row: Recipe, detail: bool = False) -> dict:
    data = {
        "id": row.id,
        "name": row.name,
        "cuisine": row.cuisine,
        "region": row.region,
        "cover_img": media_url(row.cover_img),
        "taste": row.taste,
        "difficulty": row.difficulty,
        "cost_time": row.cost_time,
        "fit_takeaway": row.fit_takeaway,
        "fit_quick": row.fit_quick,
        "meal_type": row.meal_type,
        "summary": row.summary,
        "tags": row.tags or [],
        "audit_status": row.audit_status,
        "reject_reason": row.reject_reason or "",
        "is_top": row.is_top,
        "is_official": row.is_official,
        "weight": row.weight,
        "owner_id": row.owner_id,
        "owner_name": row.owner_name or "美食爱好者",
        "like_count": row.like_count,
        "collect_count": row.collect_count,
        "view_count": row.view_count,
        "created_at": iso(row.created_at),
    }
    if detail:
        data["updated_at"] = iso(row.updated_at)
    return data


def post_v1(row: Post) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "content": row.content or "",
        "media": [media_url(item) for item in (row.media or [])],
        "video_url": media_url(row.video_url or ""),
        "post_type": row.post_type,
        "rel_recipe_id": row.rel_recipe_id,
        "audit_status": row.audit_status,
        "reject_reason": row.reject_reason or "",
        "is_top": row.is_top,
        "owner_id": row.owner_id,
        "owner_name": row.owner_name or "美食爱好者",
        "like_count": row.like_count,
        "collect_count": row.collect_count,
        "view_count": row.view_count,
        "created_at": iso(row.created_at),
    }


def comment_v1(row: Comment) -> dict:
    return {
        "id": row.id,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "content": row.content,
        "parent_id": row.parent_id,
        "owner_id": row.owner_id,
        "owner_name": row.owner_name or "一位食客",
        "like_count": row.like_count,
        "created_at": iso(row.created_at),
    }


def report_v1(row: Report) -> dict:
    return {
        "id": row.id,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "target_title": row.target_title,
        "target_owner_id": row.target_owner_id,
        "owner_id": row.reporter_id,
        "owner_name": row.reporter_name or "一位用户",
        "reason": row.reason,
        "detail": row.detail or "",
        "status": row.status,
        "result": row.result,
        "handle_remark": row.handle_remark or "",
        "handled_by": row.handled_by,
        "handled_at": iso(row.handled_at),
        "created_at": iso(row.created_at),
    }


# ---------------- 登录 ----------------


class LoginBody(BaseModel):
    code: str = ""
    device_id: str = ""
    nickname: str = ""


def wx_openid(code: str) -> str | None:
    """用 wx.login 的 code 换 openid。未配置 appid 时返回 None，走开发模式。"""
    if not settings.WX_APPID or not settings.WX_SECRET or not code:
        return None
    params = urllib.parse.urlencode(
        {
            "appid": settings.WX_APPID,
            "secret": settings.WX_SECRET,
            "js_code": code,
            "grant_type": "authorization_code",
        }
    )
    url = "https://api.weixin.qq.com/sns/jscode2session?" + params
    try:
        with urllib.request.urlopen(url, timeout=6) as resp:
            payload = resp.read().decode("utf-8")
        import json as _json

        data = _json.loads(payload)
        return data.get("openid")
    except Exception:
        return None


@router.post("/auth/login")
def login(body: LoginBody, db: Session = Depends(get_db)):
    openid = wx_openid(body.code)
    if openid:
        uid = "wx_" + openid
        mode = "wechat"
    else:
        seed = body.device_id or body.code or str(time.time())
        digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]
        uid = "dev_" + digest
        mode = "dev"

    user = db.get(User, uid)
    if user is None:
        user = User(uid=uid, nickname=body.nickname or "美食爱好者")
        db.add(user)
    elif body.nickname:
        user.nickname = body.nickname
    db.commit()
    db.refresh(user)

    if user.status != 0:
        fail(403, "USER_BANNED")

    return {
        "token": create_user_token(user.uid, user.nickname),
        "mode": mode,
        "user": {"id": user.uid, "name": user.nickname, "email": user.email},
        "is_admin": is_app_admin(db, user.uid),
    }


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {
        "user": {"id": user.uid, "name": user.nickname, "email": user.email},
        "is_admin": is_app_admin(db, user.uid),
        "status": user.status,
    }


class ProfileBody(BaseModel):
    nickname: str = ""


@router.patch("/me")
def update_me(body: ProfileBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = (body.nickname or "").strip()
    if name:
        user.nickname = name[:32]
        db.query(Recipe).filter(Recipe.owner_id == user.uid).update({"owner_name": user.nickname})
        db.query(Post).filter(Post.owner_id == user.uid).update({"owner_name": user.nickname})
        db.query(Comment).filter(Comment.owner_id == user.uid).update({"owner_name": user.nickname})
        db.commit()
    return {"user": {"id": user.uid, "name": user.nickname, "email": user.email}}


@router.post("/me/claim-admin")
def claim_admin(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # 只允许环境变量白名单内的 uid 认领首位审核员；未配置则彻底关闭认领，
    # 避免空库时任意用户抢注管理员。多个 uid 用逗号分隔。
    allowed = {item.strip() for item in settings.APP_ADMIN_CLAIM_UIDS.split(",") if item.strip()}
    if not allowed or user.uid not in allowed:
        raise HTTPException(status_code=403, detail="NOT_ELIGIBLE")
    if is_app_admin(db, user.uid):
        return {"ok": True}
    db.add(AppAdmin(uid=user.uid, name=user.nickname or "审核员"))
    db.commit()
    return {"ok": True}


# ---------------- 菜谱 ----------------


def recipe_query(db: Session, params: dict):
    query = db.query(Recipe)
    cuisine = (params.get("cuisine") or "").strip()
    if cuisine:
        query = query.filter(Recipe.cuisine == cuisine)
    meal = (params.get("meal") or "").strip()
    if meal:
        query = query.filter(Recipe.meal_type == meal)
    taste = (params.get("taste") or "").strip()
    if taste:
        query = query.filter(Recipe.taste == taste)
    difficulty = (params.get("difficulty") or "").strip()
    if difficulty:
        query = query.filter(Recipe.difficulty == difficulty)
    if str(params.get("quick") or "") in ("1", "true", "True"):
        query = query.filter(Recipe.fit_quick.is_(True))
    if str(params.get("takeaway") or "") in ("1", "true", "True"):
        query = query.filter(Recipe.fit_takeaway.is_(True))
    tag = (params.get("tag") or "").strip()
    if tag:
        query = query.filter(cast(Recipe.tags, String).like('%"' + tag + '"%'))
    max_time = params.get("max_time") or params.get("maxTime")
    try:
        if max_time and int(max_time) > 0:
            query = query.filter(Recipe.cost_time <= int(max_time))
    except (TypeError, ValueError):
        pass
    keyword = (params.get("keyword") or "").strip()
    if keyword:
        like = "%" + keyword + "%"
        query = query.filter(
            or_(
                Recipe.name.ilike(like),
                Recipe.summary.ilike(like),
                Recipe.cuisine.ilike(like),
                Recipe.region.ilike(like),
            )
        )
    return query


def recipe_sort(query, sort: str):
    if sort == "weight":
        return query.order_by(Recipe.is_top.desc(), Recipe.weight.desc(), Recipe.created_at.desc())
    if sort == "collect":
        return query.order_by(Recipe.is_top.desc(), Recipe.collect_count.desc(), Recipe.created_at.desc())
    if sort == "like":
        return query.order_by(Recipe.is_top.desc(), Recipe.like_count.desc(), Recipe.created_at.desc())
    return query.order_by(Recipe.is_top.desc(), Recipe.created_at.desc())


@router.get("/recipes")
def list_recipes(
    page: int = 1,
    page_size: int = 10,
    cuisine: str = "",
    meal: str = "",
    taste: str = "",
    difficulty: str = "",
    quick: str = "",
    takeaway: str = "",
    tag: str = "",
    max_time: int = 0,
    keyword: str = "",
    sort: str = "latest",
    db: Session = Depends(get_db),
):
    page, size = page_args(page, page_size)
    params = {
        "cuisine": cuisine,
        "meal": meal,
        "taste": taste,
        "difficulty": difficulty,
        "quick": quick,
        "takeaway": takeaway,
        "tag": tag,
        "max_time": max_time,
        "keyword": keyword,
    }
    query = recipe_query(db, params).filter(Recipe.audit_status == 2)
    total = query.count()
    rows = recipe_sort(query, sort).offset((page - 1) * size).limit(size).all()
    return {
        "list": [recipe_v1(row) for row in rows],
        "total": total,
        "has_more": (page - 1) * size + len(rows) < total,
    }


@router.get("/recipes/random")
def random_recipe(
    cuisine: str = "",
    meal: str = "",
    taste: str = "",
    difficulty: str = "",
    quick: str = "",
    takeaway: str = "",
    tag: str = "",
    max_time: int = 0,
    db: Session = Depends(get_db),
):
    params = {
        "cuisine": cuisine,
        "meal": meal,
        "taste": taste,
        "difficulty": difficulty,
        "quick": quick,
        "takeaway": takeaway,
        "tag": tag,
        "max_time": max_time,
    }
    rows = recipe_query(db, params).filter(Recipe.audit_status == 2).limit(50).all()
    if not rows:
        fail(404, "NO_MATCH")
    picked = random.choice(rows)
    data = recipe_v1(picked)
    materials = (
        db.query(RecipeMaterial)
        .filter(RecipeMaterial.recipe_id == picked.id)
        .order_by(RecipeMaterial.sort.asc())
        .all()
    )
    data["materials"] = [{"name": item.name, "dosage": item.dosage} for item in materials]
    return data


@router.get("/recipes/{recipe_id}")
def recipe_detail(
    recipe_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    row = db.get(Recipe, recipe_id)
    if row is None:
        fail(404, "NOT_FOUND")
    uid = user.uid if user else ""
    if row.audit_status != 2 and row.owner_id != uid and not is_app_admin(db, uid):
        fail(404, "NOT_FOUND")

    materials = (
        db.query(RecipeMaterial).filter(RecipeMaterial.recipe_id == recipe_id).order_by(RecipeMaterial.sort.asc()).all()
    )
    steps = db.query(RecipeStep).filter(RecipeStep.recipe_id == recipe_id).order_by(RecipeStep.sort.asc()).all()

    data = recipe_v1(row, detail=True)
    data["materials"] = [{"name": item.name, "dosage": item.dosage} for item in materials]
    data["steps"] = [
        {"sort": item.sort, "content": item.content, "img_url": media_url(item.img_url or "")} for item in steps
    ]
    data["is_owner"] = bool(uid) and uid == row.owner_id
    data["liked"] = bool(uid) and db.query(Like).filter_by(owner_id=uid, target_type="recipe", target_id=recipe_id).first() is not None
    data["collected"] = bool(uid) and db.query(Collect).filter_by(owner_id=uid, target_type="recipe", target_id=recipe_id).first() is not None
    return data


class MaterialIn(BaseModel):
    name: str = ""
    dosage: str = ""


class StepIn(BaseModel):
    content: str = ""
    img_url: str = ""


class RecipeBody(BaseModel):
    name: str = ""
    cuisine: str = ""
    region: str = ""
    taste: str = ""
    difficulty: str = "简单"
    cost_time: int = 30
    meal_type: str = ""
    summary: str = ""
    tags: list[str] = []
    fit_quick: bool = False
    fit_takeaway: bool = False
    cover_img: str = ""
    audit_status: int = 1
    materials: list[MaterialIn] = []
    steps: list[StepIn] = []


@router.post("/recipes")
def create_recipe(
    body: RecipeBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_active(user)
    name = (body.name or "").strip()
    if not name:
        fail(400, "EMPTY_NAME")

    material_names = " ".join(
        ((item.name or "").strip() + " " + (item.dosage or "").strip()).strip()
        for item in (body.materials or [])
        if (item.name or "").strip()
    )
    step_text = " ".join((item.content or "").strip() for item in (body.steps or []))
    # 草稿不送审；正式提交走自动审核，通过直接上线
    if body.audit_status == 0:
        verdict = {
            "decision": "pass",
            "status": 0,
            "score": 0,
            "code": "DRAFT",
            "reasons": [],
            "hint": "",
            "engine": "skip",
            "source": "auto",
        }
    else:
        verdict = audit(
            db,
            {"菜名": name, "简介": body.summary, "食材": material_names, "步骤": step_text},
            [body.cover_img] if body.cover_img else [],
            source="auto",
        )

    row = Recipe(
        owner_id=user.uid,
        owner_name=user.nickname or "美食爱好者",
        name=name[:64],
        cuisine=(body.cuisine or "").strip()[:32],
        region=(body.region or "").strip()[:32],
        taste=(body.taste or "").strip()[:32],
        difficulty=(body.difficulty or "简单").strip()[:16],
        cost_time=int(body.cost_time or 30),
        meal_type=(body.meal_type or "").strip()[:16],
        summary=(body.summary or "").strip(),
        tags=body.tags or [],
        fit_quick=bool(body.fit_quick),
        fit_takeaway=bool(body.fit_takeaway),
        cover_img=stored_media(body.cover_img),
        audit_status=verdict["status"],
        reject_reason=decision_text(verdict),
    )
    db.add(row)
    db.flush()
    if verdict.get("engine") != "skip":
        save_record(db, "recipe", row.id, user.uid, verdict)

    for index, item in enumerate(body.materials or []):
        if not (item.name or "").strip():
            continue
        db.add(
            RecipeMaterial(
                recipe_id=row.id,
                name=item.name.strip()[:64],
                dosage=(item.dosage or "").strip()[:64],
                sort=index + 1,
            )
        )
    for index, item in enumerate(body.steps or []):
        if not (item.content or "").strip():
            continue
        db.add(
            RecipeStep(
                recipe_id=row.id,
                sort=index + 1,
                content=item.content.strip(),
                img_url=stored_media(item.img_url),
            )
        )
    db.commit()
    return {"id": row.id, "audit": public_verdict(verdict)}


@router.delete("/recipes/{recipe_id}")
def delete_recipe(recipe_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Recipe, recipe_id)
    if row is None:
        fail(404, "NOT_FOUND")
    if row.owner_id != user.uid and not is_app_admin(db, user.uid):
        fail(403, "NO_PERMISSION")
    db.query(RecipeMaterial).filter(RecipeMaterial.recipe_id == recipe_id).delete()
    db.query(RecipeStep).filter(RecipeStep.recipe_id == recipe_id).delete()
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------------- 帖子 ----------------


@router.get("/posts")
def list_posts(
    page: int = 1,
    page_size: int = 10,
    keyword: str = "",
    sort: str = "latest",
    db: Session = Depends(get_db),
):
    page, size = page_args(page, page_size)
    query = db.query(Post).filter(Post.audit_status == 2)
    word = (keyword or "").strip()
    if word:
        like = "%" + word + "%"
        query = query.filter(or_(Post.title.ilike(like), Post.content.ilike(like)))
    total = query.count()
    if sort == "hot":
        query = query.order_by(Post.is_top.desc(), Post.like_count.desc(), Post.created_at.desc())
    else:
        query = query.order_by(Post.is_top.desc(), Post.created_at.desc())
    rows = query.offset((page - 1) * size).limit(size).all()
    return {
        "list": [post_v1(row) for row in rows],
        "total": total,
        "has_more": (page - 1) * size + len(rows) < total,
    }


@router.get("/posts/{post_id}")
def post_detail(
    post_id: int,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    row = db.get(Post, post_id)
    if row is None:
        fail(404, "NOT_FOUND")
    uid = user.uid if user else ""
    if row.audit_status != 2 and row.owner_id != uid and not is_app_admin(db, uid):
        fail(404, "NOT_FOUND")

    data = post_v1(row)
    data["is_owner"] = bool(uid) and uid == row.owner_id
    if row.rel_recipe_id:
        rel = db.get(Recipe, row.rel_recipe_id)
        if rel is not None:
            data["recipe"] = {
                "id": rel.id,
                "name": rel.name,
                "cover_img": media_url(rel.cover_img),
                "cuisine": rel.cuisine,
                "cost_time": rel.cost_time,
                "difficulty": rel.difficulty,
            }
    data["liked"] = bool(uid) and db.query(Like).filter_by(owner_id=uid, target_type="post", target_id=post_id).first() is not None
    data["collected"] = bool(uid) and db.query(Collect).filter_by(owner_id=uid, target_type="post", target_id=post_id).first() is not None
    return data


class PostBody(BaseModel):
    title: str = ""
    content: str = ""
    media: list[str] = []
    video_url: str = ""
    rel_recipe_id: int | None = None


@router.post("/posts")
def create_post(
    body: PostBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_active(user)
    title = (body.title or "").strip()
    if not title:
        fail(400, "EMPTY_TITLE")

    media = [stored_media(item) for item in (body.media or []) if item][:9]
    verdict = audit(db, {"标题": title, "正文": body.content}, media, source="auto")

    row = Post(
        owner_id=user.uid,
        owner_name=user.nickname or "美食爱好者",
        post_type="checkin" if body.rel_recipe_id else "normal",
        title=title[:120],
        content=(body.content or "").strip(),
        media=media,
        video_url=stored_media(body.video_url),
        rel_recipe_id=body.rel_recipe_id or None,
        audit_status=verdict["status"],
        reject_reason=decision_text(verdict),
    )
    db.add(row)
    db.flush()
    save_record(db, "post", row.id, user.uid, verdict)
    db.commit()
    return {"id": row.id, "audit": public_verdict(verdict)}


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Post, post_id)
    if row is None:
        fail(404, "NOT_FOUND")
    if row.owner_id != user.uid and not is_app_admin(db, user.uid):
        fail(403, "NO_PERMISSION")
    db.query(Comment).filter(Comment.target_type == "post", Comment.target_id == post_id).delete()
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------------- 互动 ----------------


class TargetBody(BaseModel):
    target_type: str
    target_id: int


def bump_counter(db: Session, target_type: str, target_id: int, field: str, delta: int):
    model = Recipe if target_type == "recipe" else Post if target_type == "post" else None
    if model is None:
        return
    row = db.get(model, target_id)
    if row is None:
        return
    value = max(int(getattr(row, field) or 0) + delta, 0)
    setattr(row, field, value)


@router.post("/likes/toggle")
def toggle_like(body: TargetBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.target_type not in ("recipe", "post"):
        fail(400, "BAD_TARGET_TYPE")
    row = db.query(Like).filter_by(owner_id=user.uid, target_type=body.target_type, target_id=body.target_id).first()
    if row is not None:
        db.delete(row)
        bump_counter(db, body.target_type, body.target_id, "like_count", -1)
        db.commit()
        return {"liked": False}
    db.add(Like(owner_id=user.uid, target_type=body.target_type, target_id=body.target_id))
    bump_counter(db, body.target_type, body.target_id, "like_count", 1)
    db.commit()
    return {"liked": True}


@router.post("/collects/toggle")
def toggle_collect(body: TargetBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.target_type not in ("recipe", "post"):
        fail(400, "BAD_TARGET_TYPE")
    row = db.query(Collect).filter_by(owner_id=user.uid, target_type=body.target_type, target_id=body.target_id).first()
    if row is not None:
        db.delete(row)
        bump_counter(db, body.target_type, body.target_id, "collect_count", -1)
        db.commit()
        return {"collected": False}
    db.add(Collect(owner_id=user.uid, target_type=body.target_type, target_id=body.target_id))
    bump_counter(db, body.target_type, body.target_id, "collect_count", 1)
    db.commit()
    return {"collected": True}


@router.get("/interactions/state")
def interaction_state(
    target_type: str,
    target_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {
        "liked": db.query(Like).filter_by(owner_id=user.uid, target_type=target_type, target_id=target_id).first() is not None,
        "collected": db.query(Collect).filter_by(owner_id=user.uid, target_type=target_type, target_id=target_id).first() is not None,
    }


# 浏览量去重：同一 IP 对同一内容在窗口期内只计一次，防止刷量。
# 匿名浏览是产品既定行为（详情页无需登录），因此用 IP 而非 uid 限流。
_VIEW_WINDOW_SEC = 60
_view_hits: dict[tuple[str, str, int], float] = {}


@router.post("/views")
def bump_view(body: TargetBody, request: Request, db: Session = Depends(get_db)):
    # 只接受两类合法目标，避免非法 type/id 污染计数器。
    if body.target_type not in ("recipe", "post") or body.target_id <= 0:
        return {"ok": True}
    ip = request.client.host if request.client else "unknown"
    key = (ip, body.target_type, body.target_id)
    now = time.time()
    last = _view_hits.get(key, 0)
    if now - last < _VIEW_WINDOW_SEC:
        return {"ok": True}
    _view_hits[key] = now
    # 顺手清理过期条目，避免字典无限增长。
    if len(_view_hits) > 5000:
        for k, t in list(_view_hits.items()):
            if now - t >= _VIEW_WINDOW_SEC:
                del _view_hits[k]
    bump_counter(db, body.target_type, body.target_id, "view_count", 1)
    db.commit()
    return {"ok": True}


# ---------------- 评论 ----------------


@router.get("/comments")
def list_comments(target_type: str, target_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(Comment)
        .filter(Comment.target_type == target_type, Comment.target_id == target_id)
        .order_by(Comment.created_at.asc())
        .limit(200)
        .all()
    )
    return {"list": [comment_v1(row) for row in rows]}


class CommentBody(BaseModel):
    target_type: str
    target_id: int
    content: str = ""
    parent_id: int | None = None


@router.post("/comments")
def add_comment(body: CommentBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ensure_active(user)
    content = (body.content or "").strip()
    if not content:
        fail(400, "EMPTY_CONTENT")
    check_text(db, content)
    row = Comment(
        owner_id=user.uid,
        owner_name=user.nickname or "一位食客",
        target_type=body.target_type,
        target_id=body.target_id,
        content=content[:500],
        parent_id=body.parent_id or None,
    )
    db.add(row)
    db.commit()
    return {"id": row.id}


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Comment, comment_id)
    if row is None:
        fail(404, "NOT_FOUND")
    if row.owner_id != user.uid and not is_app_admin(db, user.uid):
        fail(403, "NO_PERMISSION")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------------- 关注 ----------------


@router.get("/follows/state")
def follow_state(target_uid: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not target_uid or target_uid == user.uid:
        return {"following": False}
    row = db.query(Follow).filter_by(owner_id=user.uid, target_uid=target_uid).first()
    return {"following": row is not None}


@router.post("/follows/toggle")
def toggle_follow(target_uid: str = Query(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not target_uid or target_uid == user.uid:
        fail(400, "CANNOT_FOLLOW_SELF")
    row = db.query(Follow).filter_by(owner_id=user.uid, target_uid=target_uid).first()
    if row is not None:
        db.delete(row)
        db.commit()
        return {"following": False}
    db.add(Follow(owner_id=user.uid, target_uid=target_uid))
    db.commit()
    return {"following": True}


def follow_counts(db: Session, uid: str) -> dict:
    return {
        "fans": db.query(Follow).filter(Follow.target_uid == uid).count(),
        "following": db.query(Follow).filter(Follow.owner_id == uid).count(),
    }


# ---------------- 我的 ----------------


@router.get("/me/contents")
def my_contents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recipes = (
        db.query(Recipe).filter(Recipe.owner_id == user.uid).order_by(Recipe.created_at.desc()).limit(100).all()
    )
    posts = db.query(Post).filter(Post.owner_id == user.uid).order_by(Post.created_at.desc()).limit(100).all()

    # 申诉信息：待处理标记 + 已申诉轮数，供「我的发布」展示和限制入口
    appeals = db.query(Appeal).filter(Appeal.owner_id == user.uid).all()
    appeal_map: dict[str, dict] = {}
    for row in appeals:
        key = row.target_type + ":" + str(row.target_id)
        item = appeal_map.setdefault(key, {"count": 0, "pending": False})
        item["count"] += 1
        if row.status == 0:
            item["pending"] = True

    def attach(data, kind):
        info = appeal_map.get(kind + ":" + str(data["id"]), {"count": 0, "pending": False})
        data["appeal_count"] = info["count"]
        data["appeal_pending"] = info["pending"]
        data["appeal_left"] = max(3 - info["count"], 0)
        return data

    items = []
    for row in recipes:
        data = recipe_v1(row)
        data["kind"] = "recipe"
        items.append(attach(data, "recipe"))
    for row in posts:
        data = post_v1(row)
        data["kind"] = "post"
        data["cover"] = (data["media"] or [""])[0]
        items.append(attach(data, "post"))
    items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return {"list": items}


@router.get("/me/favorites")
def my_favorites(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(Collect)
        .filter(Collect.owner_id == user.uid)
        .order_by(Collect.created_at.desc())
        .limit(100)
        .all()
    )
    recipe_ids = [row.target_id for row in rows if row.target_type == "recipe"]
    post_ids = [row.target_id for row in rows if row.target_type == "post"]
    recipe_map = {}
    post_map = {}
    if recipe_ids:
        for row in db.query(Recipe).filter(Recipe.id.in_(recipe_ids)).all():
            data = recipe_v1(row)
            data["kind"] = "recipe"
            recipe_map[row.id] = data
    if post_ids:
        for row in db.query(Post).filter(Post.id.in_(post_ids)).all():
            data = post_v1(row)
            data["kind"] = "post"
            data["cover"] = (data["media"] or [""])[0]
            post_map[row.id] = data
    items = []
    for row in rows:
        item = recipe_map.get(row.target_id) if row.target_type == "recipe" else post_map.get(row.target_id)
        if item:
            items.append(item)
    return {"list": items}


@router.get("/me/audit-messages")
def my_audit_messages(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recipes = (
        db.query(Recipe)
        .filter(Recipe.owner_id == user.uid, Recipe.audit_status.in_([2, 3]))
        .order_by(Recipe.created_at.desc())
        .limit(30)
        .all()
    )
    posts = (
        db.query(Post)
        .filter(Post.owner_id == user.uid, Post.audit_status.in_([2, 3]))
        .order_by(Post.created_at.desc())
        .limit(30)
        .all()
    )
    items = []
    for row in recipes:
        items.append(
            {
                "id": "r" + str(row.id),
                "target": "recipe",
                "target_id": row.id,
                "title": row.name,
                "passed": row.audit_status == 2,
                "reason": row.reject_reason or "",
                "created_at": iso(row.created_at),
            }
        )
    for row in posts:
        items.append(
            {
                "id": "p" + str(row.id),
                "target": "post",
                "target_id": row.id,
                "title": row.title,
                "passed": row.audit_status == 2,
                "reason": row.reject_reason or "",
                "created_at": iso(row.created_at),
            }
        )
    items.sort(key=lambda item: item["created_at"], reverse=True)
    return {"list": items}


@router.get("/me/interactions")
def my_interactions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    recipes = db.query(Recipe.id, Recipe.name).filter(Recipe.owner_id == user.uid).limit(100).all()
    posts = db.query(Post.id, Post.title).filter(Post.owner_id == user.uid).limit(100).all()
    names = {}
    for row in recipes:
        names["recipe:" + str(row.id)] = row.name
    for row in posts:
        names["post:" + str(row.id)] = row.title
    if not names:
        return {"list": []}

    recipe_ids = [row.id for row in recipes]
    post_ids = [row.id for row in posts]
    conditions = []
    if recipe_ids:
        conditions.append((Comment.target_type == "recipe") & (Comment.target_id.in_(recipe_ids)))
    if post_ids:
        conditions.append((Comment.target_type == "post") & (Comment.target_id.in_(post_ids)))
    rows = db.query(Comment).filter(or_(*conditions)).order_by(Comment.created_at.desc()).limit(100).all()
    items = []
    for row in rows:
        key = row.target_type + ":" + str(row.target_id)
        if key not in names:
            continue
        items.append(
            {
                "id": row.id,
                "who": row.owner_name or "一位食客",
                "content": row.content,
                "target_text": names[key],
                "target": row.target_type,
                "target_id": row.target_id,
                "created_at": iso(row.created_at),
            }
        )
    return {"list": items}


@router.get("/users/{uid}")
def author_home(uid: str, db: Session = Depends(get_db), user: User | None = Depends(get_optional_user)):
    recipes = (
        db.query(Recipe)
        .filter(Recipe.owner_id == uid, Recipe.audit_status == 2)
        .order_by(Recipe.created_at.desc())
        .limit(50)
        .all()
    )
    posts = (
        db.query(Post)
        .filter(Post.owner_id == uid, Post.audit_status == 2)
        .order_by(Post.created_at.desc())
        .limit(50)
        .all()
    )
    name = ""
    for row in recipes + posts:
        if row.owner_name:
            name = row.owner_name
            break
    if not name:
        owner = db.get(User, uid)
        name = owner.nickname if owner and owner.nickname else "美食爱好者"
    counts = follow_counts(db, uid)
    following = False
    if user is not None and user.uid != uid:
        following = db.query(Follow).filter_by(owner_id=user.uid, target_uid=uid).first() is not None
    return {
        "uid": uid,
        "name": name,
        "recipes": [dict(recipe_v1(row), kind="recipe") for row in recipes],
        "posts": [dict(post_v1(row), kind="post") for row in posts],
        "following": following,
        "fans": counts["fans"],
        "following_count": counts["following"],
        "view_total": sum(row.view_count or 0 for row in recipes),
        "collect_total": sum(row.collect_count or 0 for row in recipes),
    }


# ---------------- 买菜清单 ----------------


@router.get("/shopping")
def list_shopping(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(ShoppingItem)
        .filter(ShoppingItem.owner_id == user.uid)
        .order_by(ShoppingItem.created_at.asc())
        .limit(200)
        .all()
    )
    return {
        "list": [
            {
                "id": row.id,
                "name": row.name,
                "dosage": row.dosage or "",
                "source_recipe_id": row.source_recipe_id,
                "source_recipe_name": row.source_recipe_name or "",
                "checked": row.checked,
                "created_at": iso(row.created_at),
            }
            for row in rows
        ]
    }


class ShoppingBatchItem(BaseModel):
    name: str = ""
    dosage: str = ""


class ShoppingBatchBody(BaseModel):
    items: list[ShoppingBatchItem] = []
    recipe_id: int | None = None
    recipe_name: str = ""


@router.post("/shopping/batch")
def add_shopping_batch(
    body: ShoppingBatchBody,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = [item for item in (body.items or []) if (item.name or "").strip()]
    if not rows:
        fail(400, "EMPTY_ITEMS")
    for item in rows:
        db.add(
            ShoppingItem(
                owner_id=user.uid,
                name=item.name.strip()[:64],
                dosage=(item.dosage or "").strip()[:64],
                source_recipe_id=body.recipe_id,
                source_recipe_name=(body.recipe_name or "")[:64],
            )
        )
    db.commit()
    return {"count": len(rows)}


class ShoppingBody(BaseModel):
    name: str = ""
    dosage: str = ""


@router.post("/shopping")
def add_shopping(body: ShoppingBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    name = (body.name or "").strip()
    if not name:
        fail(400, "EMPTY_NAME")
    db.add(ShoppingItem(owner_id=user.uid, name=name[:64], dosage=(body.dosage or "").strip()[:64]))
    db.commit()
    return {"ok": True}


class ShoppingPatch(BaseModel):
    checked: bool = False


@router.patch("/shopping/{item_id}")
def patch_shopping(item_id: int, body: ShoppingPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(ShoppingItem, item_id)
    if row is None or row.owner_id != user.uid:
        fail(404, "NOT_FOUND")
    row.checked = bool(body.checked)
    db.commit()
    return {"ok": True}


@router.delete("/shopping/{item_id}")
def delete_shopping(item_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(ShoppingItem, item_id)
    if row is None or row.owner_id != user.uid:
        fail(404, "NOT_FOUND")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.delete("/shopping")
def clear_shopping(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(ShoppingItem).filter(ShoppingItem.owner_id == user.uid).delete()
    db.commit()
    return {"ok": True}


# ---------------- 公告 / 配置 / 元信息 ----------------


@router.get("/notices")
def list_notices(db: Session = Depends(get_db)):
    rows = db.query(Notice).filter(Notice.is_active.is_(True)).order_by(Notice.created_at.desc()).limit(20).all()
    return {
        "list": [
            {"id": row.id, "title": row.title, "content": row.content, "created_at": iso(row.created_at)} for row in rows
        ]
    }


# 仅向小程序公开的非敏感配置键（白名单）。内部标记如 initialized、drinks
# 不得通过此接口暴露；品牌池走专门的 /v1/drinks。
PUBLIC_CONFIG_KEYS = {
    "subscribe_templates",
    "video_max_mb",
    "video_max_seconds",
    "private_message_enabled",
    "auto_audit_enabled",
}


@router.get("/config")
def get_config(db: Session = Depends(get_db)):
    return {
        row.config_key: row.config_value or ""
        for row in db.query(AppConfig).all()
        if row.config_key in PUBLIC_CONFIG_KEYS
    }


# 今日想喝品牌池：走 AppConfig，key=drinks，值是 JSON 数组。
# 小程序优先用它，缺失或解析失败时回落包内默认池。
@router.get("/drinks")
def get_drinks(db: Session = Depends(get_db)):
    row = db.query(AppConfig).filter(AppConfig.config_key == "drinks").first()
    if row is None or not row.config_value:
        return {"brands": []}
    try:
        brands = json.loads(row.config_value)
    except Exception:
        return {"brands": []}
    if not isinstance(brands, list):
        return {"brands": []}
    return {"brands": brands}


@router.get("/meta/cuisines")
def list_cuisines(db: Session = Depends(get_db)):
    rows = db.query(Recipe.cuisine).filter(Recipe.audit_status == 2).limit(500).all()
    seen, out = set(), []
    for (value,) in rows:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return {"list": out}


# ---------------- 举报 ----------------


class ReportBody(BaseModel):
    target_type: str
    target_id: int
    reason: str = ""
    detail: str = ""


@router.post("/reports")
def submit_report(body: ReportBody, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    owner = ""
    title = ""
    if body.target_type == "recipe":
        row = db.get(Recipe, body.target_id)
        if row is None:
            fail(404, "TARGET_NOT_FOUND")
        owner, title = row.owner_id, row.name
    elif body.target_type == "post":
        row = db.get(Post, body.target_id)
        if row is None:
            fail(404, "TARGET_NOT_FOUND")
        owner, title = row.owner_id, row.title
    elif body.target_type == "comment":
        row = db.get(Comment, body.target_id)
        if row is None:
            fail(404, "TARGET_NOT_FOUND")
        owner, title = row.owner_id, row.content[:40]
    else:
        fail(400, "BAD_TARGET_TYPE")

    if owner == user.uid:
        fail(400, "CANNOT_REPORT_SELF")
    duplicated = (
        db.query(Report)
        .filter(
            Report.reporter_id == user.uid,
            Report.target_type == body.target_type,
            Report.target_id == body.target_id,
            Report.status == 0,
        )
        .first()
    )
    if duplicated is not None:
        fail(400, "ALREADY_REPORTED")

    row = Report(
        reporter_id=user.uid,
        reporter_name=user.nickname or "一位用户",
        target_type=body.target_type,
        target_id=body.target_id,
        target_owner_id=owner,
        target_title=title,
        reason=(body.reason or "")[:32],
        detail=(body.detail or "").strip(),
    )
    db.add(row)
    db.commit()
    return {"id": row.id}


# ---------------- 小程序内置管理台 ----------------


@router.get("/admin/pending")
def admin_pending(user: User = Depends(require_app_admin), db: Session = Depends(get_db)):
    recipes = db.query(Recipe).filter(Recipe.audit_status == 1).order_by(Recipe.created_at.asc()).limit(50).all()
    posts = db.query(Post).filter(Post.audit_status == 1).order_by(Post.created_at.asc()).limit(50).all()
    items = [dict(recipe_v1(row), kind="recipe", title=row.name) for row in recipes]
    items += [dict(post_v1(row), kind="post") for row in posts]
    return {"list": items}


class ModerateBody(BaseModel):
    kind: str
    id: int
    passed: bool = True
    reason: str = ""


@router.post("/admin/moderate")
def admin_moderate(body: ModerateBody, user: User = Depends(require_app_admin), db: Session = Depends(get_db)):
    model = Recipe if body.kind == "recipe" else Post if body.kind == "post" else None
    if model is None:
        fail(400, "BAD_KIND")
    row = db.get(model, body.id)
    if row is None:
        fail(404, "NOT_FOUND")
    row.audit_status = 2 if body.passed else 3
    row.reject_reason = "" if body.passed else (body.reason or "内容不符合社区规范")[:255]
    if isinstance(row, Recipe):
        row.updated_at = datetime.now()
    log_app_action(
        db, user.uid, "小程序审核通过" if body.passed else "小程序审核驳回",
        f"{'菜谱' if body.kind == 'recipe' else '帖子'}#{body.id}",
        (row.name if isinstance(row, Recipe) else row.title) or "",
    )
    db.commit()
    return {"ok": True}


@router.get("/admin/reports")
def admin_reports(status: int | None = None, db: Session = Depends(get_db), user: User = Depends(require_app_admin)):
    query = db.query(Report)
    if status in (0, 1):
        query = query.filter(Report.status == status)
    rows = query.order_by(Report.created_at.desc()).limit(100).all()
    return {"list": [report_v1(row) for row in rows]}


class HandleReportBody(BaseModel):
    result: int = 0
    remark: str = ""


@router.post("/admin/reports/{report_id}/handle")
def admin_handle_report(
    report_id: int,
    body: HandleReportBody,
    user: User = Depends(require_app_admin),
    db: Session = Depends(get_db),
):
    row = db.get(Report, report_id)
    if row is None:
        fail(404, "NOT_FOUND")
    if row.status != 0:
        fail(400, "ALREADY_HANDLED")
    row.status = 1
    row.result = 1 if body.result else 0
    row.handle_remark = (body.remark or "")[:255]
    row.handled_by = user.nickname or user.uid
    row.handled_at = datetime.now()
    if row.result == 1:
        if row.target_type == "recipe":
            target = db.get(Recipe, row.target_id)
            if target:
                target.audit_status = 3
                target.reject_reason = (body.remark or "举报违规下架")[:255]
        elif row.target_type == "post":
            target = db.get(Post, row.target_id)
            if target:
                target.audit_status = 3
                target.reject_reason = (body.remark or "举报违规下架")[:255]
        elif row.target_type == "comment":
            target = db.get(Comment, row.target_id)
            if target:
                db.delete(target)
    log_app_action(
        db, user.uid, "小程序处理举报",
        f"举报#{report_id}",
        f"判定={'违规' if row.result else '合规'}｜举报类型={row.target_type}#{row.target_id}",
    )
    db.commit()
    return {"ok": True}


@router.get("/admin/contents")
def admin_contents(kind: str = "recipe", db: Session = Depends(get_db), user: User = Depends(require_app_admin)):
    if kind == "post":
        rows = db.query(Post).order_by(Post.created_at.desc()).limit(100).all()
        return {"list": [post_v1(row) for row in rows]}
    rows = db.query(Recipe).order_by(Recipe.created_at.desc()).limit(100).all()
    return {"list": [recipe_v1(row) for row in rows]}


class ContentActionBody(BaseModel):
    kind: str
    id: int
    action: str


@router.post("/admin/contents/action")
def admin_content_action(
    body: ContentActionBody,
    user: User = Depends(require_app_admin),
    db: Session = Depends(get_db),
):
    model = Recipe if body.kind == "recipe" else Post if body.kind == "post" else None
    if model is None:
        fail(400, "BAD_KIND")
    row = db.get(model, body.id)
    if row is None:
        fail(404, "NOT_FOUND")
    if body.action == "top":
        row.is_top = True
    elif body.action == "untop":
        row.is_top = False
    elif body.action == "takedown":
        row.audit_status = 3
        row.reject_reason = row.reject_reason or "管理员下架"
    elif body.action == "restore":
        row.audit_status = 2
        row.reject_reason = ""
    else:
        fail(400, "BAD_ACTION")
    log_app_action(
        db, user.uid, f"小程序内容-{body.action}",
        f"{'菜谱' if body.kind == 'recipe' else '帖子'}#{body.id}",
        row.name if isinstance(row, Recipe) else row.title,
    )
    db.commit()
    return {"ok": True}


@router.get("/admin/authors")
def admin_authors(db: Session = Depends(get_db), user: User = Depends(require_app_admin)):
    owners: dict[str, dict] = {}
    for uid, name in db.query(Recipe.owner_id, Recipe.owner_name).limit(300).all():
        if not uid or uid == "official":
            continue
        owners.setdefault(uid, {"uid": uid, "name": name or "未设置昵称", "count": 0})
        owners[uid]["count"] += 1
        if name:
            owners[uid]["name"] = name
    for uid, name in db.query(Post.owner_id, Post.owner_name).limit(300).all():
        if not uid or uid == "official":
            continue
        owners.setdefault(uid, {"uid": uid, "name": name or "未设置昵称", "count": 0})
        owners[uid]["count"] += 1
        if name:
            owners[uid]["name"] = name
    for uid, name in db.query(Comment.owner_id, Comment.owner_name).limit(300).all():
        if not uid or uid == "official":
            continue
        owners.setdefault(uid, {"uid": uid, "name": name or "未设置昵称", "count": 0})
        owners[uid]["count"] += 1
        if name:
            owners[uid]["name"] = name
    for owner in owners.values():
        target = db.get(User, owner["uid"])
        owner["banned"] = bool(target and target.status != 0)
        owner["ban_reason"] = (target.ban_reason if target else "") or ""
    items = sorted(owners.values(), key=lambda item: item["count"], reverse=True)
    return {"list": items}


class UserActionBody(BaseModel):
    action: str = "ban"
    reason: str = ""


@router.post("/admin/users/{uid}/action")
def admin_user_action(
    uid: str,
    body: UserActionBody,
    user: User = Depends(require_app_admin),
    db: Session = Depends(get_db),
):
    if uid == user.uid:
        fail(400, "CANNOT_BAN_SELF")
    target = db.get(User, uid)
    # 不为一个从未存在的 uid 凭空造号：封禁/解封都要求用户已存在。
    if target is None:
        fail(404, "NOT_FOUND")
    if body.action == "ban":
        target.status = 1
        target.ban_reason = (body.reason or "违反社区规范")[:255]
        target.ban_at = datetime.now()
    else:
        target.status = 0
        target.ban_reason = ""
        target.ban_at = None
    log_app_action(
        db, user.uid, "小程序封禁用户" if body.action == "ban" else "小程序解封用户",
        f"用户#{uid}", (body.reason or "")[:200],
    )
    db.commit()
    return {"ok": True}


@router.get("/admin/notices")
def admin_notices(db: Session = Depends(get_db), user: User = Depends(require_app_admin)):
    rows = db.query(Notice).order_by(Notice.created_at.desc()).limit(50).all()
    return {
        "list": [
            {
                "id": row.id,
                "title": row.title,
                "content": row.content,
                "is_active": row.is_active,
                "created_at": iso(row.created_at),
            }
            for row in rows
        ]
    }


class NoticeActionBody(BaseModel):
    action: str
    id: int | None = None
    title: str = ""
    content: str = ""
    active: bool = True


@router.post("/admin/notices/action")
def admin_notice_action(
    body: NoticeActionBody,
    user: User = Depends(require_app_admin),
    db: Session = Depends(get_db),
):
    if body.action == "create":
        title = (body.title or "").strip()
        if not title:
            fail(400, "EMPTY_TITLE")
        db.add(Notice(title=title[:120], content=(body.content or "").strip(), is_active=True))
        log_app_action(db, user.uid, "小程序发布公告", "公告", title[:120])
    elif body.action == "toggle":
        row = db.get(Notice, body.id or 0)
        if row is None:
            fail(404, "NOT_FOUND")
        row.is_active = bool(body.active)
        log_app_action(db, user.uid, "小程序切换公告状态", f"公告#{body.id}", f"展示={row.is_active}")
    elif body.action == "delete":
        row = db.get(Notice, body.id or 0)
        if row is None:
            fail(404, "NOT_FOUND")
        log_app_action(db, user.uid, "小程序删除公告", f"公告#{body.id}", row.title)
        db.delete(row)
    else:
        fail(400, "BAD_ACTION")
    db.commit()
    return {"ok": True}


@router.get("/admin/words")
def admin_words(db: Session = Depends(get_db), user: User = Depends(require_app_admin)):
    rows = db.query(SensitiveWord).order_by(SensitiveWord.created_at.desc()).limit(300).all()
    return {
        "list": [
            {"id": row.id, "word": row.word, "level": row.level, "created_at": iso(row.created_at)} for row in rows
        ]
    }


class WordActionBody(BaseModel):
    action: str
    id: int | None = None
    word: str = ""


@router.post("/admin/words/action")
def admin_word_action(
    body: WordActionBody,
    user: User = Depends(require_app_admin),
    db: Session = Depends(get_db),
):
    if body.action == "add":
        word = (body.word or "").strip()
        if not word:
            fail(400, "EMPTY_WORD")
        exists = db.query(SensitiveWord).filter(SensitiveWord.word == word).first()
        if exists is None:
            db.add(SensitiveWord(word=word[:64], level=1))
            log_app_action(db, user.uid, "小程序新增敏感词", "词库", word[:64])
    elif body.action == "remove":
        row = db.get(SensitiveWord, body.id or 0)
        if row is not None:
            log_app_action(db, user.uid, "小程序删除敏感词", "词库", row.word)
            db.delete(row)
    else:
        fail(400, "BAD_ACTION")
    db.commit()
    return {"ok": True}


# ---------------- 上传 ----------------


@router.post("/upload")
async def upload(
    file: UploadFile = File(...),
    kind: str = "image",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_active(user)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov"):
        ext = ".mp4" if kind == "video" else ".jpg"
    folder = "video" if kind == "video" else "food"
    sub_dir = os.path.join(settings.UPLOAD_DIR, user.uid, folder)
    os.makedirs(sub_dir, exist_ok=True)
    name = str(int(time.time() * 1000)) + "-" + hashlib.md5(str(random.random()).encode()).hexdigest()[:8] + ext
    target = os.path.join(sub_dir, name)
    content = await file.read()
    limit = 60 * 1024 * 1024 if kind == "video" else 8 * 1024 * 1024
    if len(content) > limit:
        fail(400, "FILE_TOO_LARGE")
    with open(target, "wb") as fh:
        fh.write(content)
    return {"path": "/uploads/" + user.uid + "/" + folder + "/" + name}
