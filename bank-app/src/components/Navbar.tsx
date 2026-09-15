import { Link } from "react-router";

export default function Navbar() {
  return (
    <nav className="navbar">
        <Link to="/dashboard">Home</Link>
        <Link to="/members">Members</Link>
        <Link to="/accounts">Accounts</Link>
        <Link to="/transactions">Transactions</Link>
        <Link to="/admin">Admin</Link>
    </nav>
  );
}