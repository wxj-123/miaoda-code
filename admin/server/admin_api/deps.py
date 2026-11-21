from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import Admin, AppAdmin, OperationLog, Role, User
from .security import decode_token

bearer = HTTPBearer(auto_error=False)


def get_current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> Admin:
    if credentials is None:
        raise HTTPException(status_code=401, detail="请先登录")
    payload = decode_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    if payload.get("scope") == "user":
        raise HTTPException(status_code=403, detail="小程序用户令牌不能访问后台接口")
    admin = db.get(Admin, int(payload.get("sub", 0)))
    if not admin or admin.status != 0:
        raise HTTPException(status_code=401, detail="账号不存在或已停用")
    return admin


# ---------------- 小程序用户身份 ----------------


def _user_from_token(credentials: HTTPAuthorizationCredentials | None) -> tuple[str, str] | None:
    if credentials is None:
        return None
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("scope") != "user":
        return None
    uid = payload.get("sub") or ""
    if not uid:
        return None
    return uid, payload.get("name") or ""


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    parsed = _user_from_token(credentials)
    if parsed is None:
        raise HTTPException(status_code=401, detail="SIGN_IN_REQUIRED")
    uid, name = parsed
    user = db.get(User, uid)
    if user is None:
        user = User(uid=uid, nickname=name or "美食爱好者")
        db.add(user)
        db.commit()
        db.refresh(user)
    if user.status != 0:
        raise HTTPException(status_code=403, detail="USER_BANNED")
    return user


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User | None:
    parsed = _user_from_token(credentials)
    if parsed is None:
        return None
    return db.get(User, parsed[0])


def require_app_admin(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    exists = db.query(AppAdmin).filter(AppAdmin.uid == user.uid).first()
    if not exists:
        raise HTTPException(status_code=403, detail="NOT_ADMIN")
    return user


def permissions_of(db: Session, admin: Admin) -> list[str]:
    role = db.query(Role).filter(Role.code == admin.role_code).first()
    return list(role.permissions) if role else []


def require_perm(code: str):
    def checker(admin: Admin = Depends(get_current_admin), db: Session = Depends(get_db)) -> Admin:
        if code not in permissions_of(db, admin):
            raise HTTPException(status_code=403, detail="没有该操作权限")
        return admin

    return checker


def log_action(db: Session, admin: Admin, action: str, target: str = "", detail: str = "", request: Request | None = None):
    ip = ""
    if request is not None and request.client:
        ip = request.client.host or ""
    db.add(
        OperationLog(
            admin_id=admin.id,
            admin_name=admin.name or admin.username,
            action=action,
            target=target,
            detail=detail[:1500],
            ip=ip,
        )
    )


def log_app_action(
    db: Session,
    actor_uid: str,
    action: str,
    target: str = "",
    detail: str = "",
    request: Request | None = None,
):
    """小程序侧审核员操作留痕。

    operation_logs.admin_id 是整数（PC 后台账号 id），小程序 uid 是字符串，
    不能混用：这里记 admin_id=0，把 uid 写进 admin_name 和 detail。
    """
    ip = ""
    if request is not None and request.client:
        ip = request.client.host or ""
    db.add(
        OperationLog(
            admin_id=0,
            admin_name=f"小程序审核员[{actor_uid}]",
            action=action,
            target=target,
            detail=detail[:1500],
            ip=ip,
        )
    )
