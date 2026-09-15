import { useState } from "react";
import {
  useNavigate,
  useSearchParams,
} from "react-router";

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [employeeId, setEmployeeId] = useState("");
  const [password, setPassword] = useState("");

  const sessionExpired =
    searchParams.get("reason") === "session-expired";

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    // Authentication will be handled by the backend later.
    if (employeeId && password) {
      navigate("/dashboard");
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-header">
          <h1>Northstar Credit Union</h1>
          <p>Operations Portal</p>
        </div>

        {sessionExpired && (
          <div className="warning-message login-warning">
            Your session has expired. Please sign in again.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="employee-id">Employee ID</label>

            <input
              id="employee-id"
              type="text"
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <button type="submit" className="primary-button">
            Sign In
          </button>
        </form>

        <p className="login-help">
          Authorized employees only. All activity is monitored.
        </p>
      </div>
    </div>
  );
}
