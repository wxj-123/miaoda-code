from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import log_action, require_perm
from ..models import Admin, Comment, Post, Recipe, RecipeMaterial, RecipeStep
from ..serializers import comment_brief, post_brief, recipe_brief

router = APIRouter(prefix="/api", tags=["内容管理"])


class TopBody(BaseModel):
    is_top: bool


class StatusBody(BaseModel):
    audit_status: int
    reason: str = ""


class RecipeUpdate(BaseModel):
    name: str | None = None
    cuisine: str | None = None
    region: str | None = None
    taste: str | None = None
    difficulty: str | None = None
    cost_time: int | None = None
    meal_type: str | None = None
    summary: str | None = None
    tags: list[str] | None = None
    fit_takeaway: bool | None = None
    fit_quick: bool | None = None
    weight: int | None = None


@router.get("/recipes")
def list_recipes(
    keyword: str = "",
    status: int | None = None,
    cuisine: str = "",
    page: int = 1,
    page_size: int = 10,
    db: Session = Depends(get_db),
    _=Depends(require_perm("content:manage")),
):
    query = db.query(Recipe)
    if keyword.strip():
        like = f"%{keyword.strip()}%"
        query = query.filter(or_(Recipe.name.like(like), Recipe.owner_name.like(like)))
    if status in (0, 1, 2, 3):
        query = query.filter(Recipe.audit_status == status)
    if cuisine.strip():
        query = query.filter(Recipe.cuisine == cuisine.strip())
    total = query.count()
    rows = (
        query.order_by(Recipe.is_top.desc(), Recipe.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "list": [recipe_brief(row) for row in rows]}


@router.get("/recipes/{recipe_id}")
def recipe_detail(
    recipe_id: int,
    db: Session = Depends(get_db),
    _=Depends(require_perm("content:manage")),
):
    row = db.get(Recipe, recipe_id)
    if not row:
        raise HTTPException(status_code=404, detail="菜谱不存在")
    data = recipe_brief(row)
    data["materials"] = [
        {"name": item.name, "dosage": item.dosage}
        for item in db.query(RecipeMaterial)
        .filter(RecipeMaterial.recipe_id == recipe_id)
        .order_by(RecipeMaterial.sort.asc())
        .all()
    ]
    data["steps"] = [
        {"sort": item.sort, "content": item.content, "img_url": item.img_url}
        for item in db.query(RecipeStep)
        .filter(RecipeStep.recipe_id == recipe_id)
        .order_by(RecipeStep.sort.asc())
        .all()
    ]
    return data


@router.put("/recipes/{recipe_id}")
def update_recipe(
    recipe_id: int,
    body: RecipeUpdate,
    request: Request,
    admin: Admin = Depends(require_perm("content:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Recipe, recipe_id)
    if not row:
        raise HTTPException(status_code=404, detail="菜谱不存在")
    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="没有需要保存的字段")
    for key, value in payload.items():
        setattr(row, key, value)
    log_action(db, admin, "编辑菜谱", f"菜谱#{row.id}", f"{row.name}", request)
    db.commit()
    return {"ok": True}


@router.post("/recipes/{recipe_id}/top")
def top_recipe(
    recipe_id: int,
    body: TopBody,
    request: Request,
    admin: Admin = Depends(require_perm("content:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Recipe, recipe_id)
    if not row:
        raise HTTPException(status_code=404, detail="菜谱不存在")
    row.is_top = body.is_top
    log_action(db, admin, "置顶菜谱" if body.is_top else "取消置顶", f"菜谱#{row.id}", row.name, request)
    db.commit()
    return {"ok": True}


@router.post("/recipes/{recipe_id}/status")
def recipe_status(
    recipe_id: int,
    body: StatusBody,
    request: Request,
    admin: Admin = Depends(require_perm("content:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Recipe, recipe_id)
    if not row:
        raise HTTPException(status_code=404, detail="菜谱不存在")
    row.audit_status = body.audit_status
    row.reject_reason = body.reason if body.audit_status == 3 else ""
    log_action(
        db, admin, "变更菜谱状态", f"菜谱#{row.id}", f"{row.name}｜状态={body.audit_status}｜{body.reason}", request
    )
    db.commit()
    return {"ok": True}


@router.delete("/recipes/{recipe_id}")
def delete_recipe(
    recipe_id: int,
    request: Request,
    admin: Admin = Depends(require_perm("content:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Recipe, recipe_id)
    if not row:
        raise HTTPException(status_code=404, detail="菜谱不存在")
    db.query(RecipeMaterial).filter(RecipeMaterial.recipe_id == recipe_id).delete()
    db.query(RecipeStep).filter(RecipeStep.recipe_id == recipe_id).delete()
    db.delete(row)
    log_action(db, admin, "删除菜谱", f"菜谱#{recipe_id}", row.name, request)
    db.commit()
    return {"ok": True}


@router.get("/posts")
def list_posts(
    keyword: str = "",
    status: int | None = None,
    page: int = 1,
    page_size: int = 10,
    db: Session = Depends(get_db),
    _=Depends(require_perm("content:manage")),
):
    query = db.query(Post)
    if keyword.strip():
        like = f"%{keyword.strip()}%"
        query = query.filter(or_(Post.title.like(like), Post.owner_name.like(like)))
    if status in (0, 1, 2, 3):
        query = query.filter(Post.audit_status == status)
    total = query.count()
    rows = query.order_by(Post.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"total": total, "list": [post_brief(row) for row in rows]}


@router.post("/posts/{post_id}/top")
def top_post(
    post_id: int,
    body: TopBody,
    request: Request,
    admin: Admin = Depends(require_perm("content:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Post, post_id)
    if not row:
        raise HTTPException(status_code=404, detail="帖子不存在")
    row.is_top = body.is_top
    log_action(db, admin, "置顶帖子" if body.is_top else "取消置顶", f"帖子#{row.id}", row.title, request)
    db.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/status")
def post_status(
    post_id: int,
    body: StatusBody,
    request: Request,
    admin: Admin = Depends(require_perm("content:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Post, post_id)
    if not row:
        raise HTTPException(status_code=404, detail="帖子不存在")
    row.audit_status = body.audit_status
    row.reject_reason = body.reason if body.audit_status == 3 else ""
    log_action(db, admin, "变更帖子状态", f"帖子#{row.id}", f"{row.title}｜状态={body.audit_status}", request)
    db.commit()
    return {"ok": True}


@router.delete("/posts/{post_id}")
def delete_post(
    post_id: int,
    request: Request,
    admin: Admin = Depends(require_perm("content:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Post, post_id)
    if not row:
        raise HTTPException(status_code=404, detail="帖子不存在")
    db.delete(row)
    log_action(db, admin, "删除帖子", f"帖子#{post_id}", row.title, request)
    db.commit()
    return {"ok": True}


@router.get("/comments")
def list_comments(
    keyword: str = "",
    target_type: str = "",
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _=Depends(require_perm("content:manage")),
):
    query = db.query(Comment)
    if keyword.strip():
        query = query.filter(Comment.content.like(f"%{keyword.strip()}%"))
    if target_type in ("recipe", "post"):
        query = query.filter(Comment.target_type == target_type)
    total = query.count()
    rows = query.order_by(Comment.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"total": total, "list": [comment_brief(row) for row in rows]}


@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: int,
    request: Request,
    admin: Admin = Depends(require_perm("content:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Comment, comment_id)
    if not row:
        raise HTTPException(status_code=404, detail="评论不存在")
    db.query(Comment).filter(Comment.parent_id == comment_id).delete()
    db.delete(row)
    log_action(db, admin, "删除评论", f"评论#{comment_id}", row.content[:60], request)
    db.commit()
    return {"ok": True}
