from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_perm
from ..models import Comment, Post, Recipe, Report, User
from ..serializers import recipe_brief

router = APIRouter(prefix="/api/stats", tags=["数据大盘"])


@router.get("/overview")
def overview(db: Session = Depends(get_db), _=Depends(require_perm("stats:view"))):
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    recipe_total = db.query(func.count(Recipe.id)).scalar() or 0
    post_total = db.query(func.count(Post.id)).scalar() or 0
    user_total = db.query(func.count(User.uid)).scalar() or 0
    comment_total = db.query(func.count(Comment.id)).scalar() or 0

    pending_recipes = db.query(func.count(Recipe.id)).filter(Recipe.audit_status == 1).scalar() or 0
    pending_posts = db.query(func.count(Post.id)).filter(Post.audit_status == 1).scalar() or 0
    pending_reports = db.query(func.count(Report.id)).filter(Report.status == 0).scalar() or 0
    banned_users = db.query(func.count(User.uid)).filter(User.status == 1).scalar() or 0

    today_recipes = db.query(func.count(Recipe.id)).filter(Recipe.created_at >= today).scalar() or 0
    today_posts = db.query(func.count(Post.id)).filter(Post.created_at >= today).scalar() or 0
    today_users = db.query(func.count(User.uid)).filter(User.created_at >= today).scalar() or 0

    views = db.query(func.coalesce(func.sum(Recipe.view_count), 0)).scalar() or 0
    post_views = db.query(func.coalesce(func.sum(Post.view_count), 0)).scalar() or 0

    return {
        "totals": {
            "recipe": recipe_total,
            "post": post_total,
            "user": user_total,
            "comment": comment_total,
            "view": int(views) + int(post_views),
        },
        "pending": {
            "recipe": pending_recipes,
            "post": pending_posts,
            "report": pending_reports,
            "all": pending_recipes + pending_posts,
        },
        "today": {"recipe": today_recipes, "post": today_posts, "user": today_users},
        "banned": banned_users,
    }


@router.get("/trend")
def trend(days: int = 7, db: Session = Depends(get_db), _=Depends(require_perm("stats:view"))):
    days = max(3, min(days, 30))
    start = (datetime.now() - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    labels = [(start + timedelta(days=i)).strftime("%m-%d") for i in range(days)]

    recipe_rows = (
        db.query(func.date(Recipe.created_at), func.count(Recipe.id))
        .filter(Recipe.created_at >= start)
        .group_by(func.date(Recipe.created_at))
        .all()
    )
    post_rows = (
        db.query(func.date(Post.created_at), func.count(Post.id))
        .filter(Post.created_at >= start)
        .group_by(func.date(Post.created_at))
        .all()
    )

    def to_map(rows):
        out = {}
        for day, count in rows:
            key = str(day)[5:10] if not isinstance(day, str) else day[5:10]
            out[key] = count
        return out

    rmap, pmap = to_map(recipe_rows), to_map(post_rows)
    return {
        "labels": labels,
        "recipes": [rmap.get(label, 0) for label in labels],
        "posts": [pmap.get(label, 0) for label in labels],
    }


@router.get("/top")
def top(db: Session = Depends(get_db), _=Depends(require_perm("stats:view"))):
    top_recipes = db.query(Recipe).order_by(Recipe.view_count.desc()).limit(5).all()
    hot_posts = db.query(Post).order_by(Post.like_count.desc()).limit(5).all()
    author_rows = (
        db.query(Recipe.owner_name, func.count(Recipe.id))
        .filter(Recipe.owner_id != "official")
        .group_by(Recipe.owner_name)
        .order_by(func.count(Recipe.id).desc())
        .limit(5)
        .all()
    )
    return {
        "recipes": [
            {"id": row.id, "name": row.name, "view": row.view_count, "collect": row.collect_count}
            for row in top_recipes
        ],
        "posts": [{"id": row.id, "title": row.title, "like": row.like_count} for row in hot_posts],
        "authors": [{"name": name or "未设置昵称", "count": count} for name, count in author_rows],
    }


@router.get("/cuisine")
def cuisine_distribution(db: Session = Depends(get_db), _=Depends(require_perm("stats:view"))):
    rows = (
        db.query(Recipe.cuisine, func.count(Recipe.id))
        .filter(Recipe.audit_status == 2)
        .group_by(Recipe.cuisine)
        .order_by(func.count(Recipe.id).desc())
        .all()
    )
    return [{"cuisine": name or "未分类", "count": count} for name, count in rows]


@router.get("/latest")
def latest(db: Session = Depends(get_db), _=Depends(require_perm("stats:view"))):
    rows = db.query(Recipe).order_by(Recipe.created_at.desc()).limit(5).all()
    return [recipe_brief(row) for row in rows]
