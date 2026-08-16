from urllib.parse import quote
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.banner_order import ordered_active_banners
from app.core.kitchen_cultures import KITCHEN_CULTURES
from app.core.culture_order import ordered_active_cultures
from app.core.site_settings import load_public_site_settings
from app.core.catalog import (
    HIDDEN_CATEGORIES,
    _cache_get,
    _cache_set,
)
from app.core.helpers import (
    build_products_query,
    get_category_stats,
    get_subcategory_stats,
    paginate_meta,
    primary_image,
    product_to_dict,
)
from app.database import get_db
from app.models import Category, Product, ProductImage, SiteSetting, Subcategory, Testimonial
from app.schemas import (
    BannerOut,
    BootstrapOut,
    CatalogMetadataOut,
    CatalogProductsBulkOut,
    CategoryOut,
    CultureOut,
    KitchenCultureOut,
    ProductImageOut,
    ProductListResponse,
    ProductOut,
    SubcategoryOut,
    TestimonialOut,
)

router = APIRouter(prefix="/api/v1", tags=["catalog"])


def _default_banner_link(category_name: str) -> str:
    return f"products.html?category={quote(category_name, safe='')}"


def _build_promotion_banners(banner_rows, category_stats: list[dict]) -> list[dict]:
    category_names = [c["CategoryName"] for c in category_stats]
    banners = []
    for i, banner in enumerate(banner_rows):
        link = (banner.link_url or "").strip()
        if not link:
            link = (
                _default_banner_link(category_names[i])
                if i < len(category_names)
                else "products.html"
            )
        banners.append(
            {
                "imageUrl": banner.image_url,
                "linkUrl": link,
                "title": banner.title,
            }
        )
    return banners


async def _load_active_products(db: AsyncSession, *, home_only: bool = False) -> list[dict]:
    cache_key = "home_products" if home_only else "active_products"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    if home_only:
        all_cached = _cache_get("active_products")
        if all_cached is not None:
            home_products = [
                product for product in all_cached
                if any(product.get(flag) for flag in (
                    "isFeatured",
                    "isBestSeller",
                    "isNewArrival",
                    "isHotOffer",
                    "isExclusive",
                ))
            ]
            _cache_set(cache_key, home_products)
            return home_products

    home_filter = """
          AND (
              p.is_featured = true
              OR p.is_best_seller = true
              OR p.is_new_arrival = true
              OR p.is_hot_offer = true
              OR p.is_exclusive = true
          )
    """ if home_only else ""

    # Single JOIN query — replaces 4 separate ORM round-trips
    result = await db.execute(text(f"""
        SELECT
            p.product_id,
            p.product_name,
            p.weight_kg,
            p.unit_label,
            p.description,
            p.is_featured,
            p.is_best_seller,
            p.is_new_arrival,
            p.is_hot_offer,
            p.is_exclusive,
            p.discount_percent,
            p.selling_price,
            p.kitchen_culture,
            p.category_id,
            c.category_name,
            p.subcategory_id,
            COALESCE(s.subcategory_name, '')                AS subcategory_name,
            pi.image_url                                    AS primary_image_url
        FROM products p
        JOIN categories c ON c.category_id = p.category_id
        LEFT JOIN subcategories s ON s.subcategory_id = p.subcategory_id
        LEFT JOIN LATERAL (
            SELECT image_url
            FROM product_images
            WHERE product_id = p.product_id
            ORDER BY is_primary DESC, display_order ASC, id ASC
            LIMIT 1
        ) pi ON true
        WHERE p.is_active = true
        {home_filter}
        ORDER BY p.product_name
    """))

    products = []
    for row in result.fetchall():
        cat_name = row.category_name or ""
        if cat_name.lower() in HIDDEN_CATEGORIES:
            continue
        products.append({
            "productId": row.product_id,
            "categoryId": row.category_id,
            "categoryName": cat_name,
            "subCategoryId": row.subcategory_id or "",
            "subCategoryName": row.subcategory_name or "",
            "productName": row.product_name,
            "weightKG": float(row.weight_kg) if row.weight_kg is not None else None,
            "packType": row.unit_label or "",
            "productDescription": row.description or "",
            "primaryImageUrl": row.primary_image_url,
            "isFeatured": bool(row.is_featured),
            "isBestSeller": bool(row.is_best_seller),
            "isNewArrival": bool(row.is_new_arrival),
            "isHotOffer": bool(row.is_hot_offer),
            "isExclusive": bool(row.is_exclusive),
            "discountPercent": int(row.discount_percent or 0),
            "sellingPrice": float(row.selling_price) if row.selling_price is not None else 0.0,
            "kitchenCulture": row.kitchen_culture,
        })

    _cache_set(cache_key, products)
    return products


def _image_maps_from_products(products: list[dict]) -> tuple[dict[str, str], dict[str, str]]:
    by_id: dict[str, str] = {}
    home_by_id: dict[str, str] = {}
    for product in products:
        url = product.get("primaryImageUrl")
        if not url:
            continue
        pid = product.get("productId")
        if pid is None:
            continue
        key = str(pid)
        by_id[key] = url
        home_by_id[key] = url
    return by_id, home_by_id


async def _load_catalog_metadata(db: AsyncSession) -> dict:
    cached = _cache_get("catalog_metadata")
    if cached is not None:
        return cached

    cat_stats = await get_category_stats(db)
    sub_stats = await get_subcategory_stats(db)

    banner_rows = await ordered_active_banners(db)
    promo_banners = _build_promotion_banners(banner_rows, cat_stats)
    promo = [b["imageUrl"] for b in promo_banners]
    site_settings = await load_public_site_settings(db)
    cultures = [c.model_dump() for c in await _load_active_cultures(db)]
    testimonials = [t.model_dump() for t in await _load_featured_testimonials(db)]

    result = {
        "categoryStats": cat_stats,
        "subcategoryStats": sub_stats,
        "promotionBannerImages": promo,
        "promotionBanners": promo_banners,
        "siteSettings": site_settings,
        "cultures": cultures,
        "testimonials": testimonials,
    }
    _cache_set("catalog_metadata", result)
    return result


@router.get("/catalog/metadata", response_model=CatalogMetadataOut)
async def catalog_metadata(db: AsyncSession = Depends(get_db)):
    """Lightweight catalog metadata (no products) for fast page shell init."""
    return CatalogMetadataOut(**await _load_catalog_metadata(db))


@router.get("/catalog/products-bulk", response_model=CatalogProductsBulkOut)
async def catalog_products_bulk(db: AsyncSession = Depends(get_db)):
    """All active products for client-side filtering (no pagination count)."""
    return CatalogProductsBulkOut(products=await _load_active_products(db))


@router.get("/catalog/home-products", response_model=CatalogProductsBulkOut)
async def catalog_home_products(db: AsyncSession = Depends(get_db)):
    """Only products used by homepage strips, avoiding the full catalog payload."""
    return CatalogProductsBulkOut(products=await _load_active_products(db, home_only=True))


@router.get("/catalog/cart-products", response_model=CatalogProductsBulkOut)
async def catalog_cart_products(
    names: str = Query(..., description="Comma-separated product names in the basket"),
    db: AsyncSession = Depends(get_db),
):
    """Lightweight product payload for basket page — only items currently in the cart."""
    name_list = [n.strip() for n in names.split(",") if n.strip()]
    if not name_list:
        return CatalogProductsBulkOut(products=[])
    if len(name_list) > 100:
        raise HTTPException(status_code=400, detail="Too many product names requested")

    all_products = await _load_active_products(db)
    wanted = set(name_list)
    matched = [p for p in all_products if p.get("productName") in wanted]
    return CatalogProductsBulkOut(products=matched)


@router.get("/catalog/bootstrap", response_model=BootstrapOut)
async def catalog_bootstrap(db: AsyncSession = Depends(get_db)):
    """Single payload replacing all static data/*.js files for page init."""
    metadata = await _load_catalog_metadata(db)
    products = await _load_active_products(db)
    by_id, home_by_id = _image_maps_from_products(products)

    return BootstrapOut(
        categoryStats=metadata["categoryStats"],
        subcategoryStats=metadata["subcategoryStats"],
        products=products,
        productImageById=by_id,
        productHomeImageById=home_by_id,
        promotionBannerImages=metadata["promotionBannerImages"],
        promotionBanners=metadata["promotionBanners"],
        siteSettings=metadata["siteSettings"],
    )


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db)):
    stats = await get_category_stats(db)
    return stats


@router.get("/categories/{category_id}")
async def get_category(category_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Category).where(Category.category_id == category_id))
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    stats = await get_category_stats(db)
    match = next((s for s in stats if s["ProductCategoryID"] == category_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Category not found")
    return {**match, "description": cat.description}


@router.get("/subcategories", response_model=list[SubcategoryOut])
async def list_subcategories(
    category_id: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    return await get_subcategory_stats(db, category_id)


@router.get("/products", response_model=ProductListResponse)
async def list_products(
    category: str | None = None,
    subcategory: str | None = None,
    pack_type: str | None = Query(None, alias="pack_type"),
    min_price: float | None = None,
    max_price: float | None = None,
    search: str | None = None,
    sort_by: str = Query("name-asc"),
    page: int = Query(1, ge=1),
    per_page: int = Query(24, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
):
    base = build_products_query(
        category=category,
        subcategory=subcategory,
        pack_type=pack_type,
        min_price=min_price,
        max_price=max_price,
        search=search,
        sort_by=sort_by,
    )
    count_q = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_q)).scalar_one()

    offset = (page - 1) * per_page
    result = await db.execute(base.offset(offset).limit(per_page))
    items = [
        ProductOut(**product_to_dict(p, primary_image(p)))
        for p in result.scalars()
    ]
    meta = paginate_meta(total, page, per_page)
    return ProductListResponse(items=items, **meta)


@router.get("/products/featured", response_model=list[ProductOut])
async def featured_products(
    limit: int = Query(16, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await _flagged_products("featured", limit, db)


@router.get("/products/best-sellers", response_model=list[ProductOut])
async def best_sellers(
    limit: int = Query(16, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await _flagged_products("best-sellers", limit, db)


@router.get("/products/new-arrivals", response_model=list[ProductOut])
async def new_arrivals(
    limit: int = Query(16, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await _flagged_products("new-arrivals", limit, db)


@router.get("/products/hot-offers", response_model=list[ProductOut])
async def hot_offers(
    limit: int = Query(16, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await _flagged_products("hot-offers", limit, db)


@router.get("/products/exclusive", response_model=list[ProductOut])
async def exclusive_products(
    limit: int = Query(16, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    return await _flagged_products("exclusive", limit, db)


async def _flagged_products(flag: str, limit: int, db: AsyncSession) -> list[ProductOut]:
    q = build_products_query(flag=flag).limit(limit)
    result = await db.execute(q)
    return [ProductOut(**product_to_dict(p, primary_image(p))) for p in result.scalars()]


@router.get("/products/{product_id}", response_model=ProductOut)
async def get_product(product_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Product)
        .options(
            selectinload(Product.category),
            selectinload(Product.subcategory),
            selectinload(Product.images),
        )
        .where(Product.product_id == product_id)
    )
    product = result.scalar_one_or_none()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return ProductOut(**product_to_dict(product, primary_image(product)))


@router.get("/products/{product_id}/images", response_model=list[ProductImageOut])
async def get_product_images(product_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ProductImage)
        .where(ProductImage.product_id == product_id)
        .order_by(ProductImage.display_order)
    )
    images = result.scalars().all()
    if not images:
        exists = await db.execute(select(Product.product_id).where(Product.product_id == product_id))
        if not exists.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Product not found")
    return [
        ProductImageOut(
            id=img.id,
            product_id=img.product_id,
            image_url=img.image_url,
            alt_text=img.alt_text,
            is_primary=img.is_primary,
            display_order=img.display_order,
        )
        for img in images
    ]


@router.get("/kitchen-cultures", response_model=list[KitchenCultureOut])
async def list_kitchen_cultures():
    return [KitchenCultureOut(**c) for c in KITCHEN_CULTURES]


async def _load_active_cultures(db: AsyncSession) -> list[CultureOut]:
    cached = _cache_get("public_cultures")
    if cached is not None:
        return cached

    rows = await ordered_active_cultures(db)
    cultures = [
        CultureOut(
            id=b.id,
            title=b.title,
            image_url=b.image_url,
            link_url=b.link_url,
            display_order=b.display_order,
        )
        for b in rows
    ]
    _cache_set("public_cultures", cultures)
    return cultures


@router.get("/cultures", response_model=list[CultureOut])
async def list_cultures(db: AsyncSession = Depends(get_db)):
    return await _load_active_cultures(db)


@router.get("/banners", response_model=list[BannerOut])
async def list_banners(db: AsyncSession = Depends(get_db)):
    banner_rows = await ordered_active_banners(db)
    return [
        BannerOut(
            id=b.id,
            title=b.title,
            subtitle=b.subtitle,
            image_url=b.image_url,
            link_url=b.link_url,
            display_order=b.display_order,
        )
        for b in banner_rows
    ]


@router.get("/testimonials", response_model=list[TestimonialOut])
async def list_testimonials(db: AsyncSession = Depends(get_db)):
    return await _load_featured_testimonials(db)


async def _load_featured_testimonials(db: AsyncSession) -> list[TestimonialOut]:
    cached = _cache_get("public_testimonials")
    if cached is not None:
        return cached

    result = await db.execute(
        select(Testimonial)
        .where(Testimonial.is_featured.is_(True))
        .order_by(Testimonial.display_order)
    )
    testimonials = [
        TestimonialOut(
            initials=t.customer_initial or (t.customer_name[:2] if t.customer_name else "??"),
            name=t.customer_name,
            text=t.quote,
            rating=t.rating,
        )
        for t in result.scalars()
    ]
    _cache_set("public_testimonials", testimonials)
    return testimonials


@router.get("/coupons/active")
async def public_coupons(db: AsyncSession = Depends(get_db)):
    """Active coupon codes for basket validation (public catalog API)."""
    result = await db.execute(select(SiteSetting).where(SiteSetting.setting_key == "coupons"))
    setting = result.scalar_one_or_none()
    if not setting:
        return {}
    try:
        coupons = json.loads(setting.setting_value)
    except json.JSONDecodeError:
        return {}
    out = {}
    for c in coupons:
        if c.get("active", True):
            code = c["code"].upper()
            out[code] = {
                "type": c["type"],
                "value": c["value"],
                "minOrder": c.get("min", c.get("minOrder", 0)),
                "desc": c.get("desc", ""),
            }
    return out
