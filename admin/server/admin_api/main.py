from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import settings
from .db import Base, SessionLocal, engine
from .routers import appeals, audit, auth, content, miniapp, reports, stats, system, users
from .seed import seed


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()
    yield


app = FastAPI(title=settings.APP_NAME, version="1.0.0", lifespan=lifespan)

origins = [item.strip() for item in settings.CORS_ORIGINS.split(",") if item.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


for router in (
    auth.router,
    stats.router,
    audit.router,
    reports.router,
    content.router,
    users.router,
    system.router,
    miniapp.router,
    appeals.router,
):
    app.include_router(router)


@app.get("/api/health")
def health():
    return {"ok": True, "env": settings.APP_ENV, "db": settings.DATABASE_URL.split("://")[0]}


# 小程序上传的图片/视频
uploads_dir = Path(settings.UPLOAD_DIR)
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

# 菜谱封面（与 web/public 共用一份，避免两处维护）
covers_dir = Path(__file__).resolve().parent.parent.parent / "web" / "public" / "covers"
if covers_dir.exists():
    app.mount("/covers", StaticFiles(directory=covers_dir), name="covers")

# 生产环境把前端构建产物放到 web/dist 即可同域访问
dist = Path(__file__).resolve().parent.parent.parent / "web" / "dist"
if dist.exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    dist_root = dist.resolve()

    @app.get("/{path:path}")
    def spa(path: str):
        # 防目录穿越：解析绝对路径后必须仍在 dist 内，否则一律回退首页。
        # 否则 /../../server/admin_dev.db 之类的请求会下载任意本地文件。
        if path:
            target = (dist / path).resolve()
            if target.is_file() and target.is_relative_to(dist_root):
                return FileResponse(target)
        return FileResponse(dist / "index.html")
