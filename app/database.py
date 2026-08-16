from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=False,           # disable SQL logging (too noisy, hurts performance)
    pool_pre_ping=True,   # detect stale connections (important for Neon's serverless)
    pool_size=5,          # max persistent connections
    max_overflow=10,      # extra connections allowed under burst load
    pool_timeout=30,      # seconds to wait for a free connection
    pool_recycle=1800,    # recycle connections every 30 min (avoids Neon idle timeouts)
    # Fail fast on hung Neon connects & force unnamed prepared statements for PgBouncer / Vercel
    connect_args={
        "timeout": 20,
        "command_timeout": 60,
        "prepared_statement_name_func": lambda: "",
        "prepared_statement_cache_size": 0,
        "statement_cache_size": 0,
    },
)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
