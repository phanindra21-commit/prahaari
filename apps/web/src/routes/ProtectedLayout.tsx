import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { TopBar } from "../components/layout/TopBar";

export function ProtectedLayout(): JSX.Element {
  const status = useAuthStore((s) => s.status);

  if (status === "idle" || status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950 text-mist-300">
        <p className="text-sm">Loading session…</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen flex-col bg-ink-950">
      <div className="no-print">
        <TopBar />
      </div>
      <div className="min-h-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
