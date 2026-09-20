from fastapi import FastAPI

from app.database import Base, engine
from app.models.user import User
from app.routers import users, auth


Base.metadata.create_all(bind=engine)


app = FastAPI(
    title="Multilingual Guide API",
    version="1.0.0"
)

app.include_router(users.router)
app.include_router(auth.router)


@app.get("/")
def root():
    return {
        "message": "Multilingual Guide API is running"
    }