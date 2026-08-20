# Workspace Guidelines & Agent Rules

- **Git & Workflow Rules**:
  - NEVER push commits directly to the `main` branch under any circumstances.
  - ALWAYS create a new feature/fix branch for changes and open a Pull Request (PR) for review.
  - Run `npm run typecheck && npm run test` before committing code.

- **Coding & Project Conventions**:
  - Always keep URL search parameters as the single source of truth for page-level state.
  - For Python projects/scripts, always use a virtual environment (`venv`).
  - Follow all guidelines detailed in [`CLAUDE.md`](file:///Users/shinchven/workshop/finance-mcp-server/CLAUDE.md).
