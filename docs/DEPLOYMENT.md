# Symbio 工作台部署手册

## 1. 部署拓扑与准备

工作台采用单机部署。一个 Node.js 进程同时提供 Apogee 首页、工作台、HTTP API、SSE 实时事件和可选的采集入口。Codex 和 Pi 由工作台在同一台机器启动，业务数据与共享文件存放在本地磁盘。

| 入口 | 默认地址 | 用途 |
| --- | --- | --- |
| 首页 | `http://127.0.0.1:4317/` | Apogee 首页 |
| 工作台 | `http://127.0.0.1:4317/office` | 登录、任务、组织与设置 |
| 采集入口 | `http://127.0.0.1:4318` | 客户端向 `POST /v1/report` 上报 |
| SMTP | 由邮件服务商提供 | 注册验证码、老账号邮箱绑定、评论 @ 邮件 |

- 服务端使用 Node.js 24 LTS，或 22.13 及以上的 22 LTS 补丁版本。准备 npm、`curl`、`tar` 和 `sqlite3`。构建机与运行机可使用同一 Node.js 版本。 [Node.js 发布周期](https://nodejs.org/en/about/previous-releases)
- 使用普通系统账号运行服务。需要实际执行任务时，在该账号下安装 Codex 和 Pi 并完成模型登录。服务管理器使用同一账号，确保能读取对应的登录配置和 CLI 路径。
- 为每个实例分配独立的本地数据目录。当前数据库使用 SQLite WAL，数据目录应放在本机文件系统，每个目录只启动一个服务进程。 [SQLite WAL 文档](https://sqlite.org/wal.html)
- 管理端绑定 IPv4 回环地址，并校验请求的 Host 和 Origin。从其他机器访问管理端时用 SSH 转发，当前版本的 @ 邮件链接也使用 `127.0.0.1` 和工作台端口。使用同端口转发可直接打开邮件链接。对公网提供管理端需要先实现外部访问地址、HTTPS 会话和对应的同源配置。

## 2. 准备配置

将完整项目源码放到服务账号可访问的目录，保留 `package-lock.json`、`apogee/`、`public/`、`src/` 和 `collector/`。进入项目根目录。当前机器的目录为 `/Volumes/Samsung/LAI/多agent公司管理`。

```sh
node --version
npm --version
umask 077
touch .env
chmod 600 .env
```

在本机编辑 `.env`，已有部署保留原配置和数据目录。以下是 163 邮箱的示例，发件邮箱和 SMTP 授权码用实际值替换。注册和评论邮件只需要 SMTP。

```dotenv
OFFICE_PORT=4317
OFFICE_COLLECTOR_PORT=4318
OFFICE_COLLECTOR_HOST=127.0.0.1
OFFICE_SMTP_HOST=smtp.163.com
OFFICE_SMTP_PORT=465
OFFICE_SMTP_SECURE=1
OFFICE_SMTP_FROM=your-sender@163.com
OFFICE_SMTP_USER=your-sender@163.com
OFFICE_SMTP_PASS="填入 SMTP 授权码"
```

保管 `.env`、模型登录凭据和机器配对密钥。部署或回滚时单独恢复这些配置，发布包、日志和工单中使用占位符。

| 可选环境变量 | 使用方式 |
| --- | --- |
| `OFFICE_DATA_DIR` | 默认使用项目根目录下的 `data/`。部署目录会随版本切换时，设置固定的绝对路径并沿用现有数据。 |
| `OFFICE_CONCURRENCY` | 可填 1–16，覆盖「设置 → 运行与采集」中的并发设置。省略时由工作台管理。 |
| `OFFICE_CODEX_BIN`、`OFFICE_PI_BIN` | 默认按 `PATH` 查找 `codex`、`pi`。后台运行时可指定绝对路径。 |
| `OFFICE_PI_PROVIDER_EXTENSION` | Pi 登录依赖已安装的模型提供商扩展时，设置为该扩展入口的绝对路径。扩展在服务账号下执行。 |
| `OFFICE_COLLECTOR_PORT` | 默认是工作台端口加一。设为 `0` 可关闭采集入口。 |
| `OFFICE_COLLECTOR_TLS_CERT`、`OFFICE_COLLECTOR_TLS_KEY` | 采集端直接使用 HTTPS 时，指定可读取的 PEM 证书和私钥。 |
| `OFFICE_COLLECTOR_PUBLIC_URL` | 可选，填写目标机器可访问的采集地址，供配对表单预填。 |
| `OFFICE_COLLECTOR_PACKAGE_FILE` | 可选，指向 `npm pack ./collector` 生成的归档。设置后，首次启动命令从采集端下载包。 |
| `OFFICE_SMTP_SECURE` | 465 端口使用直接 TLS。其他端口可用 `1` 指定直接 TLS，未指定时要求 STARTTLS，默认端口为 587。 |

## 3. 安装、构建与首次启动

在项目根目录执行。首页构建依赖包含在开发依赖中，构建阶段一并安装。

```sh
npm ci --include=dev
npm test
npm run typecheck
npm run build
node --env-file-if-exists=.env src/server.js
```

也可在安装依赖后执行 `npm start`，它会自动构建首页再启动。以服务管理器托管时，将构建作为发布步骤，服务启动命令使用上面的 Node.js 入口。

在另一个终端检查 HTTP 入口。端口如有修改，替换下面的 `4317`。

```sh
office_url='http://127.0.0.1:4317'
curl -fsS -o /dev/null "$office_url/"
curl -fsS -o /dev/null "$office_url/office"
curl -fsS "$office_url/api/auth/session"
```

以未登录状态调用会话接口，首次部署应看到 `setup: true`，已有管理员时为 `false`。`emailAvailable: true` 表示应用已加载 SMTP 配置。实际收信需通过下方验证码验收。

1. 打开 [工作台](http://127.0.0.1:4317/office)，使用能收信的测试或管理员邮箱创建首位管理员。已有实例直接登录，旧账号如未绑定邮箱，先验证再进入工作台。
2. 用另一个测试邮箱注册普通成员，在「设置 → 用户管理」启用后登录。验证普通成员可以打开任务和收件箱。
3. 在「运行与采集」检查并发和扫描频率，再到「发现与入职」核对本机候选。按人事流程确认人格、技能、岗位和执行权限后批准入职。先用演示运行器验证任务状态，再用 Codex 和 Pi 验证实际执行。
4. 由成员在「设置 → 我的账户」打开 @ 邮件通知。管理员在测试任务中 @ 该成员，核对站内通知、邮件正文和评论跳转。再取消评论的邮件勾选发一次，核对这次只进入站内收件箱。

## 4. 后台运行

先退出前台进程或停止旧的服务，确认工作台端口已释放，再启用以下任一方式。

### macOS 使用 launchd

在项目根目录执行。以下配置随当前账号登录启动。项目位于外置盘时，启动和升级前确认挂载路径可访问。日志放在用户目录。 [Apple launchd 文档](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)

```sh
umask 077
office_dir="$(pwd -P)"
node_bin="$(command -v node)"
office_label='local.symbio.office'
office_domain="gui/$(id -u)"
office_logs="$HOME/Library/Logs/Symbio"
office_plist="$HOME/Library/LaunchAgents/$office_label.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$office_logs"

cat > "$office_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$office_label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node_bin</string>
    <string>--env-file-if-exists=.env</string>
    <string>src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$office_dir</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${node_bin%/*}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$office_logs/office.log</string>
  <key>StandardErrorPath</key><string>$office_logs/office-error.log</string>
</dict>
</plist>
EOF

plutil -lint "$office_plist"
launchctl bootstrap "$office_domain" "$office_plist"
launchctl print "$office_domain/$office_label"
tail -n 50 "$office_logs/office.log" "$office_logs/office-error.log"
```

维护时用 `launchctl bootout "gui/$(id -u)/local.symbio.office"` 停止，完成后用 `launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/local.symbio.office.plist"` 启动。服务日志由运维按留存周期归档。

### Linux 使用 systemd

以运行 Agent 的普通账号创建 `~/.config/systemd/user/symbio-office.service`，先创建该目录。下面假设项目位于该账号的 `~/symbio`，Node.js 位于 `/usr/bin/node`。安装位置不同时修改 `WorkingDirectory`、`ExecStart` 和 `PATH`。 [systemd.service 文档](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)

```ini
[Unit]
Description=Symbio Agent Office

[Service]
Type=exec
WorkingDirectory=%h/symbio
ExecStart=/usr/bin/node --env-file-if-exists=.env src/server.js
Environment=PATH=/usr/local/bin:/usr/bin:/bin
UMask=0077
Restart=on-failure
RestartSec=5
TimeoutStopSec=60

[Install]
WantedBy=default.target
```

```sh
systemctl --user daemon-reload
systemctl --user enable --now symbio-office.service
systemctl --user status symbio-office.service
journalctl --user -u symbio-office.service -n 50 --no-pager
```

如需在退出登录后继续运行，并在系统启动时拉起服务，可为部署账号启用 `loginctl enable-linger`，以系统权限配置为准。维护时使用 `systemctl --user stop symbio-office.service` 和 `systemctl --user start symbio-office.service`。 [loginctl 文档](https://www.freedesktop.org/software/systemd/man/latest/loginctl.html)

## 5. 接入远程采集机器

1. 目标机器安装 Node.js 22.13 或更高版本，确保可以访问 npm registry 和工作台的采集入口。
2. 在目标机器启动 SSH 转发。将 `deploy@office-host` 替换为工作台主机的实际 SSH 账号和地址。需要同时访问管理页时，在同一命令中加上 `-L 4317:127.0.0.1:4317`。

   ```sh
   ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
     -L 4318:127.0.0.1:4318 deploy@office-host
   ```

3. 在「发现与入职 → 配对新机器」填写名称、接收地址和目标终端类型。默认 SSH 转发使用 `http://127.0.0.1:4318`。复制首次启动命令，保持隧道打开，在目标机器另一个终端以能看到 Agent 进程的账号执行。每台机器使用独立命令。

4. 验收机器在线、安装项和进程可见。远程候选经人事流程批准后作为「仅采集」员工。需常驻时，将 SSH 隧道和后台生成的重启命令交由目标机服务管理器维护，并沿用配对时的账号。

客户端配对信息保存在 `~/.agent-office/collector.json`，也可用 `OFFICE_COLLECTOR_CONFIG` 指定路径。凭据失效时先在工作台撤销旧配对，移走旧配置后重新安装。直接连接采集端时，为其配置局域网监听地址和可信 TLS 证书，客户端使用 `https://采集主机名:4318`。

## 6. 备份、升级与回滚

### 备份

先通知使用者并停止派发，等待执行中和排队的任务处理完毕。可在工作台核对执行状态，或使用以下只读查询。按实际配置设置 `data_dir`。

```sh
data_dir="$PWD/data"
sqlite3 -readonly "$data_dir/office.sqlite" \
  "SELECT json_extract(data,'$.status') AS status, count(*) FROM records
   WHERE kind='run' AND json_extract(data,'$.status') IN ('queued','running','stopping')
   GROUP BY status;"
```

查询无输出时，使用服务管理器停止实例。前台运行时用 Ctrl+C，或向已确认的服务 PID 发送 SIGTERM。等待进程退出。服务关闭时还在执行的任务会中断，排队和到期的定时任务可能在启动时继续派发。

停服后备份整个数据目录。数据库、共享文件对象和执行产物需来自同一次快照。

```sh
umask 077
snapshot="$HOME/symbio-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$snapshot"
test "$(sqlite3 -readonly "$data_dir/office.sqlite" 'PRAGMA quick_check;')" = ok &&
  tar -czf "$snapshot/data.tar.gz" -C "$data_dir" . &&
  tar -tzf "$snapshot/data.tar.gz" >/dev/null &&
  printf 'Backup: %s\n' "$snapshot/data.tar.gz"
```

记录快照时间、应用版本和对应的数据路径。按既定留存周期保管副本，`.env`、模型凭据及 TLS 私钥单独保管。

### 升级

1. 在暂存目录按第 3 节执行依赖安装、测试、类型检查和构建。记录构建用的 Node.js 版本与源码版本。
2. 在维护窗口停止当前服务并备份数据。将新源码、锁文件和构建产物部署到服务使用的目录，保留旧版本副本。服务继续使用原 `OFFICE_DATA_DIR` 和 SMTP 配置。
3. 启动新版本。检查首页、登录、任务、项目文件与实时更新。使用指定的测试账号核对验证码、@ 邮件、Agent 执行及远程采集。
4. 如果需要回滚，先停止新版本，恢复旧版本的源码、依赖和首页构建产物。涉及数据结构或业务数据变化时，同时恢复升级前快照。恢复快照会回退快照之后的写入，保留升级后数据副本供核对。

### 恢复

恢复前保持服务停止。将备份解压到数据目录同级的新目录，校验后再切换。以下命令沿用备份段的 `data_dir` 和 `snapshot`。已有数据移至旁边保留。

```sh
umask 077
restore_dir="$(mktemp -d "$(dirname "$data_dir")/.symbio-restore.XXXXXXXX")"
previous_dir="$data_dir.before-restore-$(date +%Y%m%d-%H%M%S)"
tar -xzf "$snapshot/data.tar.gz" -C "$restore_dir" &&
  test "$(sqlite3 -readonly "$restore_dir/office.sqlite" 'PRAGMA quick_check;')" = ok &&
  test ! -e "$previous_dir" &&
  { test ! -e "$data_dir" || mv "$data_dir" "$previous_dir"; } &&
  mv "$restore_dir" "$data_dir"
```

确认数据归服务账号所有，启动并验证登录、历史任务、项目共享文件下载和执行产物。尽量恢复到原绝对路径，旧执行记录可能保留当时的产物路径。异机恢复时还需配置对应的 CLI、模型登录、SMTP 和 SSH 入口。

## 7. 上线验收与排障

| 验收点 | 通过标准 | 失败时检查 |
| --- | --- | --- |
| HTTP 与首页 | `/`、`/office` 和会话接口可用 | 服务进程、监听端口、工作目录和 `apogee/dist`。 |
| 账号与邮件 | 验证码实际到达，老账号绑定后可进入，普通成员启用后可登录 | `emailAvailable`、SMTP 端口与 TLS、授权码、发件地址及垃圾邮件。重启后需重新获取验证码。 |
| @ 通知 | 勾选推送且收件方开启时收到邮件，可定位到评论。取消推送后仍有站内通知 | 确认明确 @ 到登录账号、收件方邮箱已验证、两个开关均开启。SMTP 失败会重试，最终失败记录在服务日志。 |
| 实时与执行 | 任务执行阶段更新，能查看提示词、输出和用量。Codex 与 Pi 各跑通一条任务 | 确认服务账号的 `PATH`、模型登录、Pi 提供商扩展和预算。浏览器可检查 `/api/events` 长连接。 |
| 远程采集 | `run --once` 返回「上报成功」，控制台机器显示在线 | 检查 SSH 隧道、采集端口、证书和配对密钥。收到 401 时核对密钥是否已撤销。 |
| 恢复演练 | 恢复目录的 SQLite 校验为 `ok`，应用能读取历史任务及共享文件 | 核对备份是否包含完整数据目录、文件权限与原始路径。演练使用独立数据目录，避免向真实用户补发通知或派发积压任务。 |
