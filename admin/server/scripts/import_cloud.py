"""把托管云导出的 JSON 导入自建库。

用法（在 admin/server 目录下）：
    .venv\\Scripts\\python -m scripts.import_cloud
    .venv\\Scripts\\python -m scripts.import_cloud --merge        # 只补缺失，不删旧数据
    .venv\\Scripts\\python -m scripts.import_cloud --file migration/cloud-dump.json

默认 replace：先清空业务表再原样写入（保留原 id，关系和收藏、举报的 target_id 不会错位）。
后台账号、角色、操作日志不在清理范围内。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from admin_api.db import Base, SessionLocal, engine  # noqa: E402
from admin_api.models import (  # noqa: E402
    AppAdmin,
    AppConfig,
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

BUSINESS_TABLES = [
    ("users", User),
    ("reports", Report),
    ("likes", Like),
    ("collects", Collect),
    ("comments", Comment),
    ("shopping_items", ShoppingItem),
    ("follows", Follow),
    ("recipe_materials", RecipeMaterial),
    ("recipe_steps", RecipeStep),
    ("posts", Post),
    ("recipes", Recipe),
    ("notices", Notice),
    ("sensitive_words", SensitiveWord),
    ("app_config", AppConfig),
    ("app_admins", AppAdmin),
]


def parse_dt(value):
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    # 统一存成 naive 本地时间，避免 SQLite 与 PostgreSQL 行为差异
    if parsed.tzinfo is not None:
        parsed = parsed.replace(tzinfo=None)
    return parsed


def build_rows(data: dict) -> dict:
    rows: dict[str, list] = {}

    rows["recipes"] = [
        Recipe(
            id=item["id"],
            owner_id=item.get("owner_id") or "",
            owner_name=item.get("owner_name") or "",
            name=item["name"],
            cuisine=item.get("cuisine") or "",
            region=item.get("region") or "",
            cover_img=item.get("cover_img") or "",
            taste=item.get("taste") or "",
            difficulty=item.get("difficulty") or "简单",
            cost_time=item.get("cost_time") or 30,
            fit_takeaway=bool(item.get("fit_takeaway")),
            fit_quick=bool(item.get("fit_quick")),
            meal_type=item.get("meal_type") or "",
            summary=item.get("summary") or "",
            tags=item.get("tags") or [],
            audit_status=item.get("audit_status", 1),
            reject_reason=item.get("reject_reason") or "",
            is_top=bool(item.get("is_top")),
            weight=item.get("weight") or 0,
            like_count=item.get("like_count") or 0,
            collect_count=item.get("collect_count") or 0,
            view_count=item.get("view_count") or 0,
            is_official=bool(item.get("is_official")),
            created_at=parse_dt(item.get("created_at")) or datetime.now(),
            updated_at=parse_dt(item.get("updated_at")) or parse_dt(item.get("created_at")) or datetime.now(),
        )
        for item in data.get("recipes", [])
    ]

    rows["recipe_materials"] = [
        RecipeMaterial(
            id=item["id"],
            recipe_id=item["recipe_id"],
            name=item["name"],
            dosage=item.get("dosage") or "",
            sort=item.get("sort") or 0,
        )
        for item in data.get("recipe_materials", [])
    ]

    rows["recipe_steps"] = [
        RecipeStep(
            id=item["id"],
            recipe_id=item["recipe_id"],
            sort=item.get("sort") or 0,
            content=item["content"],
            img_url=item.get("img_url") or "",
        )
        for item in data.get("recipe_steps", [])
    ]

    rows["posts"] = [
        Post(
            id=item["id"],
            owner_id=item.get("owner_id") or "",
            owner_name=item.get("owner_name") or "",
            post_type=item.get("post_type") or "normal",
            title=item["title"],
            content=item.get("content") or "",
            media=item.get("media") or [],
            video_url=item.get("video_url") or "",
            rel_recipe_id=item.get("rel_recipe_id"),
            audit_status=item.get("audit_status", 1),
            reject_reason=item.get("reject_reason") or "",
            is_top=bool(item.get("is_top")),
            like_count=item.get("like_count") or 0,
            collect_count=item.get("collect_count") or 0,
            view_count=item.get("view_count") or 0,
            created_at=parse_dt(item.get("created_at")) or datetime.now(),
        )
        for item in data.get("posts", [])
    ]

    rows["comments"] = [
        Comment(
            id=item["id"],
            owner_id=item.get("owner_id") or "",
            owner_name=item.get("owner_name") or "",
            target_type=item.get("target_type") or "recipe",
            target_id=item.get("target_id") or 0,
            content=item["content"],
            parent_id=item.get("parent_id"),
            like_count=item.get("like_count") or 0,
            created_at=parse_dt(item.get("created_at")) or datetime.now(),
        )
        for item in data.get("comments", [])
    ]

    rows["likes"] = [
        Like(
            id=item["id"],
            owner_id=item["owner_id"],
            target_type=item["target_type"],
            target_id=item["target_id"],
            created_at=parse_dt(item.get("created_at")) or datetime.now(),
        )
        for item in data.get("likes", [])
    ]

    rows["collects"] = [
        Collect(
            id=item["id"],
            owner_id=item["owner_id"],
            target_type=item["target_type"],
            target_id=item["target_id"],
            created_at=parse_dt(item.get("created_at")) or datetime.now(),
        )
        for item in data.get("collects", [])
    ]

    rows["shopping_items"] = [
        ShoppingItem(
            id=item["id"],
            owner_id=item["owner_id"],
            name=item["name"],
            dosage=item.get("dosage") or "",
            source_recipe_id=item.get("source_recipe_id"),
            source_recipe_name=item.get("source_recipe_name") or "",
            checked=bool(item.get("checked")),
            created_at=parse_dt(item.get("created_at")) or datetime.now(),
        )
        for item in data.get("shopping_items", [])
    ]

    rows["follows"] = [
        Follow(
            id=item["id"],
            owner_id=item["owner_id"],
            target_uid=item["target_uid"],
            created_at=parse_dt(item.get("created_at")) or datetime.now(),
        )
        for item in data.get("follows", [])
    ]

    rows["reports"] = [
        Report(
            id=item["id"],
            reporter_id=item.get("owner_id") or item.get("reporter_id") or "",
            reporter_name=item.get("reporter_name") or "",
            target_type=item.get("target_type") or "",
            target_id=item.get("target_id") or 0,
            target_owner_id=item.get("target_owner_id") or "",
            target_title=item.get("target_title") or "",
            reason=item.get("reason") or "",
            detail=item.get("detail") or "",
            status=item.get("status") or 0,
            result=item.get("result"),
            handle_remark=item.get("handle_remark") or "",
            handled_by=item.get("handled_by") or "",
            handled_at=parse_dt(item.get("handled_at")),
            created_at=parse_dt(item.get("created_at")) or datetime.now(),
        )
        for item in data.get("reports", [])
    ]

    rows["notices"] = [
        Notice(
            id=item["id"],
            title=item["title"],
            content=item.get("content") or "",
            is_active=bool(item.get("is_active", True)),
            created_at=parse_dt(item.get("created_at")) or datetime.now(),
        )
        for item in data.get("notices", [])
    ]

    rows["sensitive_words"] = [
        SensitiveWord(
            id=item["id"],
            word=item["word"],
            level=item.get("level") or 1,
            created_at=parse_dt(item.get("created_at")) or datetime.now(),
        )
        for item in data.get("sensitive_words", [])
    ]

    rows["app_config"] = [
        AppConfig(
            config_key=item["config_key"],
            config_value=item.get("config_value") or "",
            remark=item.get("remark") or "",
            updated_at=parse_dt(item.get("updated_at")) or datetime.now(),
        )
        for item in data.get("app_config", [])
    ]

    rows["app_admins"] = [
        AppAdmin(uid=item["uid"], name=item.get("name") or "审核员", created_at=parse_dt(item.get("created_at")) or datetime.now())
        for item in data.get("app_admins", [])
    ]

    return rows


def collect_users(data: dict) -> list[User]:
    """从内容作者里反推用户表，封禁状态取 user_ban。"""
    banned = {item["uid"]: item.get("reason") or "违规" for item in data.get("user_ban", [])}
    seen: dict[str, str] = {}
    for key in ("recipes", "posts", "comments"):
        for item in data.get(key, []):
            uid = item.get("owner_id") or ""
            if not uid or uid == "official":
                continue
            seen[uid] = item.get("owner_name") or seen.get(uid) or "美食爱好者"
    for uid, name in banned.items():
        seen.setdefault(uid, "美食爱好者")
    users = []
    for uid, name in seen.items():
        users.append(
            User(
                uid=uid,
                nickname=name,
                status=1 if uid in banned else 0,
                ban_reason=banned.get(uid, ""),
                ban_at=datetime.now() if uid in banned else None,
            )
        )
    return users


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default="migration/cloud-dump.json")
    parser.add_argument("--merge", action="store_true", help="只补缺失，不清理旧数据")
    args = parser.parse_args()

    path = Path(args.file)
    if not path.is_absolute():
        path = Path.cwd() / path
    data = json.loads(path.read_text(encoding="utf-8"))

    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if not args.merge:
            for table_name, _model in BUSINESS_TABLES:
                db.execute(_model.__table__.delete())
            db.commit()
            print("已清空业务表（后台账号与日志保留）")

        rows = build_rows(data)
        order = [
            "recipes",
            "recipe_materials",
            "recipe_steps",
            "posts",
            "comments",
            "likes",
            "collects",
            "shopping_items",
            "follows",
            "reports",
            "notices",
            "sensitive_words",
            "app_config",
            "app_admins",
        ]
        for key in order:
            items = rows.get(key, [])
            if not items:
                print(f"{key:18s} 0")
                continue
            if args.merge:
                existing = {row[0] for row in db.query(_primary_key_model(key)).all()}
                items = [item for item in items if getattr(item, _pk_field(key)) not in existing]
            db.add_all(items)
            db.commit()
            print(f"{key:18s} {len(items)}")

        if db.query(AppConfig).filter(AppConfig.config_key == "initialized").first() is None:
            db.add(AppConfig(config_key="initialized", config_value="1", remark="初始化标记：已从托管云导入"))
            db.commit()

        users = collect_users(data)
        if users:
            for user in users:
                if db.get(User, user.uid) is None:
                    db.add(user)
            db.commit()
            print(f"{'users':18s} {len(users)}")

        print("\n导入完成。库：", os.environ.get("DATABASE_URL", "sqlite:///./admin_dev.db"))
        print("菜谱", db.query(Recipe).count(), "· 帖子", db.query(Post).count(), "· 用户", db.query(User).count())
    finally:
        db.close()


_KEY_MODEL = {
    "recipes": Recipe,
    "recipe_materials": RecipeMaterial,
    "recipe_steps": RecipeStep,
    "posts": Post,
    "comments": Comment,
    "likes": Like,
    "collects": Collect,
    "shopping_items": ShoppingItem,
    "follows": Follow,
    "reports": Report,
    "notices": Notice,
    "sensitive_words": SensitiveWord,
    "app_admins": AppAdmin,
}


def _primary_key_model(key: str):
    model = _KEY_MODEL[key]
    return getattr(model, "id" if key != "app_admins" else "uid")


def _pk_field(key: str) -> str:
    return "uid" if key == "app_admins" else "id"


if __name__ == "__main__":
    main()
