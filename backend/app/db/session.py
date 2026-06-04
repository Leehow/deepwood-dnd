from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.core.config import settings

# Create async engine with connection pool tuning
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
)

# Create async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

# Base class for models
Base = declarative_base()

# Alias for backward compatibility and direct usage
async_session_factory = async_session_maker


async def get_db() -> AsyncSession:
    """Dependency for getting async database sessions"""
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def get_db_readonly() -> AsyncSession:
    """Read-only dependency - skips commit for GET requests (faster)"""
    async with async_session_maker() as session:
        try:
            yield session
        finally:
            await session.close()
