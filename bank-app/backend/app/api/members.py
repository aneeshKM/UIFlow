from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.demo.scenario import apply_common_scenario
from app.models.member import Member
from app.schemas.member import (
    MemberCreateRequest,
    MemberResponse,
)


router = APIRouter(
    prefix="/api/members",
    tags=["members"],
)


def generate_member_id(db: Session) -> str:
    member_ids = db.scalars(
        select(Member.id)
    ).all()

    numeric_ids = [
        int(member_id)
        for member_id in member_ids
        if member_id.isdigit()
    ]

    if not numeric_ids:
        return "10000"

    return str(max(numeric_ids) + 1)


@router.get(
    "/{member_id}",
    response_model=MemberResponse,
)
def get_member(
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
                "message": f"No member found for ID {member_id}",
            },
        )

    return member


@router.post(
    "",
    response_model=MemberResponse,
    status_code=201,
)
def create_member(
    request: MemberCreateRequest,
    db: Session = Depends(get_db),
):
    member = Member(
        id=generate_member_id(db),
        first_name=request.first_name.strip(),
        last_name=request.last_name.strip(),
        date_of_birth=request.date_of_birth,
        email=request.email,
        phone=request.phone,
        status="Active",
    )

    db.add(member)
    db.commit()
    db.refresh(member)

    return member
