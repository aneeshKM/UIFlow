import type { ReactNode } from "react";
import Header from "./Header";
import Navbar from "./Navbar";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="app-shell">
      <Header />
      <Navbar />

      <main className="content">{children}</main>

      <footer className="footer">
        System Status: Connected | Northstar Core Services
      </footer>
    </div>
  );
}