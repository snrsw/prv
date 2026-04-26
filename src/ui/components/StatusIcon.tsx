import type { Status } from "../types";

const STATUS_TITLE: Record<Status, string> = {
  added: "Added",
  deleted: "Deleted",
  modified: "Modified",
  renamed: "Renamed",
};

export function StatusIcon({ status, size = 16 }: { status: Status; size?: number }) {
  return (
    <svg
      className={`status-icon status-icon-${status}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={STATUS_TITLE[status]}
    >
      <title>{STATUS_TITLE[status]}</title>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      {status === "added" && (
        <>
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </>
      )}
      {status === "deleted" && <line x1="9" y1="15" x2="15" y2="15" />}
      {status === "modified" && (
        <path d="M14 13.5a2 2 0 0 0-2.83 0l-4 4-1 4 4-1 4-4a2 2 0 0 0 0-2.83z" />
      )}
      {status === "renamed" && (
        <>
          <line x1="9" y1="15" x2="15" y2="15" />
          <polyline points="13 13 15 15 13 17" />
        </>
      )}
    </svg>
  );
}
