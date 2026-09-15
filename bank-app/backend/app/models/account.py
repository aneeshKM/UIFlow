from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


if TYPE_CHECKING:
    from app.models.member import Member


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )

    member_id: Mapped[str] = mapped_column(
        ForeignKey("members.id"),
    )

    account_number: Mapped[str] = mapped_column(String)

    type: Mapped[str] = mapped_column(String)

    available_balance: Mapped[float] = mapped_column(
        Float,
        default=0,
    )

    current_balance: Mapped[float] = mapped_column(
        Float,
        default=0,
    )

    status: Mapped[str] = mapped_column(
        String,
        default="Open",
    )

    last_activity: Mapped[str] = mapped_column(String)

    statement_preference: Mapped[str] = mapped_column(
        String,
        default="Electronic",
    )

    member: Mapped["Member"] = relationship(
        back_populates="accounts",
    )