from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from pathlib import Path

from ..db import get_db
from ..deps import log_action, require_perm
from ..models import Admin, AppConfig, Notice, OperationLog, Role, SensitiveWord
from ..security import hash_password
from ..serializers import admin_brief, notice_brief, word_brief

import json

router = APIRouter(prefix="/api", tags=["系统配置"])

# 服务端默认品牌池（与小程序 utils/drinks.js 保持一致）
DRINKS_DEFAULT_FILE = Path(__file__).resolve().parent.parent / "data" / "drinks.default.json"


# ---------------- 今日想喝品牌池 ----------------


class DrinksBody(BaseModel):
    brands: list[dict]


@router.get("/drinks")
def get_drinks(db: Session = Depends(get_db), _=Depends(require_perm("notice:manage"))):
    row = db.query(AppConfig).filter(AppConfig.config_key == "drinks").first()
    if row is None or not row.config_value:
        return {"brands": []}
    try:
        brands = json.loads(row.config_value)
    except Exception:
        brands = []
    return {"brands": brands if isinstance(brands, list) else []}


@router.put("/drinks")
def save_drinks(
    body: DrinksBody,
    request: Request,
    admin: Admin = Depends(require_perm("notice:manage")),
    db: Session = Depends(get_db),
):
    brands = body.brands or []
    # 只保留五个字段，其余丢弃，防止脏数据进库
    clean = []
    for item in brands:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        clean.append(
            {
                "name": name,
                "kind": str(item.get("kind") or "奶茶").strip()[:16],
                "star": str(item.get("star") or "").strip()[:64],
                "price": str(item.get("price") or "").strip()[:32],
                "note": str(item.get("note") or "").strip()[:128],
            }
        )
    if not clean:
        raise HTTPException(status_code=400, detail="品牌列表不能为空")

    row = db.query(AppConfig).filter(AppConfig.config_key == "drinks").first()
    if row is None:
        row = AppConfig(config_key="drinks", remark="今日想喝品牌池")
        db.add(row)
    row.config_value = json.dumps(clean, ensure_ascii=False)
    log_action(db, admin, "保存品牌池", "系统配置", f"共 {len(clean)} 家品牌", request)
    db.commit()
    return {"ok": True, "count": len(clean)}


@router.post("/drinks/reset")
def reset_drinks(
    request: Request,
    admin: Admin = Depends(require_perm("notice:manage")),
    db: Session = Depends(get_db),
):
    """把品牌池恢复成服务端内置默认（50 家），用于改乱后一键回滚。"""
    if not DRINKS_DEFAULT_FILE.exists():
        raise HTTPException(status_code=500, detail="默认品牌数据文件不存在")
    try:
        brands = json.loads(DRINKS_DEFAULT_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"默认品牌数据读取失败: {exc}")
    if not isinstance(brands, list) or not brands:
        raise HTTPException(status_code=500, detail="默认品牌数据为空")

    row = db.query(AppConfig).filter(AppConfig.config_key == "drinks").first()
    if row is None:
        row = AppConfig(config_key="drinks", remark="今日想喝品牌池")
        db.add(row)
    row.config_value = json.dumps(brands, ensure_ascii=False)
    log_action(db, admin, "恢复默认品牌池", "系统配置", f"恢复 {len(brands)} 家", request)
    db.commit()
    return {"ok": True, "count": len(brands), "brands": brands}


# ---------------- 公告 ----------------


class NoticeBody(BaseModel):
    title: str
    content: str = ""
    is_active: bool = True


@router.get("/notices")
def list_notices(db: Session = Depends(get_db), _=Depends(require_perm("notice:manage"))):
    rows = db.query(Notice).order_by(Notice.created_at.desc()).all()
    return {"total": len(rows), "list": [notice_brief(row) for row in rows]}


@router.post("/notices")
def create_notice(
    body: NoticeBody,
    request: Request,
    admin: Admin = Depends(require_perm("notice:manage")),
    db: Session = Depends(get_db),
):
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="公告标题不能为空")
    row = Notice(title=body.title.strip(), content=body.content.strip(), is_active=body.is_active)
    db.add(row)
    log_action(db, admin, "发布公告", "公告", row.title, request)
    db.commit()
    return {"ok": True, "id": row.id}


@router.put("/notices/{notice_id}")
def update_notice(
    notice_id: int,
    body: NoticeBody,
    request: Request,
    admin: Admin = Depends(require_perm("notice:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Notice, notice_id)
    if not row:
        raise HTTPException(status_code=404, detail="公告不存在")
    row.title = body.title.strip()
    row.content = body.content.strip()
    row.is_active = body.is_active
    log_action(db, admin, "编辑公告", f"公告#{notice_id}", row.title, request)
    db.commit()
    return {"ok": True}


@router.delete("/notices/{notice_id}")
def delete_notice(
    notice_id: int,
    request: Request,
    admin: Admin = Depends(require_perm("notice:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Notice, notice_id)
    if not row:
        raise HTTPException(status_code=404, detail="公告不存在")
    db.delete(row)
    log_action(db, admin, "删除公告", f"公告#{notice_id}", row.title, request)
    db.commit()
    return {"ok": True}


# ---------------- 敏感词 ----------------


class WordBody(BaseModel):
    word: str
    level: int = 1


class WordImportBody(BaseModel):
    text: str


@router.get("/words")
def list_words(db: Session = Depends(get_db), _=Depends(require_perm("word:manage"))):
    rows = db.query(SensitiveWord).order_by(SensitiveWord.created_at.desc()).all()
    return {"total": len(rows), "list": [word_brief(row) for row in rows]}


@router.post("/words")
def add_word(
    body: WordBody,
    request: Request,
    admin: Admin = Depends(require_perm("word:manage")),
    db: Session = Depends(get_db),
):
    word = body.word.strip()
    if not word:
        raise HTTPException(status_code=400, detail="敏感词不能为空")
    if db.query(SensitiveWord).filter(SensitiveWord.word == word).first():
        raise HTTPException(status_code=400, detail="这个词已经在词库里了")
    row = SensitiveWord(word=word, level=body.level)
    db.add(row)
    log_action(db, admin, "新增敏感词", "词库", word, request)
    db.commit()
    return {"ok": True}


@router.post("/words/import")
def import_words(
    body: WordImportBody,
    request: Request,
    admin: Admin = Depends(require_perm("word:manage")),
    db: Session = Depends(get_db),
):
    words = [item.strip() for item in body.text.replace("，", ",").replace("\n", ",").split(",")]
    words = [word for word in words if word]
    if not words:
        raise HTTPException(status_code=400, detail="没有解析到有效的词")
    existing = {row.word for row in db.query(SensitiveWord).all()}
    added = 0
    for word in words:
        if word in existing:
            continue
        db.add(SensitiveWord(word=word))
        added += 1
    log_action(db, admin, "批量导入敏感词", "词库", f"共 {added} 个", request)
    db.commit()
    return {"ok": True, "added": added, "skipped": len(words) - added}


@router.delete("/words/{word_id}")
def delete_word(
    word_id: int,
    request: Request,
    admin: Admin = Depends(require_perm("word:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(SensitiveWord, word_id)
    if not row:
        raise HTTPException(status_code=404, detail="词条不存在")
    db.delete(row)
    log_action(db, admin, "删除敏感词", "词库", row.word, request)
    db.commit()
    return {"ok": True}


# ---------------- 账号与角色 ----------------


class AdminBody(BaseModel):
    username: str
    password: str = ""
    name: str = ""
    role_code: str = "auditor"
    status: int = 0


@router.get("/roles")
def list_roles(db: Session = Depends(get_db), _=Depends(require_perm("admin:manage"))):
    rows = db.query(Role).order_by(Role.id.asc()).all()
    return [{"code": row.code, "name": row.name, "permissions": row.permissions} for row in rows]


@router.get("/admins")
def list_admins(db: Session = Depends(get_db), _=Depends(require_perm("admin:manage"))):
    rows = db.query(Admin).order_by(Admin.id.asc()).all()
    return {"total": len(rows), "list": [admin_brief(row) for row in rows]}


@router.post("/admins")
def create_admin(
    body: AdminBody,
    request: Request,
    admin: Admin = Depends(require_perm("admin:manage")),
    db: Session = Depends(get_db),
):
    username = body.username.strip()
    if len(username) < 3:
        raise HTTPException(status_code=400, detail="账号至少 3 位")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="密码至少 8 位")
    if db.query(Admin).filter(Admin.username == username).first():
        raise HTTPException(status_code=400, detail="账号已存在")
    row = Admin(
        username=username,
        password_hash=hash_password(body.password),
        name=body.name.strip() or username,
        role_code=body.role_code,
        status=body.status,
    )
    db.add(row)
    log_action(db, admin, "新增后台账号", "账号", f"{username}｜{body.role_code}", request)
    db.commit()
    return {"ok": True, "id": row.id}


@router.put("/admins/{admin_id}")
def update_admin(
    admin_id: int,
    body: AdminBody,
    request: Request,
    admin: Admin = Depends(require_perm("admin:manage")),
    db: Session = Depends(get_db),
):
    row = db.get(Admin, admin_id)
    if not row:
        raise HTTPException(status_code=404, detail="账号不存在")
    if body.name.strip():
        row.name = body.name.strip()
    row.role_code = body.role_code
    row.status = body.status
    if body.password:
        if len(body.password) < 8:
            raise HTTPException(status_code=400, detail="密码至少 8 位")
        row.password_hash = hash_password(body.password)
    log_action(db, admin, "编辑后台账号", f"账号#{admin_id}", f"{row.username}｜{row.role_code}", request)
    db.commit()
    return {"ok": True}


@router.delete("/admins/{admin_id}")
def delete_admin(
    admin_id: int,
    request: Request,
    admin: Admin = Depends(require_perm("admin:manage")),
    db: Session = Depends(get_db),
):
    if admin.id == admin_id:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    row = db.get(Admin, admin_id)
    if not row:
        raise HTTPException(status_code=404, detail="账号不存在")
    db.delete(row)
    log_action(db, admin, "删除后台账号", f"账号#{admin_id}", row.username, request)
    db.commit()
    return {"ok": True}


# ---------------- 操作日志 ----------------


@router.get("/logs")
def list_logs(
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _=Depends(require_perm("admin:manage")),
):
    query = db.query(OperationLog)
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
                "ip": row.ip,
                "created_at": row.created_at.strftime("%Y-%m-%d %H:%M"),
            }
            for row in rows
        ],
    }
