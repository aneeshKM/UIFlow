from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    account_number: str
    type: str
    available_balance: float
    current_balance: float
    status: str
    last_activity: str
    statement_preference: str


class AccountCreateRequest(BaseModel):
    type: Literal[
        "Savings",
        "Checking",
        "Money Market",
    ]

    initial_deposit: float = Field(
        ge=0,
    )

    statement_preference: Literal[
        "Electronic",
        "Paper",
    ]


class AccountPreviewResponse(BaseModel):
    member_id: str
    type: str
    initial_deposit: float
    statement_preference: str
    status: str