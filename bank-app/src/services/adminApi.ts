import { API_BASE_URL, handleResponse } from "./api";


export type DemoScenario =
  | "NORMAL"
  | "SLOW_RESPONSE"
  | "PERMISSION_DENIED"
  | "SESSION_EXPIRED"
  | "APP_ERROR"
  | "SUPERVISOR_APPROVAL";


interface ScenarioResponse {
  scenario: DemoScenario;
}


export async function getScenario(): Promise<DemoScenario> {
  const response = await fetch(
    `${API_BASE_URL}/api/admin/scenario`,
  );

  const result =
    await handleResponse<ScenarioResponse>(response);

  return result.scenario;
}


export async function setScenario(
  scenario: DemoScenario,
): Promise<DemoScenario> {
  const response = await fetch(
    `${API_BASE_URL}/api/admin/scenario`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scenario,
      }),
    },
  );

  const result =
    await handleResponse<ScenarioResponse>(response);

  return result.scenario;
}
