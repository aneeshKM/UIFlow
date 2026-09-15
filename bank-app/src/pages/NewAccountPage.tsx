import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import Layout from "../components/Layout";

export default function NewAccountPage() {
  const { memberId } = useParams();
  const navigate = useNavigate();

  const [accountType, setAccountType] = useState("Savings");
  const [initialDeposit, setInitialDeposit] = useState("");
  const [statementPreference, setStatementPreference] =
    useState("Electronic");

  function handleContinue(event: React.FormEvent) {
    event.preventDefault();

    const params = new URLSearchParams({
      accountType,
      initialDeposit,
      statementPreference,
    });

    navigate(
      `/members/${memberId}/accounts/new/review?${params.toString()}`,
    );
  }

  return (
    <Layout>
      <h2>Open New Sub-Account</h2>

      <section className="panel">
        <div className="panel-header">New Account Information</div>

        <div className="panel-body">
          <form onSubmit={handleContinue}>
            <div className="form-group">
              <label htmlFor="account-type">Account Type</label>

              <select
                id="account-type"
                value={accountType}
                onChange={(event) =>
                  setAccountType(event.target.value)
                }
              >
                <option>Savings</option>
                <option>Checking</option>
                <option>Money Market</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="deposit">Initial Deposit</label>

              <input
                id="deposit"
                type="number"
                value={initialDeposit}
                onChange={(event) =>
                  setInitialDeposit(event.target.value)
                }
              />
            </div>

            <fieldset>
              <legend>Statement Preference</legend>

              <label>
                <input
                  type="radio"
                  name="statement"
                  value="Electronic"
                  checked={statementPreference === "Electronic"}
                  onChange={(event) =>
                    setStatementPreference(event.target.value)
                  }
                />
                Electronic
              </label>

              <label>
                <input
                  type="radio"
                  name="statement"
                  value="Paper"
                  checked={statementPreference === "Paper"}
                  onChange={(event) =>
                    setStatementPreference(event.target.value)
                  }
                />
                Paper
              </label>
            </fieldset>

            <button type="submit" className="primary-button">
              Continue
            </button>
          </form>
        </div>
      </section>
    </Layout>
  );
}