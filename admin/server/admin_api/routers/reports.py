from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import log_action, require_perm
from ..models import Admin, Comment, Post, Recipe, Report
from ..serializers import report_brief

router = APIRouter(prefix="/api/reports", tags=["举报工单"])


class HandleBody(BaseModel):
    violate: bool
    remark: str = ""


@router.get("")
def list_reports(
    status: int | None = None,
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
    _=Depends(require_perm("report:handle")),
):
    query = db.query(Report)
    if status in (0, 1):
        query = query.filter(Report.status == status)
    total = query.count()
    rows = (
        query.order_by(Report.status.asc(), Report.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {"total": total, "list": [report_brief(row) for row in rows]}


@router.post("/{report_id}/handle")
def handle(
    report_id: int,
    body: HandleBody,
    request: Request,
    admin: Admin = Depends(require_perm("report:handle")),
    db: Session = Depends(get_db),
):
    report = db.get(Report, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="工单不存在")
    if report.status == 1:
        raise HTTPException(status_code=400, detail="该工单已处理")

    remark = (body.remark or "").strip()
    if body.violate and not remark:
        raise HTTPException(status_code=400, detail="下架需要填写处理备注")

    report.status = 1
    report.result = 1 if body.violate else 0
    report.handle_remark = remark
    report.handled_by = admin.name or admin.username
    report.handled_at = datetime.now()

    if body.violate:
        if report.target_type == "recipe":
            row = db.get(Recipe, report.target_id)
            if row:
                row.audit_status = 3
                row.reject_reason = remark or "举报违规下架"
        elif report.target_type == "post":
            row = db.get(Post, report.target_id)
            if row:
                row.audit_status = 3
                row.reject_reason = remark or "举报违规下架"
        elif report.target_type == "comment":
            row = db.get(Comment, report.target_id)
            if row:
                db.delete(row)

    log_action(
        db,
        admin,
        "处理举报",
        f"工单#{report.id}",
        f"{report.target_type}#{report.target_id}｜{'违规下架' if body.violate else '判定合规'}｜{remark}",
        request,
    )
    db.commit()
    return {"ok": True}
