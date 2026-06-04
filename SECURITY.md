# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in **Deepwood DND**, please
report it privately rather than opening a public issue.

- Use GitHub's **"Report a vulnerability"** flow (Security → Advisories) on the
  repository, **or**
- Email the maintainers with the details.

Please include enough information to reproduce the issue: affected version or
commit, environment, steps to reproduce, and impact. We aim to acknowledge
reports within a few days.

Do **not** include live secrets, production data, or third-party personal data
in your report.

## Supported versions

This is a community project under active development. Security fixes are
generally applied to the `main` branch. There is no long-term-support release
channel at this time.

## Secrets and credentials

- **Never commit secrets.** API keys, database passwords, JWT secrets, and
  similar values must come from environment variables (`.env`), which are
  excluded by `.gitignore`. Use `backend/.env.example` and
  `frontend/.env.example` as templates.
- Application and utility scripts read credentials from environment variables
  (for example `YUNWU_API_KEY`, `DASHSCOPE_API_KEY`, `DATABASE_URL`,
  `SECRET_KEY`). They contain no embedded keys.
- If a key is ever committed by accident, treat it as compromised: **rotate it
  immediately**, then remove it from the working tree and, if needed, from Git
  history.

## Scope

Deepwood DND handles user accounts, campaign data, real-time WebSocket traffic, and
file uploads. When contributing, be mindful of authentication/authorization
checks, input validation on uploads and AI-driven parsing, and avoiding the
leakage of identity through transport channels other than the bearer token
(see `docs/architecture/TRANSPORT_AND_AUTH_GUIDE.md`).
