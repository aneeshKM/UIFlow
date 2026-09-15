import { useEffect, useState } from "react";

import Layout from "../components/Layout";
import {
  getScenario,
  setScenario,
} from "../services/adminApi";

import type { DemoScenario } from "../services/adminApi";


export default function AdminPage() {
  const [scenario, setCurrentScenario] =
    useState<DemoScenario>("NORMAL");

  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");


  useEffect(() => {
    async function loadScenario() {
      try {
        const current = await getScenario();

        setCurrentScenario(current);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Unable to load the current scenario.",
        );
      } finally {
        setLoading(false);
      }
    }

    loadScenario();
  }, []);


  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError("");

    try {
      const updatedScenario = await setScenario(scenario);

      setCurrentScenario(updatedScenario);
      setSaved(true);

      window.setTimeout(() => {
        setSaved(false);
      }, 2000);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to update the scenario.",
      );
    } finally {
      setSaving(false);
    }
  }


  return (
    <Layout>
      <h2>Administration</h2>

      <section className="panel">
        <div className="panel-header">
          Automation Test Environment
        </div>

        <div className="panel-body">
          <div className="form-group">
            <label htmlFor="scenario">
              Simulation Mode
            </label>

            <select
              id="scenario"
              value={scenario}
              disabled={loading || saving}
              onChange={(event) => {
                setSaved(false);
                setCurrentScenario(
                  event.target.value as DemoScenario,
                );
              }}
            >
              <option value="NORMAL">Normal</option>

              <option value="SLOW_RESPONSE">
                Slow Response
              </option>

              <option value="PERMISSION_DENIED">
                Permission Denied
              </option>

              <option value="SESSION_EXPIRED">
                Session Expired
              </option>

              <option value="APP_ERROR">
                Application Error
              </option>

              <option value="SUPERVISOR_APPROVAL">
                Supervisor Approval Required
              </option>
            </select>
          </div>

          <button
            className="primary-button"
            disabled={loading || saving}
            onClick={handleSave}
          >
            {saving ? "Applying..." : "Apply Scenario"}
          </button>

          {saved && (
            <div className="notice admin-scenario-message">
              Scenario updated.
            </div>
          )}

          {error && (
            <div className="error-message admin-scenario-message">
              {error}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          Scenario Guide
        </div>

        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Expected Behavior</th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>Normal</td>
              <td>Application behaves normally.</td>
            </tr>

            <tr>
              <td>Slow Response</td>
              <td>Backend waits before responding.</td>
            </tr>

            <tr>
              <td>Permission Denied</td>
              <td>
                Operation returns an authorization error.
              </td>
            </tr>

            <tr>
              <td>Session Expired</td>
              <td>
                Request redirects to sign-in with an
                expired-session message.
              </td>
            </tr>

            <tr>
              <td>Application Error</td>
              <td>
                Core system returns an unexpected error.
              </td>
            </tr>

            <tr>
              <td>Supervisor Approval</td>
              <td>
                Reserved for the human approval workflow.
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </Layout>
  );
}
