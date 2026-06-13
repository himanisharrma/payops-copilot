import type { CaseStatus, OperationsCase, SlaStatus } from "@/lib/types";

export const SLA_HOURS: Record<OperationsCase["priority"], number> = {
  high: 4,
  medium: 24,
  low: 72,
};

export function calculateDueAt(
  createdAt: string | Date,
  priority: OperationsCase["priority"],
) {
  const created = new Date(createdAt);
  return new Date(created.getTime() + SLA_HOURS[priority] * 60 * 60 * 1000);
}

export function getSlaStatus(input: {
  createdAt: string | Date;
  dueAt: string | Date;
  resolvedAt?: string | Date | null;
  status: CaseStatus;
  priority: OperationsCase["priority"];
  now?: string | Date;
}): SlaStatus {
  const dueAt = new Date(input.dueAt).getTime();

  if (input.status === "resolved" && input.resolvedAt) {
    return new Date(input.resolvedAt).getTime() <= dueAt ? "met" : "breached";
  }

  const now = new Date(input.now ?? Date.now()).getTime();
  if (now > dueAt) return "overdue";

  const warningWindow =
    SLA_HOURS[input.priority] * 60 * 60 * 1000 * 0.25;
  return dueAt - now <= warningWindow ? "at_risk" : "on_track";
}

export function formatSlaDistance(
  dueAt: string | Date,
  now: string | Date = new Date(),
) {
  const milliseconds = new Date(dueAt).getTime() - new Date(now).getTime();
  const overdue = milliseconds < 0;
  const absoluteMinutes = Math.max(
    1,
    Math.round(Math.abs(milliseconds) / 60000),
  );
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  const duration = hours
    ? `${hours}h${minutes ? ` ${minutes}m` : ""}`
    : `${minutes}m`;
  return overdue ? `${duration} overdue` : `${duration} remaining`;
}
