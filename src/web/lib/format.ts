export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ACTION_LABELS: Record<string, string> = {
  "user.login": "Signed in",
  "user.login_denied": "Sign-in denied",
  "user.create": "Created user",
  "user.update": "Updated user",
  "me.update": "Updated profile",
  "me.session_revoke": "Revoked session",
  "token.create": "Created token",
  "token.update": "Updated token",
  "token.revoke": "Revoked token",
  "token.delete": "Deleted token",
  "chat.message": "Sent chat message",
  "oauth.client_register": "Registered OAuth client",
  "oauth.client_update": "Updated OAuth client",
  "oauth.client_delete": "Deleted OAuth client",
  "oauth.consent_granted": "Granted OAuth consent",
  "oauth.consent_denied": "Denied OAuth consent",
  "oauth.grant_update": "Updated OAuth grant",
  "oauth.grant_revoke": "Revoked OAuth grant",
  "oauth.grant_delete": "Deleted OAuth grant",
};

export function formatAction(action: string): string {
  return (
    ACTION_LABELS[action] ??
    action
      .replace(/[._]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return "never";
  const diffMs = Date.now() - new Date(value).getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let text: string;
  if (minutes < 1) text = "moments";
  else if (minutes < 60) text = `${minutes}m`;
  else if (hours < 24) text = `${hours}h`;
  else text = `${days}d`;
  return future ? `in ${text}` : `${text} ago`;
}
