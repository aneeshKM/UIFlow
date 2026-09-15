import { useEffect, useState } from "react";

import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";

import Layout from "../components/Layout";

import {
  createAccount,
  previewAccount,
} from "../services/accountApi";

import { getMember } from "../services/memberApi";

import type {
  AccountCreateRequest,
  AccountPreview,
  Member,
} from "../types/bank";

export default function ReviewAccountPage() {
  const { memberId } = useParams();

  const navigate = useNavigate();

  const [searchParams] = useSearchParams();

  const [member, setMember] =
    useState<Member | null>(null);

  const [preview, setPreview] =
    useState<AccountPreview | null>(null);

  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);

  const [error, setError] = useState("");

  const accountType = searchParams.get("accountType");

  const initialDeposit =
    searchParams.get("initialDeposit");

  const statementPreference =
    searchParams.get("statementPreference");

  useEffect(() => {
    async function loadPreview() {
      if (
        !memberId ||
        !accountType ||
        initialDeposit === null ||
        !statementPreference
      ) {
        setError("Account information is incomplete.");
        setLoading(false);
        return;
      }

      const request: AccountCreateRequest = {
        type: accountType as AccountCreateRequest["type"],

        initial_deposit: Number(initialDeposit),

        statement_preference:
          statementPreference as AccountCreateRequest["statement_preference"],
      };

      try {
        const [memberResult, previewResult] =
          await Promise.all([
            getMember(memberId),
            previewAccount(memberId, request),
          ]);

        setMember(memberResult);
        setPreview(previewResult);
      } catch (error) {
        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError(
            "Unable to prepare account preview.",
          );
        }
      } finally {
        setLoading(false);
      }
    }

    loadPreview();
  }, [
    memberId,
    accountType,
    initialDeposit,
    statementPreference,
  ]);

  async function handleConfirm() {
    if (!memberId || !preview) {
      return;
    }

    const request: AccountCreateRequest = {
      type: preview.type as AccountCreateRequest["type"],

      initial_deposit: preview.initial_deposit,

      statement_preference:
        preview.statement_preference as AccountCreateRequest["statement_preference"],
    };

    setCreating(true);
    setError("");

    try {
      const account = await createAccount(
        memberId,
        request,
      );

      navigate(
        `/members/${memberId}/accounts/${account.id}`,
      );
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("Unable to create account.");
      }

      setCreating(false);
    }
  }

  if (loading) {
    return (
      <Layout>
        <p>Preparing account preview...</p>
      </Layout>
    );
  }

  if (error && !preview) {
    return (
      <Layout>
        <div className="error-message">
          {error}
        </div>
      </Layout>
    );
  }

  if (!member || !preview) {
    return (
      <Layout>
        <div className="error-message">
          Unable to load account preview.
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <h2>Review New Account</h2>

      <div className="warning-message">
        Review all information before opening
        the account.
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          Account Review
        </div>

        <div className="details-grid">
          <div>
            <strong>Member</strong>

            <span>
              {member.first_name} {member.last_name}
            </span>
          </div>

          <div>
            <strong>Member ID</strong>
            <span>{member.id}</span>
          </div>

          <div>
            <strong>Account Type</strong>
            <span>{preview.type}</span>
          </div>

          <div>
            <strong>Initial Deposit</strong>

            <span>
              $
              {preview.initial_deposit.toLocaleString(
                "en-US",
                {
                  minimumFractionDigits: 2,
                },
              )}
            </span>
          </div>

          <div>
            <strong>Statement Preference</strong>

            <span>
              {preview.statement_preference}
            </span>
          </div>

          <div>
            <strong>Status</strong>
            <span>{preview.status}</span>
          </div>
        </div>

        <div className="panel-actions">
          <Link
            to={`/members/${member.id}/accounts/new`}
          >
            <button className="secondary-button">
              Back
            </button>
          </Link>

          <button
            className="danger-button"
            disabled={creating}
            onClick={handleConfirm}
          >
            {creating
              ? "Opening Account..."
              : "Confirm Account Opening"}
          </button>
        </div>
      </section>
    </Layout>
  );
}