from .models import Admin, Comment, Notice, Post, Recipe, Report, SensitiveWord, User


def dt(value):
    return value.strftime("%Y-%m-%d %H:%M") if value else ""


# 小程序端把封面放在 /assets/covers，后台静态目录是 /covers，做一次映射
def media_url(path: str) -> str:
    if not path:
        return ""
    if path.startswith("/assets/covers/"):
        return path.replace("/assets/covers/", "/covers/")
    return path


# 写入方向的反向归一化：客户端会把拿到的 /covers/x 原样回传，
# 入库前补回 /assets/covers/ 前缀，避免库里同时存在两种写法。
def stored_media(path: str) -> str:
    if not path:
        return ""
    if path.startswith("/covers/"):
        return "/assets/covers/" + path[len("/covers/") :]
    return path


def recipe_brief(row: Recipe) -> dict:
    return {
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
        "reject_reason": row.reject_reason,
        "is_top": row.is_top,
        "is_official": row.is_official,
        "weight": row.weight,
        "owner_id": row.owner_id,
        "owner_name": row.owner_name,
        "like_count": row.like_count,
        "collect_count": row.collect_count,
        "view_count": row.view_count,
        "created_at": dt(row.created_at),
    }


def post_brief(row: Post) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "content": row.content,
        "media": [media_url(item) for item in (row.media or [])],
        "video_url": media_url(row.video_url),
        "post_type": row.post_type,
        "rel_recipe_id": row.rel_recipe_id,
        "audit_status": row.audit_status,
        "reject_reason": row.reject_reason,
        "is_top": row.is_top,
        "owner_id": row.owner_id,
        "owner_name": row.owner_name,
        "like_count": row.like_count,
        "collect_count": row.collect_count,
        "view_count": row.view_count,
        "created_at": dt(row.created_at),
    }


def comment_brief(row: Comment) -> dict:
    return {
        "id": row.id,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "content": row.content,
        "parent_id": row.parent_id,
        "owner_id": row.owner_id,
        "owner_name": row.owner_name,
        "created_at": dt(row.created_at),
    }


def report_brief(row: Report) -> dict:
    return {
        "id": row.id,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "target_title": row.target_title,
        "target_owner_id": row.target_owner_id,
        "reporter_id": row.reporter_id,
        "reporter_name": row.reporter_name,
        "reason": row.reason,
        "detail": row.detail,
        "status": row.status,
        "result": row.result,
        "handle_remark": row.handle_remark,
        "handled_by": row.handled_by,
        "handled_at": dt(row.handled_at),
        "created_at": dt(row.created_at),
    }


def user_brief(row: User) -> dict:
    return {
        "uid": row.uid,
        "nickname": row.nickname,
        "email": row.email,
        "status": row.status,
        "ban_reason": row.ban_reason,
        "ban_at": dt(row.ban_at),
        "created_at": dt(row.created_at),
    }


def notice_brief(row: Notice) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "content": row.content,
        "is_active": row.is_active,
        "created_at": dt(row.created_at),
    }


def word_brief(row: SensitiveWord) -> dict:
    return {"id": row.id, "word": row.word, "level": row.level, "created_at": dt(row.created_at)}


def admin_brief(row: Admin) -> dict:
    return {
        "id": row.id,
        "username": row.username,
        "name": row.name,
        "role_code": row.role_code,
        "status": row.status,
        "created_at": dt(row.created_at),
        "last_login_at": dt(row.last_login_at),
    }
