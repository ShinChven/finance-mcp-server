function esc(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PAGE_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: system-ui, -apple-system, sans-serif;
    display: grid; place-items: center; min-height: 100vh;
    background: light-dark(#f4f4f5, #101014); color: light-dark(#18181b, #e4e4e7);
  }
  .card {
    width: min(26rem, calc(100vw - 2rem)); padding: 2rem;
    background: light-dark(#ffffff, #1b1b21); border-radius: 0.75rem;
    border: 1px solid light-dark(#e4e4e7, #2a2a33);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.08);
  }
  h1 { font-size: 1.15rem; margin-bottom: 0.75rem; }
  p { font-size: 0.9rem; line-height: 1.5; color: light-dark(#52525b, #a1a1aa); }
  .client { font-weight: 600; color: light-dark(#18181b, #fafafa); }
  ul { margin: 1rem 0; padding-left: 1.25rem; font-size: 0.9rem; }
  li { margin: 0.3rem 0; }
  .actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
  button {
    flex: 1; padding: 0.6rem 1rem; border-radius: 0.5rem; font-size: 0.9rem;
    cursor: pointer; border: 1px solid light-dark(#d4d4d8, #3f3f46);
    background: transparent; color: inherit;
  }
  button.primary { background: #4f46e5; border-color: #4f46e5; color: white; }
  .muted { margin-top: 1rem; font-size: 0.8rem; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="card">${body}</div>
</body>
</html>`;
}

export function consentPage(options: {
  clientName: string;
  userEmail: string;
  scope: string;
  fields: Record<string, string>;
}): string {
  const hidden = Object.entries(options.fields)
    .filter(([, value]) => value !== "")
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join("\n");
  return page(
    "Authorize access",
    `<h1>Authorize <span class="client">${esc(options.clientName)}</span>?</h1>
<p>This application is requesting access to the MCP server on your behalf.</p>
<ul>
  <li>Scope: <code>${esc(options.scope)}</code></li>
  <li>Signed in as <strong>${esc(options.userEmail)}</strong></li>
</ul>
<form method="post" action="/oauth/authorize/decision">
${hidden}
<div class="actions">
  <button type="submit" name="decision" value="deny">Deny</button>
  <button type="submit" name="decision" value="approve" class="primary">Authorize</button>
</div>
</form>
<p class="muted">You can revoke this access at any time from the OAuth Clients page.</p>`,
  );
}

export function oauthErrorPage(title: string, message: string): string {
  return page(title, `<h1>${esc(title)}</h1><p>${esc(message)}</p>`);
}
