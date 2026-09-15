from datetime import date
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.demo.scenario import apply_common_scenario
from app.models.account import Account
from app.models.member import Member
from app.schemas.account import (
    AccountCreateRequest,
    AccountPreviewResponse,
    AccountResponse,
)


router = APIRouter(
    prefix="/api/members/{member_id}/accounts",
    tags=["accounts"],
)


@router.get(
    "",
    response_model=list[AccountResponse],
)
def get_accounts(
    member_id: str,
    db: Session = Depends(get_db),
):
    apply_common_scenario()

    member = db.get(
        Member,
        member_id,
    )

    if not member:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "MEMBER_NOT_FOUND",
                "message": "Member does not exist.",
            },
        )

    return member.accounts


@router.get(
    "/{account_id}",
    response_model=AccountResponse,
)
def get_account(
    member_id: str,
    account_id: str,
    db: Session = Depends(get_db),
):
    apply_common_scenario()

    account = db.scalar(
        select(Account).where(
            Account.id == account_id,
            Account.member_id == member_id,
        )
    )

    if not account:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "ACCOUNT_NOT_FOUND",
                "message": "Account does not exist.",
            },
        )

    return account


@router.post(
    "/preview",
    response_model=AccountPreviewResponse,
)
def preview_account(
    member_id: str,
    request: AccountCreateRequest,
    db: Session = Depends(get_db),
):
    apply_common_scenario()

    member = db.get(
        Member,
        member_id,
    )

    if not member:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "MEMBER_NOT_FOUND",
                "message": "Member does not exist.",
            },
        )

    return AccountPreviewResponse(
        member_id=member_id,
        type=request.type,
        initial_deposit=request.initial_deposit,
        statement_preference=request.statement_preference,
        status="READY_FOR_CONFIRMATION",
    )


@router.post(
    "",
    response_model=AccountResponse,
    status_code=201,
)
def create_account(
    member_id: str,
    request: AccountCreateRequest,
    db: Session = Depends(get_db),
):
    apply_common_scenario()

    member = db.get(
        Member,
        member_id,
    )

    if not member:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "MEMBER_NOT_FOUND",
                "message": "Member does not exist.",
            },
        )

    account_count = db.scalar(
        select(func.count()).select_from(Account)
    ) or 0

    account_number = str(
        5000 + account_count + 1
    )

    account = Account(
        id=f"acc-{uuid4().hex[:8]}",
        member_id=member_id,
        account_number=account_number,
        type=request.type,
        available_balance=request.initial_deposit,
        current_balance=request.initial_deposit,
        status="Open",
        last_activity=date.today().strftime("%m/%d/%Y"),
        statement_preference=request.statement_preference,
    )

    db.add(account)
    db.commit()
    db.refresh(account)

    return account
