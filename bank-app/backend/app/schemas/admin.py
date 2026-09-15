from pydantic import BaseModel

from app.demo.scenario import DemoScenario


class ScenarioUpdateRequest(BaseModel):
    scenario: DemoScenario


class ScenarioResponse(BaseModel):
    scenario: DemoScenario
