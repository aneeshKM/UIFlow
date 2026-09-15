from fastapi import APIRouter

from app.demo.scenario import get_scenario, set_scenario
from app.schemas.admin import ScenarioResponse, ScenarioUpdateRequest


router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
)


@router.get(
    "/scenario",
    response_model=ScenarioResponse,
)
def read_scenario():
    return {
        "scenario": get_scenario(),
    }


@router.put(
    "/scenario",
    response_model=ScenarioResponse,
)
def update_scenario(request: ScenarioUpdateRequest):
    set_scenario(request.scenario)

    return {
        "scenario": get_scenario(),
    }
