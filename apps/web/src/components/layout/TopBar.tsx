import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { useDistrictStore } from "../../stores/districtStore";
import { useDistricts } from "../../hooks/useApi";
import { hasPermission } from "../../lib/permissions";
import { NotificationBell } from "./NotificationBell";

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  STATE_ADMIN: "State Admin",
  DISTRICT_OFFICER: "District Officer",
  ANALYST: "Analyst",
  FIELD_VOLUNTEER: "Field Volunteer",
};

const navLinkClass = ({ isActive }: { isActive: boolean }): string =>
  `px-3 py-1.5 text-sm transition-colors ${
    isActive ? "text-mist-50 border-b-2 border-signal-bright" : "text-mist-300 hover:text-mist-100"
  }`;

export function TopBar(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const selectedDistrictId = useDistrictStore((s) => s.selectedDistrictId);
  const setSelectedDistrictId = useDistrictStore((s) => s.setSelectedDistrictId);
  const { data } = useDistricts();

  useEffect(() => {
    if (!data || data.items.length === 0) return;

    const currentIsValid = data.items.some((d) => d._id === selectedDistrictId);
    if (!selectedDistrictId || !currentIsValid) {
      // Prioritize the user's assigned district if present, otherwise default to first available
      const userDistrictMatch = user?.scope?.districtId
        ? data.items.find((d) => d._id === user.scope.districtId)
        : null;
      setSelectedDistrictId(userDistrictMatch ? userDistrictMatch._id : data.items[0]!._id);
    }
  }, [data, selectedDistrictId, setSelectedDistrictId, user]);

  return (
    <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-ink-600 bg-ink-900 px-4">
      <div className="flex items-center gap-6">
        <span className="text-sm font-semibold tracking-tight text-mist-50">PunarVas</span>

        {data && data.items.length > 0 && (
          <select
            value={selectedDistrictId ?? ""}
            onChange={(e) => setSelectedDistrictId(e.target.value)}
            className="rounded border border-ink-500 bg-ink-800 px-2 py-1 text-sm text-mist-100 focus-visible:border-signal-bright"
          >
            {data.items.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}, {d.state}
              </option>
            ))}
          </select>
        )}

        <nav className="flex h-12 items-center gap-1">
          <NavLink to="/dashboard" className={navLinkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/map" className={navLinkClass}>
            Map
          </NavLink>
          {user && hasPermission(user.role, "assessment:read") && (
            <NavLink to="/priorities" className={navLinkClass}>
              Priority worklist
            </NavLink>
          )}
          {user && hasPermission(user.role, "recommendation:read") && (
            <NavLink to="/recommendations" className={navLinkClass}>
              Review queue
            </NavLink>
          )}
        </nav>
      </div>

      <div className="flex items-center gap-3 text-sm">
        {user && (
          <>
            <NotificationBell />
            <span className="text-mist-300">
              {user.name} <span className="text-mist-400">· {ROLE_LABELS[user.role] ?? user.role}</span>
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded border border-ink-500 px-2 py-1 text-mist-300 transition-colors hover:border-ink-500 hover:text-mist-100"
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
