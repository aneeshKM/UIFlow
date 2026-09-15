from typing import TYPE_CHECKING

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base

if TYPE_CHECKING:
    from app.models.account import Account


class Member(Base):
    __tablename__ = "members"

    id: Mapped[str] = mapped_column(
        String,
        primary_key=True,
    )

    first_name: Mapped[str] = mapped_column(String)

    last_name: Mapped[str] = mapped_column(String)

    date_of_birth: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    email: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    phone: Mapped[str | None] = mapped_column(
        String,
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String,
        default="Active",
    )

    accounts: Mapped[list["Account"]] = relationship(
        back_populates="member",
        cascade="all, delete-orphan",
    )