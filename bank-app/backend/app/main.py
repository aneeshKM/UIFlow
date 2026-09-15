from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import models so SQLAlchemy registers the tables.
from app import models
from app.api.accounts import router as accounts_router
from app.api.admin import router as admin_router
from app.api.members import router as members_router
from app.db.database import Base, engine
from app.db.seed import seed_database


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create database tables.
    Base.metadata.create_all(
        bind=engine,
    )

    # Add our fake banking data.
    seed_database()

    yield


app = FastAPI(
    title="Northstar Credit Union API",
    version="1.0.0",
    lifespan=lifespan,
)


# Allow our React development server to call FastAPI.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(
    members_router,
)

app.include_router(
    accounts_router,
)

app.include_router(
    admin_router,
)


@app.get("/")
def root():
    return {
        "message": "Northstar Credit Union API"
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy"
    }
