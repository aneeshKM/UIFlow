import { useState } from "react";

import {
  Link,
  useNavigate,
  useSearchParams,
} from "react-router";

import Layout from "../components/Layout";

import {
  createMember,
} from "../services/memberApi";

import type {
  MemberCreateRequest,
} from "../types/bank";


export default function ReviewMemberPage() {
  const navigate = useNavigate();

  const [searchParams] = useSearchParams();

  const [creating, setCreating] =
    useState(false);

  const [error, setError] =
    useState("");


  const firstName =
    searchParams.get("firstName") ?? "";

  const lastName =
    searchParams.get("lastName") ?? "";

  const dateOfBirth =
    searchParams.get("dateOfBirth") ?? "";

  const email =
    searchParams.get("email") ?? "";

  const phone =
    searchParams.get("phone") ?? "";


  async function handleCreateMember() {
    const request: MemberCreateRequest = {
      first_name: firstName,
      last_name: lastName,
      date_of_birth: dateOfBirth,
      email,
      phone,
    };

    setCreating(true);
    setError("");

    try {
      const member =
        await createMember(request);

      navigate(
        `/members/${member.id}`,
      );

    } catch (error) {

      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(
          "Unable to create member.",
        );
      }

      setCreating(false);
    }
  }


  return (
    <Layout>
      <h2>Review New Member</h2>

      <div className="warning-message">
        Review the member information before
        creating the record.
      </div>


      {error && (
        <div className="error-message">
          {error}
        </div>
      )}


      <section className="panel">

        <div className="panel-header">
          Member Review
        </div>


        <div className="details-grid">

          <div>
            <strong>First Name</strong>
            <span>{firstName}</span>
          </div>


          <div>
            <strong>Last Name</strong>
            <span>{lastName}</span>
          </div>


          <div>
            <strong>Date of Birth</strong>
            <span>
              {dateOfBirth || "Not provided"}
            </span>
          </div>


          <div>
            <strong>Email</strong>
            <span>
              {email || "Not provided"}
            </span>
          </div>


          <div>
            <strong>Phone</strong>
            <span>
              {phone || "Not provided"}
            </span>
          </div>


          <div>
            <strong>Status</strong>
            <span>Active</span>
          </div>

        </div>


        <div className="panel-actions">

          <Link
            to={`/members/new?${searchParams.toString()}`}
          >
            <button
              className="secondary-button"
            >
              Back
            </button>
          </Link>


          <button
            className="danger-button"
            disabled={creating}
            onClick={handleCreateMember}
          >
            {creating
              ? "Creating Member..."
              : "Create Member"}
          </button>

        </div>

      </section>
    </Layout>
  );
}