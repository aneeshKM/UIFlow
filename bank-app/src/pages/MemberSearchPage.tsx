import { useState } from "react";
import { Link } from "react-router";

import Layout from "../components/Layout";
import { getMember } from "../services/memberApi";

import type { Member } from "../types/bank";

export default function MemberSearchPage() {
  const [memberId, setMemberId] = useState("");

  const [member, setMember] = useState<Member | null>(null);

  const [error, setError] = useState("");

  const [loading, setLoading] = useState(false);

  const [hasSearched, setHasSearched] = useState(false);

  async function handleSearch(event: React.FormEvent) {
    event.preventDefault();

    const id = memberId.trim();

    if (!id) {
      return;
    }

    setLoading(true);
    setError("");
    setMember(null);
    setHasSearched(true);

    try {
      const result = await getMember(id);

      setMember(result);
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("Unable to search for member.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout>
      <h2>Member Search</h2>

      <div className="panel-actions">
        <Link to="/members/new">
          <button className="primary-button">
            Create New Member
          </button>
        </Link>
      </div>
      <section className="panel">
        <div className="panel-header">Search Criteria</div>

        <div className="panel-body">
          <form onSubmit={handleSearch} className="search-form">
            <div className="form-group">
              <label htmlFor="member-number">
                Member Number
              </label>

              <input
                id="member-number"
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

      {hasSearched && (
        <section className="panel">
          <div className="panel-header">Search Results</div>

          <div className="panel-body">
            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            {member && (
              <table>
                <thead>
                  <tr>
                    <th>Member ID</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  <tr>
                    <td>{member.id}</td>

                    <td>
                      {member.first_name}{" "}
                      {member.last_name}
                    </td>

                    <td>{member.status}</td>

                    <td>
                      <Link to={`/members/${member.id}`}>
                        <button className="small-button">
                          View
                        </button>
                      </Link>
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}
    </Layout>
  );
}