from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_admin, log_action, permissions_of
from ..models import Admin, Role
from ..security import create_token, hash_password, verify_password
from ..serializers import admin_brief

router = APIRouter(prefix="/api/auth", tags=["登录"])


class LoginBody(BaseModel):
    username: str
    password: str


class PasswordBody(BaseModel):
    old_password: str
    new_password: str


@router.post("/login")
def login(body: LoginBody, request: Request, db: Session = Depends(get_db)):
    admin = db.query(Admin).filter(Admin.username == body.username.strip()).first()
    if not admin or not verify_password(body.password, admin.password_hash):
        raise HTTPException(status_code=400, detail="账号或密码不正确")
    if admin.status != 0:
        raise HTTPException(status_code=403, detail="该账号已停用，请联系超级管理员")
    admin.last_login_at = datetime.now()
    log_action(db, admin, "登录", "后台", "登录成功", request)
    db.commit()
    role = db.query(Role).filter(Role.code == admin.role_code).first()
    return {
        "token": create_token(admin.id, admin.username),
        "admin": admin_brief(admin),
        "role_name": role.name if role else admin.role_code,
        "permissions": permissions_of(db, admin),
    }


@router.get("/me")
def me(admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)):
    role = db.query(Role).filter(Role.code == admin.role_code).first()
    return {
        "admin": admin_brief(admin),
        "role_name": role.name if role else admin.role_code,
        "permissions": permissions_of(db, admin),
    }


@router.post("/password")
def change_password(
    body: PasswordBody,
    request: Request,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not verify_password(body.old_password, admin.password_hash):
        raise HTTPException(status_code=400, detail="原密码不正确")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="新密码至少 8 位")
    admin.password_hash = hash_password(body.new_password)
    log_action(db, admin, "修改密码", "账号", admin.username, request)
    db.commit()
    return {"ok": True}
