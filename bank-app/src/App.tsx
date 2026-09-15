import {
  Navigate,
  Route,
  Routes,
} from "react-router";

import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import MemberSearchPage from "./pages/MemberSearchPage";
import MemberDetailsPage from "./pages/MemberDetailsPage";
import AccountDetailsPage from "./pages/AccountDetailsPage";
import NewAccountPage from "./pages/NewAccountPage";
import ReviewAccountPage from "./pages/ReviewAccountPage";
import AccountsPage from "./pages/AccountsPage";
import TransactionsPage from "./pages/TransactionsPage";
import AdminPage from "./pages/AdminPage";
import NewMemberPage from "./pages/NewMemberPage";
import ReviewMemberPage from "./pages/ReviewMemberPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />

      <Route path="/login" element={<LoginPage />} />

      <Route path="/dashboard" element={<DashboardPage />} />

      <Route path="/members" element={<MemberSearchPage />} />
      <Route
        path="/members/new"
        element={<NewMemberPage />}
      />

      <Route
        path="/members/new/review"
        element={<ReviewMemberPage />}
      />

      <Route
        path="/members/:memberId"
        element={<MemberDetailsPage />}
      />
      <Route
        path="/members/:memberId"
        element={<MemberDetailsPage />}
      />

      <Route
        path="/members/:memberId/accounts/:accountId"
        element={<AccountDetailsPage />}
      />

      <Route
        path="/members/:memberId/accounts/new"
        element={<NewAccountPage />}
      />

      <Route
        path="/members/:memberId/accounts/new/review"
        element={<ReviewAccountPage />}
      />

      <Route path="*" element={<Navigate to="/login" replace />} />
      <Route
        path="/accounts"
        element={<AccountsPage />}
      />

      <Route
        path="/transactions"
        element={<TransactionsPage />}
      />

      <Route
        path="/admin"
        element={<AdminPage />}
      />
    </Routes>
  );
}