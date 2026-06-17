# CURV Control

## Phase 1A Static Admin Foundation

This folder contains the first static foundation for CURV Control. It is a responsive admin shell only, created so the backend project can begin from a calm, readable interface structure.

## Current Scope

- Standalone `admin/index.html`
- Shared admin styling in `admin/admin.css`
- Minimal shell behavior in `admin/admin.js`
- Responsive desktop sidebar and mobile navigation
- Placeholder dashboard cards only

No backend connection exists in this phase.

## Not Connected Yet

The current page does not include:

- Supabase Auth
- PostgreSQL tables
- Row Level Security policies
- Inventory logic
- Recipe logic
- POS logic
- Transactional checkout
- Reporting tools

## Future Plans

Planned backend work may include Supabase Auth, PostgreSQL, RLS, inventory, recipes, POS, transactional checkout, sales reporting, product management, and admin settings.

## Security Warning

This page is not protected. Do not place sensitive business data, credentials, customer details, private links, or operational secrets in these static files.

## Workflow Roles

- ChatGPT and Isaiah: brainstorm, prompt shaping, and implementation direction
- Claude: UX, design, architecture, and logic review
- Codex: targeted file edits only
- GitHub Desktop: review, commit, and push changes when Isaiah approves

Codex must not commit or push changes for this project unless Isaiah explicitly asks.