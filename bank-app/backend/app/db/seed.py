from sqlalchemy import select

from app.db.database import SessionLocal
from app.models.account import Account
from app.models.member import Member


def seed_database():
    db = SessionLocal()

    try:
        # Do not seed again if members already exist.
        existing_member = db.scalar(
            select(Member).limit(1)
        )

        if existing_member:
            return

        john = Member(
            id="12345",
            first_name="John",
            last_name="Smith",
            status="Active",
            accounts=[
                Account(
                    id="acc-101",
                    account_number="4521",
                    type="Savings",
                    available_balance=4281.50,
                    current_balance=4356.22,
                    status="Open",
                    last_activity="09/14/2026",
                    statement_preference="Electronic",
                ),
                Account(
                    id="acc-102",
                    account_number="1883",
                    type="Checking",
                    available_balance=1024.19,
                    current_balance=1024.19,
                    status="Open",
                    last_activity="09/13/2026",
                    statement_preference="Electronic",
                ),
                Account(
                    id="acc-103",
                    account_number="9912",
                    type="Loan",
                    available_balance=-8200.00,
                    current_balance=-8200.00,
                    status="Open",
                    last_activity="09/10/2026",
                    statement_preference="Paper",
                ),
            ],
        )

        sarah = Member(
            id="23456",
            first_name="Sarah",
            last_name="Johnson",
            status="Active",
            accounts=[
                Account(
                    id="acc-201",
                    account_number="7721",
                    type="Savings",
                    available_balance=8370.25,
                    current_balance=8370.25,
                    status="Open",
                    last_activity="09/12/2026",
                    statement_preference="Electronic",
                )
            ],
        )

        db.add_all(
            [
                john,
                sarah,
            ]
        )

        db.commit()

        print("Database seeded successfully.")

    finally:
        db.close()