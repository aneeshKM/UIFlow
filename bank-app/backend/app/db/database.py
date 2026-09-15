from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker


# Get backend directory.
BACKEND_DIR = Path(__file__).resolve().parents[2]

# Create path to SQLite database.
DATABASE_PATH = BACKEND_DIR / "data" / "bank.db"

DATABASE_URL = f"sqlite:///{DATABASE_PATH}"


# SQLite requires this option when used with FastAPI requests.
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)


# Every database request will get its own session.
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


# Dependency used by FastAPI routes.
def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()