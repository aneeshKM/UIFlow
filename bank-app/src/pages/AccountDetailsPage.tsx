import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";

import Layout from "../components/Layout";

import { getAccount } from "../services/accountApi";
import { getMember } from "../services/memberApi";

import type {
  Account,
  Member,
} from "../types/bank";

export default function AccountDetailsPage() {
  const { memberId, accountId } = useParams();

  const [account, setAccount] =
    useState<Account | null>(null);

  const [member, setMember] =
    useState<Member | null>(null);

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAccount() {
      if (!memberId || !accountId) {
        setError("Member or account ID is missing.");
        setLoading(false);
        return;
      }

      try {
        const [memberResult, accountResult] =
          await Promise.all([
            getMember(memberId),
            getAccount(memberId, accountId),
          ]);

        setMember(memberResult);
        setAccount(accountResult);
      } catch (error) {
        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError("Unable to load account.");
        }
      } finally {
        setLoading(false);
      }
    }

    loadAccount();
  }, [memberId, accountId]);

  if (loading) {
    return (
      <Layout>
        <p>Loading account...</p>
      </Layout>
    );
  }

  if (error || !account || !member) {
    return (
      <Layout>
        <div className="error-message">
          {error || "Account not found."}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h2>{account.type} Account</h2>

      <section className="panel">
        <div className="panel-header">
          Account Information
        </div>

        <div className="details-grid">
          <div>
            <strong>Member</strong>

            <span>
              {member.first_name} {member.last_name}
            </span>
          </div>

          <div>
            <strong>Account</strong>

            <span>
              ****{account.account_number}
            </span>
          </div>

          <div>
            <strong>Status</strong>
            <span>{account.status}</span>
          </div>

          <div>
            <strong>Available Balance</strong>

            <span className="large-value">
              $
              {account.available_balance.toLocaleString(
                "en-US",
                {
                  minimumFractionDigits: 2,
                },
              )}
            </span>
          </div>

          <div>
            <strong>Current Balance</strong>

            <span>
              $
              {account.current_balance.toLocaleString(
                "en-US",
                {
                  minimumFractionDigits: 2,
                },
              )}
            </span>
          </div>

          <div>
            <strong>Last Activity</strong>

            <span>{account.last_activity}</span>
          </div>

          <div>
            <strong>Statement Preference</strong>

            <span>
              {account.statement_preference}
            </span>
          </div>
        </div>

        <div className="panel-actions">
          <Link to={`/members/${member.id}`}>
            <button className="secondary-button">
              Back to Member
            </button>
          </Link>
        </div>
      </section>
    </Layout>
  );
}