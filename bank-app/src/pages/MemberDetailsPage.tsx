import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import Layout from "../components/Layout";
import { getMember } from "../services/memberApi";

import type { Member } from "../types/bank";

export default function MemberDetailsPage() {
  const { memberId } = useParams();

  const [member, setMember] = useState<Member | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  useEffect(() => {
    async function loadMember() {
      if (!memberId) {
        setError("Member ID is missing.");
        setLoading(false);
        return;
      }

      try {
        const result = await getMember(memberId);

        setMember(result);
      } catch (error) {
        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError("Unable to load member.");
        }
      } finally {
        setLoading(false);
      }
    }

    loadMember();
  }, [memberId]);

  if (loading) {
    return (
      <Layout>
        <p>Loading member...</p>
      </Layout>
    );
  }

  if (error || !member) {
    return (
      <Layout>
        <div className="error-message">
          {error || "Member not found."}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h2>Member Information</h2>

      <section className="panel">
        <div className="panel-header">
          Member Profile
        </div>

        <div className="details-grid">
          <div>
            <strong>Member ID</strong>
            <span>{member.id}</span>
          </div>

          <div>
            <strong>Name</strong>

            <span>
              {member.first_name} {member.last_name}
            </span>
          </div>

          <div>
            <strong>Status</strong>
            <span>{member.status}</span>
          </div>
          <div>
            <strong>Date of Birth</strong>

            <span>
              {member.date_of_birth || "Not provided"}
            </span>
          </div>

          <div>
            <strong>Email</strong>

            <span>
              {member.email || "Not provided"}
            </span>
          </div>

          <div>
            <strong>Phone</strong>

            <span>
              {member.phone || "Not provided"}
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          Accounts
        </div>

        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Account Number</th>
              <th>Available Balance</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            {member.accounts.map((account) => (
              <tr key={account.id}>
                <td>{account.type}</td>

                <td>
                  ****{account.account_number}
                </td>

                <td>
                  $
                  {account.available_balance.toLocaleString(
                    "en-US",
                    {
                      minimumFractionDigits: 2,
                    },
                  )}
                </td>

                <td>{account.status}</td>

                <td>
                  <Link
                    to={`/members/${member.id}/accounts/${account.id}`}
                  >
                    <button className="small-button">
                      View
                    </button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="panel-actions">
          <Link
            to={`/members/${member.id}/accounts/new`}
          >
            <button className="primary-button">
              Open New Sub-Account
            </button>
          </Link>
        </div>
      </section>
    </Layout>
  );
}