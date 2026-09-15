import time
from enum import Enum

from fastapi import HTTPException


class DemoScenario(str, Enum):
    NORMAL = "NORMAL"
    SLOW_RESPONSE = "SLOW_RESPONSE"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    APP_ERROR = "APP_ERROR"
    SUPERVISOR_APPROVAL = "SUPERVISOR_APPROVAL"


_current_scenario = DemoScenario.NORMAL


def get_scenario() -> DemoScenario:
    return _current_scenario


def set_scenario(scenario: DemoScenario) -> None:
    global _current_scenario

    _current_scenario = scenario


def apply_common_scenario() -> None:
    scenario = get_scenario()

    if scenario == DemoScenario.SLOW_RESPONSE:
        time.sleep(5)
    elif scenario == DemoScenario.PERMISSION_DENIED:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "PERMISSION_DENIED",
                "message": "You do not have permission to perform this operation.",
            },
        )
    elif scenario == DemoScenario.SESSION_EXPIRED:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "SESSION_EXPIRED",
                "message": "Your session has expired. Please sign in again.",
            },
        )
    elif scenario == DemoScenario.APP_ERROR:
        raise HTTPException(
            status_code=500,
            detail={
                "code": "APPLICATION_ERROR",
                "message": "The core banking system encountered an unexpected error.",
            },
        )
