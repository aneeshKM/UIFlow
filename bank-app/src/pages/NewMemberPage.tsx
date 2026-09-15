import { useState } from "react";

import {
  Link,
  useNavigate,
} from "react-router";

import Layout from "../components/Layout";


export default function NewMemberPage() {
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");


  function handleContinue(
    event: React.FormEvent,
  ) {
    event.preventDefault();

    if (
      !firstName.trim() ||
      !lastName.trim()
    ) {
      return;
    }

    const params = new URLSearchParams({
      firstName,
      lastName,
      dateOfBirth,
      email,
      phone,
    });

    navigate(
      `/members/new/review?${params.toString()}`,
    );
  }


  return (
    <Layout>
      <h2>Create New Member</h2>

      <section className="panel">
        <div className="panel-header">
          Member Information
        </div>

        <div className="panel-body">
          <form onSubmit={handleContinue}>

            <div className="form-group">
              <label htmlFor="first-name">
                First Name
              </label>

              <input
                id="first-name"
                value={firstName}
                onChange={(event) =>
                  setFirstName(event.target.value)
                }
                required
              />
            </div>


            <div className="form-group">
              <label htmlFor="last-name">
                Last Name
              </label>

              <input
                id="last-name"
                value={lastName}
                onChange={(event) =>
                  setLastName(event.target.value)
                }
                required
              />
            </div>


            <div className="form-group">
              <label htmlFor="date-of-birth">
                Date of Birth
              </label>

              <input
                id="date-of-birth"
                type="date"
                value={dateOfBirth}
                onChange={(event) =>
                  setDateOfBirth(event.target.value)
                }
              />
            </div>


            <div className="form-group">
              <label htmlFor="email">
                Email
              </label>

              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
              />
            </div>


            <div className="form-group">
              <label htmlFor="phone">
                Phone
              </label>

              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(event) =>
                  setPhone(event.target.value)
                }
              />
            </div>


            <div className="panel-actions">
              <Link to="/members">
                <button
                  type="button"
                  className="secondary-button"
                >
                  Cancel
                </button>
              </Link>

              <button
                type="submit"
                className="primary-button"
              >
                Continue
              </button>
            </div>

          </form>
        </div>
      </section>
    </Layout>
  );
}