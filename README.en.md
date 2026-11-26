# Symbio Agent · Local-First Multi-Agent Collaboration Workspace

[简体中文](README.md) · [Deployment Guide (ZH)](docs/DEPLOYMENT.md) · [Agent Onboarding (ZH)](docs/AGENT_ONBOARDING.md) · [Remote Collector Guide (ZH)](docs/REMOTE_COLLECTOR_GUIDE.md) · [GitHub Integration (ZH)](docs/GITHUB_INTEGRATION.md)

**Symbio Agent** is an independently built, local-first workspace where human teammates and AI agents (Codex, Pi, and observed CLI runtimes) collaborate inside an interactive **3D digital office**. It unifies spatial office building, desk assignment, squads, Skills, MCP tools, task boards, multi-round meetings, shared file review, and three-tier token budgets. All state and run events live in local SQLite and stream to browsers in real time over SSE.

---

## Highlights

- **3D Digital Office & From-Scratch Space Builder**: Extend the built-in office layout or switch to **From-Scratch Custom Space** (`24m × 20m` architectural grid) and build an office in three steps: (1) draw orthogonal walls & `1.4m` doorways with magnetic corner/T-junction/box-alignment snapping (`Alt` to bypass), (2) lay multi-material floor slabs (`carpet`, `wood`, `stone`, `sage`) or autofill from drawn wall bounds in one click, and (3) place workstations (`D-01..`), 4 functional zone fixtures (boss desk, reception counter, conference table, break table), area rugs, and 8 decor items. Includes 2D A\* obstacle/doorway pathfinding, 24-hour dynamic lighting, and independent randomized break scheduling.
- **Runtime Discovery & Remote Collection**: Auto-scans local PATH/processes and pairs remote hosts via the standalone `symbio` (`symbio-agent-collector`) CLI, recognizing Codex, Pi, Claude Code, Gemini CLI, OpenCode, Aider, Cursor Agent, Copilot CLI, Qwen Code, Kiro CLI, OpenClaw, WorkBuddy, and Antigravity. Connecting a runtime is decoupled from creating staff so multiple agents can share one runtime.
- **Organization, Skills, MCP & GitHub Governance**: Manage mixed human/AI squads, download commit-pinned Skills from public catalogs or import `SKILL.md`, configure Streamable HTTP / stdio MCP tool allowlists, grant repo-scoped GitHub access, and safely delete squads, skills, MCP servers, labels, and custom properties with atomic cascading cleanup and audit logs.
- **Task Flow, Meetings & Three-Way Delivery Review**: Switch between board, list, and table views (with CSV export), schedule one-time dispatches, break down subtasks, `@mention` humans or agents in threads, escalate 2-person chats into 3+ meeting room rounds, and approve shared project deliverables with baseline/current/draft three-way diff and conflict detection.
- **Three-Tier Token Budgets & Local Security**: Enforce company, squad, and individual token allowances with pre-run reservations; bind to `127.0.0.1` by default with admin/member role isolation and read-only / run-directory sandbox modes.

---

## Getting Started

### Prerequisites & Launch

Requires **Node.js 22.13+**. Install dependencies, build the landing/guide page, and start the workspace:

```sh
npm install
npm start
```

Open:

- **Product Overview & Interactive Guide**: `http://127.0.0.1:4317/` (source in `apogee/`; run `npm run dev` for Vite preview or `npm run build` to compile)
- **Symbio Local Workspace**: `http://127.0.0.1:4317/office`

On first startup, Symbio seeds a default development squad, a delivery-checklist skill, and initial staff profiles, and walks you through creating the first administrator account.

### Registration, Email Verification & SMTP

Both the first administrator and subsequent members verify an email code during registration. Members request access via **Register** on the login page, and administrators approve, change roles, or disable accounts under **Settings → Workspace Management → Accounts and Permissions**. Users can opt in to `@mention` email alerts under **Settings → Notifications** (off by default; in-app inbox notifications are always delivered).

Configure SMTP in `.env` at the repository root (or process environment) before running `npm start`:

```dotenv
OFFICE_SMTP_HOST=smtp.example.com
OFFICE_SMTP_PORT=587
OFFICE_SMTP_FROM=workspace@example.com
OFFICE_SMTP_USER=workspace@example.com
OFFICE_SMTP_PASS="your SMTP authorization code"
```

Port 587 uses STARTTLS by default; port 465 uses implicit TLS (`OFFICE_SMTP_SECURE=1` enables implicit TLS on other ports). Verification codes expire after 10 minutes with a 60-second cooldown per address.

### Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `OFFICE_PORT` | `4317` | Local HTTP port (IPv4 loopback) |
| `OFFICE_DATA_DIR` | `./data` | SQLite database, skill packages, project files, and run workspaces |
| `OFFICE_CONCURRENCY` | Runtime setting (initially `3`) | Overrides maximum concurrent runs |
| `OFFICE_CODEX_BIN` | `codex` | Path to Codex CLI |
| `OFFICE_PI_BIN` | `pi` | Path to Pi CLI |
| `OFFICE_PI_PROVIDER_EXTENSION` | Unset | Optional absolute path to a trusted Pi provider extension |
| `OFFICE_COLLECTOR_PORT` | `OFFICE_PORT + 1` (`4318`) | Dedicated remote collector port (`0` to disable) |
| `OFFICE_COLLECTOR_HOST` | `127.0.0.1` | Collector listen address |

> Run one service instance per data directory. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for daemon setup, upgrades, backups, and recovery.

---

## 3D Digital Office & From-Scratch Space Builder

### Live 3D Office (`Digital Office → Office`)

- **Avatars & Live Presence**: Choose from 8 3D avatars with live pose previews. Characters reflect active task execution, thinking, review, face-to-face chats, and meeting room discussions in real time.
- **Fixed Seats**: Reception stays at the reception desk; the human boss linked to the current administrator occupies the private office.
- **24-Hour Dynamic Lighting**: Follows local or configured time zone across dawn, morning, noon, sunset, dusk, and night, with one-click toolbar lighting previews.
- **Independent Staggered Breaks**: Each idle staff member has an independent randomized timer (30–60 min idle → 5–10 min lounge break) so characters never stand up in synchronized waves; new tasks or meetings immediately recall them.

### Free Decoration & From-Scratch Space Builder (`Space & Workstations → Free Decorate`)

Switch seamlessly between **Default Layout Extension** (`default`) and **From-Scratch Custom Space** (`custom`), saved atomically to SQLite and synced across Office, Space Layout, and Workstations:

1. **Step 1 · Draw Walls (Before Floors)**:
   - Draw orthogonal exterior and interior walls on a `24m × 20m` (`0.5m` grid) blueprint canvas in 4 palettes (`sage`, `slate`, `warm`, `plum`).
   - **Magnetic Snapping & Seamless Corners**: Approaching an existing wall corner/segment (`≤ 0.85m`) or distant corner alignment axis (`≤ 0.72m`) magnetically snaps with a glowing ring, beacon pillar, and alignment guide; L-corners and T-junctions merge seamlessly across wall body, top cap, and baseboard with zero gaps. Hold `Alt` (`Option` on macOS) to temporarily disable snapping.
   - **Doorways & Demolition**: Click any custom wall to cut a passable `1.4m` framed doorway (or use one-click centered doorway in the inspector); A\* pathfinding routes cleanly through doorways.
2. **Step 2 · Lay Floors & Area Rugs**:
   - Drag rectangular floor slabs in 4 procedural materials (`carpet`, `wood`, `stone`, `sage`) with corner/edge snapping, or click **Autofill Floor from Walls** to cover the wall bounding box in one click.
   - Add 4-color area rugs (`sand`, `sage`, `slate`, `terracotta`) that never block walking or furniture placement.
3. **Step 3 · Place Workstations, Functional Zones & Decor**:
   - Furniture and rugs require floor coverage beneath their footprint and show real-time green/red collision previews.
   - Includes assignable `desk` workstations (`D-01..`, protected when occupied), 4 functional zone fixtures (`boss_desk`, `reception`, `meeting_table`, `break_table`) that automatically seat corresponding roles/activities in custom mode, and 8 office decor items (`plant`, `bookcase`, `partition`, `cafe_table`, `sofa`, `whiteboard`, `server_rack`, `coffee_station`).
   - **Shortcuts**: `R` rotate 90° · `Delete / Backspace` remove selected · `⌘/Ctrl + Z` undo · `⌘/Ctrl + Shift + Z` redo · `Esc` exit tool · hold `Alt` to bypass snap.

---

## Workspace, Governance & Execution

### Navigation & Tasks

| Group | Entries | Purpose |
| --- | --- | --- |
| Shortcuts | Search (`⌘K`), New Task, Inbox, My Tasks, Chat | Global search, `@mention` alerts, personal tasks, and multi-agent discussions |
| Work | Tasks, Projects, Scheduled Tasks | Board/list/table views (CSV export), project calendar, one-time scheduled dispatch |
| AI Team | Agents, Squads, Skills, Runtime, Discovery | Agent profiles/permissions, teams, skill library, concurrency, and runtime onboarding |
| Digital Office | Office, Space & Workstations | Live 3D office, zone layout, free/from-scratch 3D builder, and workstation roster |
| Footer | Statistics, Settings, Help | Three-tier token ledger, three-column settings, and workspace guide |

### Skills, MCP, GitHub & Safe Deletion

- **Settings** uses a three-column layout across Personal Settings, Workspace Management, Task Configuration, Connections & Extensions (GitHub / MCP), and System Records (last 100 audit events).
- **Atomic Cascading Deletion**: Squads, Skills, MCP servers, labels, and custom properties can be deleted cleanly with confirmation modals; all references across agents, humans, tasks, zones, and budgets are cleaned up atomically and audited.
- **Skills & MCP**: Download commit-pinned skill directories from Anthropic Skills, OpenAI Plugins, Vercel Agent Skills, skills.sh, and SkillsMP (stored under `OFFICE_DATA_DIR/skill-packages/`), or import `SKILL.md` manually. Configure Streamable HTTP (`OFFICE_MCP_*` bearer env refs) or local stdio MCP servers with explicit tool allowlists.
- **GitHub Access**: Connect the host's local `gh` login under **Settings → Integrations → GitHub** with per-repo operation grants that agents can narrow further, fully audited.

### Runtime Discovery & Remote Collector (`symbio`)

```sh
npm install -g symbio-agent-collector@0.2.0
symbio login 'http://127.0.0.1:4318' --run
symbio tasks list --status in_progress --limit 20
```

Remote collectors support discovery reporting and read-only task/agent queries (remote task dispatch is not yet implemented). Offline, unbound machines can be safely deleted from the Collector Machines table while retaining historical runs and audit logs. See [docs/REMOTE_COLLECTOR_GUIDE.md](docs/REMOTE_COLLECTOR_GUIDE.md) and [collector/README.md](collector/README.md).

### Sandboxed Runs, Shared Project Files & Budgets

- Each run executes inside an isolated `data/workspaces/<run-id>` folder (use the built-in **Demo Runner** to validate workflows without consuming tokens).
- Shared project files live in `OFFICE_DATA_DIR/project-space/` (≤ 16 MiB per file; ≤ 100 files / 128 MiB per project). Codex deliverables under `deliverables/` enter **Pending Publication** for baseline/current/draft three-way review and conflict detection.
- **HR** (read-only) can hire new read-only staff via company tools; **Finance** (read-only) can inspect the ledger and adjust squad/individual allowances within the company budget.

---

## Architecture & Verification

```text
HTTP action → SQLite transaction (business state, 3D layout & audit events)
            → dispatch queue → local runner (Codex App Server / Pi JSON / Demo)
            → normalized run events → SQLite → SSE → browser views
```

- `src/`: Node.js ESM backend (HTTP/SSE server, SQLite store, scheduler, runners, 3D layout persistence, GitHub/MCP/Skills/collector)
- `public/`: Workspace web app (Three.js 3D engine, magnetic from-scratch builder, A\* pathfinder, task/project/settings views)
- `apogee/`: Product landing page, interactive 3D demo & usage guide (React + Vite + Tailwind)
- `collector/`: Standalone remote collector & read-only CLI (`symbio` / `symbio-agent-collector`)
- `test/`: Node built-in test runner suite

```sh
npm run typecheck
npm run build
npm test
```

The test suite verifies transaction rollback, concurrent token reservations and idempotent reporting, meeting upgrades/cancellation, role tool permissions, Codex/Pi protocol replay, discovery/remote collector, GitHub integration, skill downloads, shared delivery conflicts, cascading deletion, staggered break scheduling, 3D desk assignment, from-scratch custom space validation, magnetic corner snapping, and A\* doorway pathfinding.
