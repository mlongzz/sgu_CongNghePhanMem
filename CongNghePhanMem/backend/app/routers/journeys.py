from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.admin import Journey
from app.routers.admin import journey_value, journey_values, required

router = APIRouter(prefix="/journeys", tags=["Journeys"])


@router.get("")
def journeys(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0), db: Session = Depends(get_db)):
    rows = db.query(Journey).order_by(Journey.id).offset(offset).limit(limit).all()
    return journey_values(db, rows, public_only=True)


@router.get("/{identifier}")
def journey(identifier: int, db: Session = Depends(get_db)):
    return journey_value(db, required(db, Journey, identifier), public_only=True)
