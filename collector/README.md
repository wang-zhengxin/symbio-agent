# Symbio CLI

Pair a remote machine with Symbio Agent, discover local agents, and query authorized tasks from the terminal. Requires Node.js **22.13+** and a Symbio server with the `/v1/pair` API (collector 0.2.0 or newer).

The primary command is `symbio`; `symbio-cli` and the legacy `symbio-agent-collector` command are compatible aliases. They use the same configuration and login. The npm package remains `symbio-agent-collector`. Reinstall using the workspace command to upgrade an existing client and add the shorter commands.

## Install

```sh
npm install -g symbio-agent-collector@0.2.0
symbio help
```

Then generate a pairing code and login command in your workspace:

```sh
symbio login 'https://office.example.com/collector' --run
```

Replace the example URL with the collector address reachable from your machine. Enter the one-time code when prompted. Existing installations can run the installation command again to upgrade while keeping their saved login and configuration.

## Pair a machine

1. Install Node.js 22.13+ and the npm package on the new machine. You can also use the installation command under **发现与接入 → 采集机器** (Collector Machines), which downloads a matching archive directly from your workspace.
2. Select **接入新机器** (Connect New Machine). Enter a reachable collector base URL, machine name, shell and task access scope.
3. Select **生成 login 命令**. The dialog provides separate install, login and restart commands plus a one-time pairing code. Install first, then run the generated `symbio login '<address>' --run` command and enter the code when prompted.
4. Codes expire after 10 minutes and work once. Login performs the first report and `--run` continues collecting. Confirm the machine is online, connect its runtimes, then bind employees under Agents.

Example using a workspace-hosted package, replacing the URL with your reachable collector address:

```sh
npm install --global --registry=https://registry.npmjs.org 'https://office.example.com/collector/v1/collector-package.tgz'
symbio login 'https://office.example.com/collector' --run
# Resume later with the saved login
symbio run
```

PowerShell uses `npm.cmd` and `symbio.cmd`; generated commands handle this automatically. `OFFICE_COLLECTOR_PACKAGE_FILE` can override the server's default archive. The default archive contains only the public package manifest and standalone client script. Legacy `join` and `install` token commands remain compatible.

Offline, unused remote machines can be deleted from the workspace. Stop collection first and move any employee bindings to another runtime. Recent heartbeats, current bindings (including paused employees) and active run snapshots prevent deletion. Removing a machine invalidates its credentials and unused pairing code, removes discovery records, and retains task/run/audit history. Rejoining requires a new pairing code.

The complete remote connection and CLI guide is available directly in the Collector Machines panel.

## Everyday commands

```sh
symbio config show
symbio config path
symbio config get server
symbio config set interval 30
symbio config set server https://office.example:4318
symbio login                  # Uses the saved server URL
symbio status --json
symbio whoami
symbio scan
symbio run --once
symbio agents list --json
symbio tasks list --status in_progress --limit 20 --offset 0
symbio tasks list --project <project-id> --json
symbio tasks show AG-12 --json
symbio logout
```

- `tasks list` lists top-level tasks; `tasks show` accepts a task number (using your workspace prefix), numeric number or UUID and includes its subtasks. Pagination allows 1–200 rows, defaults to 50. Status values: `backlog`, `todo`, `in_progress`, `review`, `blocked`, `done`, `cancelled`.
- `agents list` groups discoveries by runtime on this machine and shows instance counts. PIDs are diagnostics, not individual employees; expand a runtime in the workspace to inspect them. Discovery does **not** automatically hire agents or grant remote execution rights. Connect each runtime in the workspace, then create or edit employees under Agents and bind an admitted source.
- Task access is read-only and restricted to the scope selected during pairing. Task summaries, descriptions, acceptance criteria and subtasks are available; execution logs, prompts, credentials and shared files are not exposed by these endpoints. Re-pair to change scope.
- The default scan interval is 10 seconds. `interval` accepts 5–3600 seconds. Offline detection follows the configured heartbeat. A running collector reloads configuration after each interval.
- Configuration is saved to `~/.agent-office/collector.json`, with mode `0600` on POSIX. Use `OFFICE_COLLECTOR_CONFIG` for a separate profile. `config show` hides the credential. Changing `server` clears the old login; `logout` clears local credentials but retains settings. Revoke the machine in the workspace to invalidate all copies of its credential.
- Use HTTPS remotely, or keep an SSH tunnel open to the default loopback receiver. Trusted LAN testing requires the server's `OFFICE_COLLECTOR_ALLOW_HTTP=1` and `login --allow-http` (or `config set allowHttp true`). Requests never follow redirects.
- If a code expires or is consumed before credentials are saved, revoke the awaiting machine and generate another code. If the first scan fails after login, credentials remain saved; fix connectivity and run `run --once`.
- A stopped collector does not reconnect automatically. Use your OS service manager for unattended operation. The SSH tunnel must remain available as well.

Windows PowerShell: use `npm.cmd` to install and `symbio.cmd` for client commands. The standalone download supports the same commands via `node office-collector.mjs <command>`.

See the [deployment guide](https://github.com/wang-zhengxin/symbio-agent/blob/main/docs/DEPLOYMENT.md#5-接入远程采集机器) for network configuration and deployment.

## Desktop agent discovery

WorkBuddy and Antigravity are supported as observed runtimes. The collector checks their command names on PATH, macOS app executables under `/Applications` and `~/Applications`, and common Windows program folders. Set `OFFICE_WORKBUDDY_BIN` or `OFFICE_ANTIGRAVITY_BIN` to an executable at a custom location. macOS AppPorts launcher bundles are recognized. Renderer/helper processes are excluded; instances stay grouped by machine and runtime.

The current source and downloadable script also report `processName` (executable basename only) and optional `windowTitles`. On macOS, titles are queried for discovered PIDs only when screen-reading access is already granted, without prompting. On Windows, the collector attempts to read the main window title. Other systems provide process names. A process can have multiple windows; window titles are not agent conversation names. Empty or inaccessible titles fall back to the process name. Full executable paths, command arguments and conversation bodies are not reported. Titles are limited to eight entries of 160 characters per process. Older collectors remain compatible and continue reporting PIDs until their script is upgraded.

An installed desktop application does not imply it is running, signed in, or able to accept platform tasks. Connecting these providers registers a source only; employees are created separately and may bind these sources in observation mode. Automatic dispatch, task progress and token reporting need dedicated execution adapters and are not implemented for these providers. Upgrade both the server and remote collector before sending these provider identifiers.

Official product references: [WorkBuddy](https://cloud.tencent.com/product/workbuddy), [Antigravity](https://antigravity.google/docs/getting-started?tab=cli).

For the workspace application, visit the [Symbio Agent repository](https://github.com/wang-zhengxin/symbio-agent).
