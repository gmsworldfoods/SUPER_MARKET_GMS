import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.core import warmup as startup_warmup
from app.database import AsyncSessionLocal
from app.paths import FRONTEND_DIR, PRODUCT_UPLOADS_DIR
from app.routers import admin, auth, cart, catalog, contact

settings = get_settings()
logger = logging.getLogger("gms")

HTML_PAGES = [
    "index.html",
    "products.html",
    "basket.html",
    "about.html",
    "contact.html",
    "login.html",
    "signup.html",
    "account.html",
]


async def _warmup_db() -> None:
    """Ensure auth schema exists and warm the DB pool."""
    from sqlalchemy import text
    from app.core.db_indexes import ensure_admin_account, ensure_required_site_schema, ensure_user_auth_schema

    async with AsyncSessionLocal() as db:
        await db.execute(text("SELECT 1"))
        await ensure_user_auth_schema(db)
        await ensure_required_site_schema(db)
        await ensure_admin_account(db)
    startup_warmup.mark_db_ready()
    logger.info("Database ready (auth schema + connection warmup).")


async def _warmup_catalog_cache() -> None:
    """Pre-populate home-page caches (non-fatal if Neon is still waking)."""
    try:
        from app.routers.catalog import (
            _load_active_cultures,
            _load_active_products,
            _load_catalog_metadata,
            _load_featured_testimonials,
        )

        async def warm(loader, *args, **kwargs):
            async with AsyncSessionLocal() as db:
                return await loader(db, *args, **kwargs)

        await asyncio.gather(
            warm(_load_catalog_metadata),
            warm(_load_active_products, home_only=True),
            warm(_load_active_cultures),
            warm(_load_featured_testimonials),
        )
        logger.info("Home-page caches warmed up on startup.")
    except Exception as exc:
        logger.warning("Startup cache warmup failed (will retry on first request): %s", exc)


async def _warmup_admin_cache() -> None:
    """Pre-populate admin API caches so the portal feels instant on first click."""
    try:
        from app.core.db_indexes import ensure_performance_indexes
        from app.routers.admin import warm_admin_cache
        async with AsyncSessionLocal() as db:
            await ensure_performance_indexes(db)
        async with AsyncSessionLocal() as db:
            await warm_admin_cache(db)
        logger.info("Admin cache warmed up on startup.")
    except Exception as exc:
        logger.warning("Admin cache warmup failed (will retry on first request): %s", exc)


async def _run_startup_warmup() -> None:
    """DB + cache warmup."""
    try:
        await _warmup_db()
        await _warmup_catalog_cache()
        await _warmup_admin_cache()
        startup_warmup.mark_warmup_complete()
        logger.info("Background startup warmup complete.")
    except Exception as exc:
        startup_warmup.mark_warmup_complete(error=str(exc))
        logger.warning("Startup warmup error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Bind and accept browsers immediately. HTML/CSS/JS do not need the DB.
    # Previously we awaited Neon + cache here, so the port stayed closed and
    # Firefox showed "Unable to connect" until the user clicked Try Again.
    task = asyncio.create_task(_run_startup_warmup(), name="gms-startup-warmup")
    app.state.warmup_task = task
    try:
        yield
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(
    title="GMS World Foods API",
    description="REST API for GMS World Foods supermarket e-commerce",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(GZipMiddleware, minimum_size=1000)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def catalog_browser_cache(request: Request, call_next):
    """Allow Edge CDN caching of public catalog GETs — instant site loads."""
    response = await call_next(request)
    path = request.url.path
    if request.method == "GET" and (path.startswith("/api/v1/catalog/") or path in ("/api/v1/banners", "/api/v1/cultures", "/api/v1/testimonials")):
        if "cart-products" not in path:
            response.headers["Cache-Control"] = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
    return response



app.include_router(catalog.router)
app.include_router(auth.router)
app.include_router(cart.router)
app.include_router(contact.router)
app.include_router(admin.router)


@app.get("/api/v1/health")
async def health():
    return {
        "status": "ok",
        "service": "gms-world-foods",
        **startup_warmup.warmup_payload(),
    }


@app.exception_handler(404)
async def not_found_handler(request: Request, exc):
    if request.url.path.startswith("/api/"):
        return JSONResponse(status_code=404, content={"detail": str(exc.detail) if hasattr(exc, "detail") else "Not found"})
    return JSONResponse(status_code=404, content={"detail": "Not found"})


@app.exception_handler(500)
async def server_error_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


for folder in ("css", "js", "assets"):
    path = FRONTEND_DIR / folder
    if path.exists():
        app.mount(f"/{folder}", StaticFiles(directory=str(path)), name=folder)

PRODUCT_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(PRODUCT_UPLOADS_DIR.parent)), name="uploads")


@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
async def serve_favicon():
    """Always expose the GMS logo as the browser tab icon."""
    ico = FRONTEND_DIR / "favicon.ico"
    if ico.is_file():
        return FileResponse(ico, media_type="image/x-icon")
    png = FRONTEND_DIR / "assets" / "favicon-32.png"
    return FileResponse(png, media_type="image/png")


@app.get("/admin")
@app.get("/admin.html")
async def serve_admin_tools():
    """Role-gated store management UI — same site as the storefront."""
    return FileResponse(FRONTEND_DIR / "admin.html")


for page in HTML_PAGES[1:]:
    route = f"/{page}"

    def make_handler(filename: str):
        async def handler():
            return FileResponse(FRONTEND_DIR / filename)

        return handler

    app.get(route)(make_handler(page))


@app.api_route(
    "/api/{api_path:path}",
    methods=["POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
async def api_unmatched(api_path: str):
    """Return 404 for unknown API mutations (avoids SPA catch-all 405)."""
    return JSONResponse(status_code=404, content={"detail": "Not found"})


@app.get("/{page_path:path}", include_in_schema=False)
async def spa_fallback(page_path: str):
    """Serve HTML pages without .html extension if file exists."""
    if page_path.startswith("api/"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    candidate = FRONTEND_DIR / page_path
    if candidate.is_file():
        return FileResponse(candidate)
    html_candidate = FRONTEND_DIR / f"{page_path}.html"
    if html_candidate.is_file():
        return FileResponse(html_candidate)
    return JSONResponse(status_code=404, content={"detail": "Not found"})
