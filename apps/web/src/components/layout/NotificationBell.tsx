import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/authStore";
import { hasPermission } from "../../lib/permissions";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "../../hooks/useApi";

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Step 10 Part 6: a bell icon with unread count, dropdown list, mark-as-
 * read — simple in-app notifications only (no email/push). Gated on
 * notification:read (granted to every role) so it only renders once the
 * signed-in user is known. */
export function NotificationBell(): JSX.Element | null {
  const user = useAuthStore((s) => s.user);
  const canRead = user ? hasPermission(user.role, "notification:read") : false;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const { data } = useNotifications(canRead);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  useEffect(() => {
    function onClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (!canRead) return null;

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
        className="relative rounded border border-ink-500 px-2 py-1 text-mist-300 transition-colors hover:border-ink-500 hover:text-mist-100"
      >
        <span aria-hidden="true">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-signal-bright px-1 font-mono text-[9px] font-semibold text-ink-900">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded border border-ink-600 bg-ink-800 shadow-panel">
          <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
            <span className="text-xs font-medium text-mist-200">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                className="text-[11px] text-signal-bright hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="scrollbar-thin max-h-80 overflow-y-auto">
            {items.length === 0 && <p className="px-3 py-4 text-center text-xs text-mist-400">No notifications yet.</p>}
            {items.map((n) => (
              <button
                key={n._id}
                type="button"
                onClick={() => {
                  if (!n.read) markRead.mutate(n._id);
                  setOpen(false);
                  navigate(`/recommendations/${n.relatedEntityId}`);
                }}
                className={`block w-full border-b border-ink-700 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-ink-700 ${
                  n.read ? "text-mist-400" : "text-mist-100"
                }`}
              >
                <div className="flex items-start gap-1.5">
                  {!n.read && <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-signal-bright" />}
                  <div className={n.read ? "" : "font-medium"}>
                    <p>{n.message}</p>
                    <p className="mt-0.5 text-[10px] text-mist-500">{timeAgo(n.createdAt)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
