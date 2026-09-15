from pydantic import BaseModel, ConfigDict

from app.schemas.account import AccountResponse


class MemberCreateRequest(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: str | None = None
    email: str | None = None
    phone: str | None = None


class MemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    first_name: str
    last_name: str
    date_of_birth: str | None
    email: str | None
    phone: str | None
    status: str
    accounts: list[AccountResponse]