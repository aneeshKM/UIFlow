import { Link } from "react-router";
import Layout from "../components/Layout";

export default function DashboardPage() {
  return (
    <Layout>
      <h2>Operations Dashboard</h2>

      <div className="notice">
        Welcome to the Northstar Credit Union Member Servicing System.
      </div>

      <section className="panel">
        <div className="panel-header">Member Services</div>

        <div className="panel-body">
          <p>Search for a credit union member using their member number.</p>

          <Link to="/members">
            <button className="primary-button">Member Lookup</button>
          </Link>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">Recent Activity</div>

        <table>
          <thead>
            <tr>
              <th>Member</th>
              <th>Activity</th>
              <th>Time</th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>12345</td>
              <td>Account lookup</td>
              <td>10:42 AM</td>
            </tr>

            <tr>
              <td>23456</td>
              <td>Member profile viewed</td>
              <td>10:31 AM</td>
            </tr>
          </tbody>
        </table>
      </section>
    </Layout>
  );
}