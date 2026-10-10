from fastapi import APIRouter, Depends

from app.dependencies import get_current_admin
from app.models.user import User

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/me")
def get_admin_status(current_user: User = Depends(get_current_admin)) -> dict[str, object]:
    """Expose the authenticated user's admin capability to the app UI."""
    return {"enabled": True, "user_id": current_user.id}
