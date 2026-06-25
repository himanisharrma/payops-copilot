"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Check, ExternalLink, ShieldAlert } from "lucide-react";
import type { OperationalNotification } from "@/lib/types";

export function NotificationCenter({
  initialNotifications,
  canManage,
}: {
  initialNotifications: OperationalNotification[];
  canManage: boolean;
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.readAt).length,
    [notifications],
  );

  useEffect(() => {
    function close(event: MouseEvent) {
      if (
        rootRef.current &&
        !rootRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  async function markRead(id: string) {
    setError("");
    const response = await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ read: true }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Notification state could not be updated.");
      return;
    }
    setNotifications((current) =>
      current.map((notification) =>
        notification.id === id
          ? { ...notification, readAt: new Date().toISOString() }
          : notification,
      ),
    );
  }

  return (
    <div className="notification-center" ref={rootRef}>
      <button
        type="button"
        className="notification-trigger"
        aria-label={`${unreadCount} unread operational notifications`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={16} />
        {unreadCount > 0 && <span>{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>
      {open && (
        <section
          className="notification-panel"
          role="dialog"
          aria-label="Operational notifications"
        >
          <header>
            <div>
              <span>OPERATIONS SIGNALS</span>
              <h2>Evidence inbox</h2>
            </div>
            <strong>{unreadCount} unread</strong>
          </header>
          {error && <p className="notification-error">{error}</p>}
          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">
                <Check size={18} />
                <strong>No active signals</strong>
                <p>Provider evidence and SLA risk will appear here.</p>
              </div>
            ) : (
              notifications.map((notification) => {
                const href =
                  notification.entityType === "payment_workflow"
                    ? "/refunds-disputes"
                    : "/operations";
                return (
                  <article
                    key={notification.id}
                    className={`${notification.severity} ${
                      notification.readAt ? "read" : "unread"
                    }`}
                  >
                    <div className="notification-signal">
                      <ShieldAlert size={15} />
                    </div>
                    <div>
                      <span>
                        {notification.type.replaceAll("_", " ")} ·{" "}
                        {new Date(notification.createdAt).toLocaleString(
                          "en-IN",
                          {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </span>
                      <strong>{notification.title}</strong>
                      <p>{notification.message}</p>
                      <div className="notification-actions">
                        {notification.entityId && (
                          <Link href={href} onClick={() => setOpen(false)}>
                            Open record <ExternalLink size={11} />
                          </Link>
                        )}
                        {!notification.readAt && canManage && (
                          <button
                            type="button"
                            onClick={() => void markRead(notification.id)}
                          >
                            <Check size={11} /> Mark read
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          {!canManage && notifications.length > 0 && (
            <footer>VIEW-ONLY · Analysts manage notification state</footer>
          )}
        </section>
      )}
    </div>
  );
}
