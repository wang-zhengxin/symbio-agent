# Symbio Agent · Local Workspace

[简体中文](README.md)

Symbio Agent is a local workspace for managing AI agents and human collaborators. The task board, people directory, finance tools, and collaboration views share tasks, run records, and events stored in SQLite. The 3D office shows both face-to-face conversations and group meetings.

## Getting started

Use Node.js 22.13 or newer. Install the dependencies and start the service.

```sh
npm install
npm start
```

Open the landing page or go directly to the workspace. On first startup, Symbio seeds a product development team, a delivery notes skill, and five staff profiles. Create the first administrator account when you open the workspace. [Landing page](http://127.0.0.1:4317/) · [Workspace](http://127.0.0.1:4317/office)

Both administrators and members register with an email verification code. Members select **注册账号** (Register) on the sign-in page. Administrators approve accounts, change roles, or disable access under **设置 → 用户管理** (Settings → User Management). Existing users sign in with their username and password. Users who have yet to link an email address verify one before entering the workspace.

Users can enable email notifications for @mentions under **设置 → 我的账户** (Settings → My Account). Email notifications are off by default. When posting a comment, the author can choose whether to email mentioned users who have opted in. The email includes the comment and a task link. Mentions also appear in the workspace inbox.

Configure SMTP in the project root's `.env` file or in the service environment before running `npm start`. Use a sender address and credentials authorized by your mail provider.

```dotenv
OFFICE_SMTP_HOST=smtp.example.com
OFFICE_SMTP_PORT=587
OFFICE_SMTP_FROM=workspace@example.com
OFFICE_SMTP_USER=workspace@example.com
OFFICE_SMTP_PASS="your SMTP authorization code"
```

Port 587 is the default and requires STARTTLS. Port 465 uses implicit TLS. Set `OFFICE_SMTP_SECURE=1` to enable implicit TLS on another port. For a relay that allows unauthenticated access, omit both the username and password. Verification codes expire after 10 minutes, requests for the same email address are spaced 60 seconds apart, and a service restart requires a new code.

The landing page source is in `apogee/`. Use `npm run dev` to preview it with Vite and `npm start` to test navigation between the landing page and workspace. The landing page uses the Suisse font. [OnlineWebFonts](https://www.onlinewebfonts.com/fonts)

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `OFFICE_PORT` | `4317` | Local HTTP port |
| `OFFICE_DATA_DIR` | Project `data/` directory | Database and run directories |
| `OFFICE_CONCURRENCY` | Workspace setting, initially `3` | Overrides the workspace concurrency limit |
| `OFFICE_CODEX_BIN` | `codex` | Codex CLI path |
| `OFFICE_PI_BIN` | `pi` | Pi CLI path |
| `OFFICE_PI_PROVIDER_EXTENSION` | Unset | Absolute path to a trusted Pi model provider extension entry point |
| `OFFICE_COLLECTOR_PORT` | Workspace port plus one, normally `4318` | Dedicated collector listener. Set to `0` to disable it |
| `OFFICE_COLLECTOR_HOST` | `127.0.0.1` | Collector listen address |

The workspace listens on IPv4 loopback. Run one service instance per data directory. The deployment guide covers initial setup, background services, remote collection, upgrades, backups, and recovery. [Deployment guide in Chinese](docs/DEPLOYMENT.md)

## Workspace

The sidebar provides live monitoring, projects, people, agent management, and layout management. The top search bar finds projects, tasks, and staff. The notification bell opens the inbox. Settings, finance, discovery and onboarding, and collaboration share the same workspace layout.

- **3D office.** Live Monitoring → Digital Office renders an isometric office with WebGL. Choose from eight avatars and preview their animations when creating or editing a human, agent, or onboarding profile. After 30–60 minutes of continuous idle time, an avatar looks for a free break spot and returns to its desk after 5–10 minutes. Tasks and conversations take priority. Two participants sit face to face, and a third participant moves the discussion into the meeting room. Select an avatar or roster entry to see its status and related tasks. The floor plan shows the published custom layout.
- **Workstations.** Layout Management → Workstations shows the same 3D desks and staff assignments. New staff use available desks first. When all desks are taken, the office expands on the right. Administrators can add desks in batches, and both views update together.
- **Projects.** See project progress, the team calendar, and the day's schedule. Projects can have an owner and due date. Tasks can have both a human owner and an agent assignee. Human owners can advance tasks manually and submit them for review.
- **People and agents.** Edit human profiles, filter and export the directory, and set human availability on the profile. Agent Management shows configuration, runs, usage, and pending approvals. Pausing dispatch keeps queued tasks in place and lets active runs finish.
- **Layout management.** Edit zones, capacity, team assignments, and display widgets. Save a draft to continue editing later or publish it to apply the configuration in Live Monitoring.

## Workspace settings

- **General** manages the workspace name, description, operator, and task numbering. Codex and Pi use the workspace context captured when a run is queued. Task history retains its identifiers.
- **Workflow**, **Labels**, and **Custom Fields** let you change board stage names, set a default priority, and classify tasks. Custom fields support text, numbers, and single-select values. Archiving a field preserves existing values.
- **Runs and Collection** manages local concurrency, time limits, default token reservations, and local scan settings. **Organization and Budget** links to people, skills, teams, and the usage ledger.
- **Notifications** controls which review requests, run failures, onboarding requests, and machine outages appear in the inbox. You can mark all notifications as read. **Change History** shows recent administrative actions.
- **Preferences** stores appearance, the default task view, and time zone in the current browser. Search tasks by ID or content, or filter by project, owner, priority, and label. Open a task to see its run history and post comments.

## Agent discovery and onboarding

Open **发现与入职** (Discovery and Onboarding). By default, Symbio scans the local machine at startup and every 10 seconds. Under Runs and Collection, you can change the interval or switch to manual scans. Discovery checks the PATH, common installation directories, and relevant processes visible to the collector's system account. It recognizes Codex, Pi, Claude Code, Gemini CLI, OpenCode, Aider, Cursor Agent, Copilot CLI, Qwen Code, Kiro CLI, and OpenClaw. An installation can be linked to a staff profile across runs, while an observed process is identified for its current launch.

A newly discovered candidate starts in the pending profile state. Fill out a profile manually or select **交给人事** (Assign to HR) to create and start a profile drafting task. The profile includes the name, personality, responsibilities, role, team, skills, and execution permissions. An administrator reviews and approves the draft before the candidate joins the staff roster.

Remote discoveries and already running processes are available in observation mode. Personality and skills stay in the staff profile. For local Codex and Pi installations, an administrator can enable workspace-managed execution during onboarding. Dispatching a task then starts a new session. The collector reports hostname, operating system, installed tools, and process identifiers. Task data, conversations, command arguments, and token usage use their existing execution channels.

## Collect from another machine

The collector is available on public npm as `symbio-agent-collector@0.1.0`. Install Node.js 22.13 or newer on the target machine. [npm package](https://www.npmjs.com/package/symbio-agent-collector/v/0.1.0)

1. Make the collector endpoint reachable from the target machine. With the default loopback listener, open an SSH tunnel on the target machine and keep that terminal running. Replace `user@office-host` with the SSH username and address of the host running Symbio.

   ```sh
   ssh -N -L 4318:127.0.0.1:4318 user@office-host
   ```

2. In the workspace, open **发现与入职 → 配对新机器** (Discovery and Onboarding → Pair New Machine). Enter the machine name and the receiver address as seen from the target machine, then select **macOS / Linux** or **Windows PowerShell**. For the tunnel above, enter `http://127.0.0.1:4318`.
3. Select **生成启动命令** (Generate Launch Command), copy the **首次启动** (First Launch) command, and run it in a second terminal on the target machine. The command includes a pairing key unique to that machine and uses `npx` to download the pinned version. The collector pairs, sends its first report, and keeps running. Look for the machine marked online under **采集机器** (Collector Machines).

Pairing is saved to `~/.agent-office/collector.json`. To resume collection, run the generated **配对后重新启动** (Restart After Pairing) command on the same machine under the same system account. You can revoke a machine's pairing from the workspace. [Remote deployment and troubleshooting in Chinese](docs/DEPLOYMENT.md#5-接入远程采集机器)

For direct HTTPS access, set `OFFICE_COLLECTOR_HOST` on the Symbio host to its LAN IP or `0.0.0.0`, configure a trusted certificate and key with `OFFICE_COLLECTOR_TLS_CERT` and `OFFICE_COLLECTOR_TLS_KEY`, and enter the reachable HTTPS URL when pairing. Set `OFFICE_COLLECTOR_PUBLIC_URL` to prefill that URL. For HTTP testing on a trusted LAN, set `OFFICE_COLLECTOR_ALLOW_HTTP=1` so the generated command includes `--allow-http`.

The collector reads the process table on macOS and Linux and uses PowerShell CIM on Windows. The account and environment running it determine which processes are visible. The end-to-end collection flow has been verified on macOS.

## Run a task

1. Choose or create a staff profile under **组织与员工** (Organization and Staff). Codex requires a signed-in CLI with App Server support. Pi requires a CLI with JSON event mode and a working model provider. Run `pi` and use `/login` to sign in to a provider, or configure a local model. Leave the model field blank to use the runner's local configuration.
2. To try the workflow, select the demo runner for a staff profile. Its events are marked as demo events. It makes no model calls and incurs no token usage.
3. Create a task on the task board with an assignee, acceptance criteria, and any prerequisites. Start the task and open Run Details to see the plan, tool activity, output, artifact paths, and runner errors.
4. A successful run moves the task into review. Dependent tasks can start after it is approved. Failed tasks can be retried, and previous runs remain in history.

Each run uses its own directory under `data/workspaces/<run ID>`. The UI shows that directory and any new files. The Codex sandbox enforces read-only access or writes limited to the run directory. Responsibility and skill descriptions guide agent behavior. HR, finance, and meeting turns run in read-only mode.

Pi handles text tasks and discussions using the profile's personality, responsibilities, and skills. Its runner disables file and shell tools, organization management tools, MCP, and automatic extension loading. If your Pi login depends on a provider extension, set `OFFICE_PI_PROVIDER_EXTENSION` to its absolute entry point path when starting Symbio and enter the corresponding model ID, such as `provider/model`, in the profile. Pi uses the current user's sign-in configuration and runs the extension under the workspace account. Assign tasks that require HR or finance management tools to a Codex agent in the corresponding role.

## Shared project files

- Open the shared workspace from the project list to upload files, preview text, or download previous versions. Uploading to an existing path creates a new version. Project settings can link to an HTTPS Git repository.
- Dispatch captures the project files and approved outputs from prerequisite tasks. Codex reads copies under `.office-inputs/project/` and `.office-inputs/dependencies/` in its run directory. Save deliverables under `deliverables/`, using paths relative to that directory as shared paths. Pi receives a version list and short text excerpts in its prompt, and its text results can be submitted for review.
- Pending Publication shows the delivery and lets reviewers compare the starting version, the current version, and the draft. Approval publishes the files together. If any file has changed since the run began, the reviewer can return the delivery for a rerun or approve it as a new version.
- File contents are stored in `OFFICE_DATA_DIR/project-space/` and version metadata in the SQLite database. Individual files are limited to 16 MiB. Current versions per project are limited to 100 files and 128 MiB combined.

## Project tasks and discussions

- When creating a task, you can schedule a one-time dispatch and select an agent assignee. The task enters the queue at the scheduled time. If prerequisites are awaiting approval or the assignee is paused, dispatch waits until those conditions clear. Open a project's main task board from the project list.
- Use the Subtasks section of Task Details to add or review smaller tasks. A Codex project lead can also create and dispatch subtasks during a run. Subtasks inherit the parent project and are run and reviewed separately. All subtasks must be approved or canceled before the parent can be approved.
- Task Discussion supports posts, replies, and @mentions. Human mentions go to the workspace inbox. Agent mentions queue a reply in the same thread using the agent's budget. Codex can read and post comments during a run. Pi posts a separate comment after producing its task output and can also answer mentions asynchronously.

## HR, finance, and collaboration

- Assign staffing tasks to **HR**, such as hiring a test engineer for the product development team. HR uses organization tools to create regular staff profiles with read-only access by default. Administrators can also configure roles, personalities, responsibilities, skills, teams, and runners directly.
- Assign usage reporting to **Finance**. Finance can query the ledger and adjust team or individual allowances within the company budget. The company budget is configured in the UI. The ledger records tokens reported by runners for each run. The budget is a cumulative internal allowance. Before a run starts, Symbio reserves tokens to enforce the limit, deducts usage as reports arrive, and releases the remaining reservation when the run ends.
- Start a discussion in **Collaboration Sessions** with at least two agents. Two agents start a face-to-face session. Adding a third moves the group into a meeting room. Each agent takes a turn, with each turn queued and metered separately. You can create a follow-up task linked to the discussion. Ending the session cancels queued turns or stops the current turn.
- Each staff member handles one run at a time. Different staff members can work concurrently up to the configured limit. After an unexpected service shutdown, active runs are marked interrupted and pending tasks are rescheduled.

## Data flow and verification

```text
HTTP action → SQLite transaction (state and events)
            → dispatch queue → local runner
            → normalized run events → SQLite → SSE → browser
```

On first load, the browser reads a snapshot, then subscribes to server-sent events from the current cursor. The server replays missed events on reconnection. Run Details shows the latest 300 events. Codex uses the App Server stdio interface and dynamic tools. Pi uses a JSON event stream. Both runners use the same task and finance records for output and usage. [Codex App Server](https://learn.chatgpt.com/docs/app-server) · [Pi JSON event stream](https://pi.dev/docs/latest/json)

Run Details shows the instructions supplied by the workspace, task or conversation input, stage timings, and tool call durations. Timings are based on received events. First output means the first visible text. New runs store the instructions at queue time. For historical runs, instructions are reconstructed from their queued configuration, and timings use the events on record.

```sh
npm test
```

The test suite covers transaction rollback, concurrent token reservations, duplicate reports, meeting upgrades and cancellation, role-based tool permissions, Codex protocol replay, process discovery, machine authorization, and onboarding approval.
