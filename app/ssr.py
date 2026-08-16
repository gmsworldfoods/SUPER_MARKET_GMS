"""Server-Side Rendering (SSR) helper module for FastAPI.

Pre-injects server-warmed metadata, promotion banners, site settings, and
product catalog state directly into HTML pages on response stream.
This eliminates client-side network roundtrips for initial page rendering.
"""

import json
import logging
from pathlib import Path

from starlette.responses import HTMLResponse

from app.database import AsyncSessionLocal
from app.routers.catalog import _load_active_products, _load_catalog_metadata

logger = logging.getLogger(__name__)

# In-memory HTML template cache to avoid repeated disk reads
_HTML_CACHE: dict[str, str] = {}


def _get_html_template(file_path: Path) -> str:
    path_str = str(file_path)
    if path_str not in _HTML_CACHE:
        _HTML_CACHE[path_str] = file_path.read_text(encoding="utf-8")
    return _HTML_CACHE[path_str]


def clear_html_cache() -> None:
    """Flush in-memory template cache if needed during hot reloads."""
    _HTML_CACHE.clear()


async def render_ssr_page(file_path: Path, page_type: str = "general") -> HTMLResponse:
    """Render HTML document pre-loaded with initial SSR data."""
    if not file_path.is_file():
        return HTMLResponse(content="Page not found", status_code=404)

    html = _get_html_template(file_path)

    script_injections: list[str] = []
    try:
        async with AsyncSessionLocal() as db:
            metadata = await _load_catalog_metadata(db)
            script_injections.append(
                f"<script>window.__INITIAL_METADATA__ = {json.dumps(metadata)};</script>"
            )

            if page_type == "home":
                home_products = await _load_active_products(db, home_only=True)
                script_injections.append(
                    f"<script>window.__INITIAL_HOME_PRODUCTS__ = {json.dumps({'products': home_products})};</script>"
                )
            elif page_type == "products":
                all_products = await _load_active_products(db)
                script_injections.append(
                    f"<script>window.__INITIAL_PRODUCTS__ = {json.dumps({'products': all_products})};</script>"
                )
    except Exception as exc:
        logger.warning("SSR data pre-loading skipped (falling back to CSR): %s", exc)

    if script_injections:
        injection_html = "\n".join(script_injections)
        if "</head>" in html:
            html = html.replace("</head>", f"{injection_html}\n</head>", 1)
        else:
            html = injection_html + html

    return HTMLResponse(content=html)
