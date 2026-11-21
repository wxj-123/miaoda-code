from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def now():
    return datetime.now()


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(64))
    permissions: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Admin(Base):
    __tablename__ = "admins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(64), default="")
    role_code: Mapped[str] = mapped_column(String(32), default="auditor")
    status: Mapped[int] = mapped_column(Integer, default=0)  # 0 正常 1 停用
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class OperationLog(Base):
    __tablename__ = "operation_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    admin_id: Mapped[int] = mapped_column(Integer, default=0)
    admin_name: Mapped[str] = mapped_column(String(64), default="")
    action: Mapped[str] = mapped_column(String(64), default="")
    target: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class User(Base):
    __tablename__ = "users"

    uid: Mapped[str] = mapped_column(String(64), primary_key=True)
    nickname: Mapped[str] = mapped_column(String(64), default="")
    email: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[int] = mapped_column(Integer, default=0)  # 0 正常 1 封禁
    ban_reason: Mapped[str] = mapped_column(String(255), default="")
    ban_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Recipe(Base):
    __tablename__ = "recipes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), default="")
    owner_name: Mapped[str] = mapped_column(String(64), default="")
    name: Mapped[str] = mapped_column(String(64))
    cuisine: Mapped[str] = mapped_column(String(32), default="")
    region: Mapped[str] = mapped_column(String(32), default="")
    cover_img: Mapped[str] = mapped_column(String(500), default="")
    taste: Mapped[str] = mapped_column(String(32), default="")
    difficulty: Mapped[str] = mapped_column(String(16), default="简单")
    cost_time: Mapped[int] = mapped_column(Integer, default=30)
    fit_takeaway: Mapped[bool] = mapped_column(Boolean, default=False)
    fit_quick: Mapped[bool] = mapped_column(Boolean, default=False)
    meal_type: Mapped[str] = mapped_column(String(16), default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    audit_status: Mapped[int] = mapped_column(Integer, default=1, index=True)
    reject_reason: Mapped[str] = mapped_column(String(255), default="")
    is_top: Mapped[bool] = mapped_column(Boolean, default=False)
    weight: Mapped[int] = mapped_column(Integer, default=0)
    like_count: Mapped[int] = mapped_column(Integer, default=0)
    collect_count: Mapped[int] = mapped_column(Integer, default=0)
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    is_official: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class RecipeMaterial(Base):
    __tablename__ = "recipe_materials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(Integer, index=True)
    name: Mapped[str] = mapped_column(String(64))
    dosage: Mapped[str] = mapped_column(String(64), default="")
    sort: Mapped[int] = mapped_column(Integer, default=0)


class RecipeStep(Base):
    __tablename__ = "recipe_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    recipe_id: Mapped[int] = mapped_column(Integer, index=True)
    sort: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text)
    img_url: Mapped[str] = mapped_column(String(500), default="")


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), default="")
    owner_name: Mapped[str] = mapped_column(String(64), default="")
    post_type: Mapped[str] = mapped_column(String(16), default="normal")
    title: Mapped[str] = mapped_column(String(120))
    content: Mapped[str] = mapped_column(Text, default="")
    media: Mapped[list] = mapped_column(JSON, default=list)
    video_url: Mapped[str] = mapped_column(String(500), default="")
    rel_recipe_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    audit_status: Mapped[int] = mapped_column(Integer, default=1, index=True)
    reject_reason: Mapped[str] = mapped_column(String(255), default="")
    is_top: Mapped[bool] = mapped_column(Boolean, default=False)
    like_count: Mapped[int] = mapped_column(Integer, default=0)
    collect_count: Mapped[int] = mapped_column(Integer, default=0)
    view_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Comment(Base):
    __tablename__ = "comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), default="")
    owner_name: Mapped[str] = mapped_column(String(64), default="")
    target_type: Mapped[str] = mapped_column(String(16), default="recipe")
    target_id: Mapped[int] = mapped_column(Integer, default=0)
    content: Mapped[str] = mapped_column(Text)
    parent_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    like_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    reporter_id: Mapped[str] = mapped_column(String(64), default="")
    reporter_name: Mapped[str] = mapped_column(String(64), default="")
    target_type: Mapped[str] = mapped_column(String(16), default="")
    target_id: Mapped[int] = mapped_column(Integer, default=0)
    target_owner_id: Mapped[str] = mapped_column(String(64), default="")
    target_title: Mapped[str] = mapped_column(String(200), default="")
    reason: Mapped[str] = mapped_column(String(32), default="")
    detail: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[int] = mapped_column(Integer, default=0, index=True)
    result: Mapped[int | None] = mapped_column(Integer, nullable=True)
    handle_remark: Mapped[str] = mapped_column(String(255), default="")
    handled_by: Mapped[str] = mapped_column(String(64), default="")
    handled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Notice(Base):
    __tablename__ = "notices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    content: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class SensitiveWord(Base):
    __tablename__ = "sensitive_words"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    word: Mapped[str] = mapped_column(String(64), unique=True)
    level: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


# ---------------- 以下为小程序业务表（与托管云同名同构） ----------------


class Like(Base):
    __tablename__ = "likes"
    __table_args__ = (UniqueConstraint("owner_id", "target_type", "target_id", name="uq_like_once"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str] = mapped_column(String(16))
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Collect(Base):
    __tablename__ = "collects"
    __table_args__ = (UniqueConstraint("owner_id", "target_type", "target_id", name="uq_collect_once"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), index=True)
    target_type: Mapped[str] = mapped_column(String(16))
    target_id: Mapped[int] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class ShoppingItem(Base):
    __tablename__ = "shopping_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(64))
    dosage: Mapped[str] = mapped_column(String(64), default="")
    source_recipe_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_recipe_name: Mapped[str] = mapped_column(String(64), default="")
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("owner_id", "target_uid", name="uq_follow_once"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), index=True)
    target_uid: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AppConfig(Base):
    __tablename__ = "app_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    config_key: Mapped[str] = mapped_column(String(64), unique=True)
    config_value: Mapped[str] = mapped_column(Text, default="")
    remark: Mapped[str] = mapped_column(String(255), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AppAdmin(Base):
    """小程序内的审核员（与后台 admins 是两套身份，互不影响）"""

    __tablename__ = "app_admins"

    uid: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AuditRecord(Base):
    """自动审核流水：每次提交/修改都留一条，申诉时用来对照"当时为什么判"。"""

    __tablename__ = "audit_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_type: Mapped[str] = mapped_column(String(16), default="post", index=True)
    target_id: Mapped[int] = mapped_column(Integer, default=0, index=True)
    owner_id: Mapped[str] = mapped_column(String(64), default="")
    decision: Mapped[str] = mapped_column(String(16), default="pass")  # pass / review / reject
    score: Mapped[int] = mapped_column(Integer, default=0)
    code: Mapped[str] = mapped_column(String(32), default="OK")
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    hits: Mapped[list] = mapped_column(JSON, default=list)
    engine: Mapped[str] = mapped_column(String(32), default="rule-v1")
    source: Mapped[str] = mapped_column(String(16), default="auto")  # auto / edit / appeal
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)


class Appeal(Base):
    """内容申诉单。

    status: 0 待处理 / 1 申诉通过（内容恢复上线）/ 2 维持驳回
    auto:   是否由自动审核直接裁决（用户改了内容重新提交时会发生）
    """

    __tablename__ = "content_appeals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    target_type: Mapped[str] = mapped_column(String(16), default="post", index=True)
    target_id: Mapped[int] = mapped_column(Integer, default=0, index=True)
    owner_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    owner_name: Mapped[str] = mapped_column(String(64), default="")
    title: Mapped[str] = mapped_column(String(120), default="")

    reason: Mapped[str] = mapped_column(Text, default="")  # 用户申诉说明
    reject_reason: Mapped[str] = mapped_column(String(255), default="")  # 驳回时的理由快照
    content: Mapped[dict] = mapped_column(JSON, default=dict)  # 提交申诉时用户改后的内容

    status: Mapped[int] = mapped_column(Integer, default=0, index=True)
    rounds: Mapped[int] = mapped_column(Integer, default=1)  # 第几次申诉
    auto: Mapped[bool] = mapped_column(Boolean, default=False)
    reply: Mapped[str] = mapped_column(String(255), default="")
    handled_by: Mapped[str] = mapped_column(String(64), default="")
    handled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
