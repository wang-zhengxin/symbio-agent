# Symbio Agent Collector

Pair a remote machine with Symbio Agent, discover local agents, and query authorized tasks from the terminal. Requires Node.js **22.13+** and a Symbio server with the `/v1/pair` API (collector 0.2.0 or newer).

## Pair a machine

1. On the Symbio host, open **发现与入职 → 配对新机器** (Discovery and Onboarding → Pair New Machine).
2. Enter the machine name, reachable collector URL and shell. Choose task access: collection only (default), all projects read-only, or one project read-only.
3. Generate a pairing code. Run the generated npm command on the new machine and enter the code when prompted. Codes expire after **10 minutes** and can be used **once**. `login --run` logs in, sends the first scan and continues reporting until stopped.

The generated command pins the matching client version. When the server is configured with `OFFICE_COLLECTOR_PACKAGE_FILE`, npm downloads that archive from the collector endpoint; otherwise it downloads from the public registry. The new server/client must be deployed together. Legacy `join` and `install` token commands remain supported.

For repeated use, install the released version globally or install the matching local `.tgz` from `npm pack ./collector`:

```sh
npm install -g symbio-agent-collector@0.2.0
symbio-agent-collector login https://office.example:4318
# Enter the one-time code when prompted.
symbio-agent-collector run
```

For automation, `login <url> --code <code>` or `OFFICE_PAIRING_CODE` is supported. Prefer interactive input to avoid storing codes in shell history. The generated command never embeds a long-lived token.

## Everyday commands

```sh
symbio-agent-collector config show
symbio-agent-collector config path
symbio-agent-collector config get server
symbio-agent-collector config set interval 30
symbio-agent-collector config set server https://office.example:4318
symbio-agent-collector login                  # Uses the saved server URL
symbio-agent-collector status --json
symbio-agent-collector whoami
symbio-agent-collector scan
symbio-agent-collector run --once
symbio-agent-collector agents list --json
symbio-agent-collector tasks list --status in_progress --limit 20 --offset 0
symbio-agent-collector tasks list --project <project-id> --json
symbio-agent-collector tasks show AG-12 --json
symbio-agent-collector logout
```

- `tasks list` lists top-level tasks; `tasks show` accepts a task number (using your workspace prefix), numeric number or UUID and includes its subtasks. Pagination allows 1–200 rows, defaults to 50. Status values: `backlog`, `todo`, `in_progress`, `review`, `blocked`, `done`, `cancelled`.
- `agents list` groups discoveries by runtime on this machine and shows instance counts. PIDs are diagnostics, not individual employees; expand a runtime in the workspace to inspect them. Discovery does **not** automatically hire agents or grant remote execution rights. Complete the HR review in the workspace.
- Task access is read-only and restricted to the scope selected during pairing. Task summaries, descriptions, acceptance criteria and subtasks are available; execution logs, prompts, credentials and shared files are not exposed by these endpoints. Re-pair to change scope.
- The default scan interval is 10 seconds. `interval` accepts 5–3600 seconds. Offline detection follows the configured heartbeat. A running collector reloads configuration after each interval.
- Configuration is saved to `~/.agent-office/collector.json`, with mode `0600` on POSIX. Use `OFFICE_COLLECTOR_CONFIG` for a separate profile. `config show` hides the credential. Changing `server` clears the old login; `logout` clears local credentials but retains settings. Revoke the machine in the workspace to invalidate all copies of its credential.
- Use HTTPS remotely, or keep an SSH tunnel open to the default loopback receiver. Trusted LAN testing requires the server's `OFFICE_COLLECTOR_ALLOW_HTTP=1` and `login --allow-http` (or `config set allowHttp true`). Requests never follow redirects.
- If a code expires or is consumed before credentials are saved, revoke the awaiting machine and generate another code. If the first scan fails after login, credentials remain saved; fix connectivity and run `run --once`.
- A stopped collector does not reconnect automatically. Use your OS service manager for unattended operation. The SSH tunnel must remain available as well.

Windows PowerShell: use `npx.cmd` for generated npm invocations. The standalone download supports the same commands via `node office-collector.mjs <command>`.

See the [deployment guide](https://github.com/wang-zhengxin/symbio-agent/blob/main/docs/DEPLOYMENT.md#5-接入远程采集机器) for network configuration and deployment.

## Desktop agent discovery

WorkBuddy and Antigravity are supported as observed runtimes. The collector checks their command names on PATH, macOS app executables under `/Applications` and `~/Applications`, and common Windows program folders. Set `OFFICE_WORKBUDDY_BIN` or `OFFICE_ANTIGRAVITY_BIN` to an executable at a custom location. macOS AppPorts launcher bundles are recognized. Renderer/helper processes are excluded; instances stay grouped by machine and runtime.

An installed desktop application does not imply it is running, signed in, or able to accept platform tasks. HR enrollment for these two providers creates read-only, observation-only employees. Automatic dispatch, task progress and token reporting need dedicated execution adapters and are not implemented for these providers. Upgrade both the server and remote collector before sending these provider identifiers.

Official product references: [WorkBuddy](https://cloud.tencent.com/product/workbuddy), [Antigravity](https://antigravity.google/docs/getting-started?tab=cli).
