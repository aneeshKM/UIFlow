export const API_BASE_URL = "http://localhost:8001";

export async function handleResponse<T>(
  response: Response,
): Promise<T> {
  if (response.status === 401) {
    window.location.assign(
      "/login?reason=session-expired",
    );

    throw new Error(
      "Your session has expired. Please sign in again.",
    );
  }

  if (!response.ok) {
    let message = "Something went wrong.";

    try {
      const data = await response.json();

      if (typeof data.detail === "string") {
        message = data.detail;
      } else if (data.detail?.message) {
        message = data.detail.message;
      }
    } catch {
      message = `Request failed with status ${response.status}`;
    }

    throw new Error(message);
  }

  return response.json();
}
