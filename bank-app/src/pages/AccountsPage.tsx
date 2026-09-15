import { useState } from "react";
import { getMember } from "../services/memberApi";
import Layout from "../components/Layout";
import type { Member } from "../types/bank";

export default function AccountsPage() {
  const [memberId, setMemberId] = useState("");
  const [member, setMember] = useState<Member | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();

    if (!memberId.trim()) {
      return;
    }

    setLoading(true);
    setError("");
    setMember(null);

    try {
      const result = await getMember(memberId.trim());
      setMember(result);
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("Unable to load accounts.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <h2>Account Search</h2>

      <section className="panel">
        <div className="panel-header">Search by Member</div>

        <div className="panel-body">
          <form onSubmit={handleSearch} className="search-form">
            <div className="form-group">
              <label htmlFor="account-member-id">
                Member Number
              </label>

              <input
                id="account-member-id"
                value={memberId}
                onChange={(event) =>
                  setMemberId(event.target.value)
                }
              />
            </div>

            <button
              type="submit"
              className="primary-button"
              disabled={loading}
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </form>
        </div>
      </section>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {member && (
        <section className="panel">
          <div className="panel-header">
            Accounts for {member.first_name} {member.last_name}
          </div>

          <table>
            <thead>
              <tr>
                <th>Account Type</th>
                <th>Account Number</th>
                <th>Available Balance</th>
                <th>Current Balance</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>
              {member.accounts.map((account) => (
                <tr key={account.id}>
                  <td>{account.type}</td>
                  <td>****{account.account_number}</td>
                  <td>
                    $
                    {account.available_balance.toLocaleString(
                      "en-US",
                      {
                        minimumFractionDigits: 2,
                      },
                    )}
                  </td>
                  <td>
                    $
                    {account.current_balance.toLocaleString(
                      "en-US",
                      {
                        minimumFractionDigits: 2,
                      },
                    )}
                  </td>
                  <td>{account.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </Layout>
  );
}