from fastapi import APIRouter, UploadFile, File, Depends
from sqlalchemy.orm import Session
from app.config.session import get_db
from app.identity_access import models as id_models
import uuid, os

router = APIRouter()

@router.post("/upload")
async def upload_template(employee_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):

    os.makedirs("uploads", exist_ok=True)
    filename = f"{uuid.uuid4()}_{file.filename}"
    path = f"uploads/{filename}"

    with open(path, "wb") as f:
        f.write(await file.read())

    tpl = id_models.FacialTemplate(
        id=str(uuid.uuid4()),
        employee_id=employee_id,
        template_data=path
    )

    db.add(tpl)
    db.commit()
    return {"saved": True, "path": path}
