# 远程机器接入与客户端使用指南

工作台的「发现与接入 → 采集机器」内提供三步接入说明、安装命令与完整可展开指南。流程为安装 npm 客户端、生成 login 命令、输入配对码并持续采集。机器配对后，还需接入运行器，再在智能体中绑定员工。

## 1. 安装客户端

在新电脑安装 Node.js 22.13+，使用运行 Agent 的系统账号执行命令。检查环境：

```sh
node --version
npm --version
```

从公共 npm 安装客户端：

```sh
npm install -g symbio-agent-collector@0.2.0
symbio help
```

也可复制平台显示的 npm 安装命令，从工作台提供的匹配版本归档下载安装。示例：

```sh
npm install --global --registry=https://registry.npmjs.org 'https://office.example.com/collector/v1/collector-package.tgz'
symbio help
```

将示例地址换成实际可访问的地址。若尚未确定地址，先在「接入新机器」表单填写地址，生成相应指令，再依次执行安装和 login。

Windows PowerShell 使用 `npm.cmd` 安装，安装后的命令名为 `symbio.cmd`。全局命令无法找到时重新打开终端，检查 npm 全局安装目录是否在 PATH 中。全局安装目录不可写时，使用当前账号可管理的 Node.js 安装环境或独立脚本。

当前服务会从 `collector/package.json` 与 `collector/office-collector.mjs` 生成只包含这两个公开文件的 npm 归档，不包含工作区数据或配置。`OFFICE_COLLECTOR_PACKAGE_FILE` 可覆盖默认归档。升级客户端源码后重启服务，使下载包与新代码一致。公共 npm 包名为 `symbio-agent-collector`，安装后使用 `symbio` 或 `symbio-cli` 命令。

命令统一使用 `symbio`，可替换为 `symbio-cli`；旧命令 `symbio-agent-collector` 仍可用。已有客户端重新执行平台的 npm 安装命令后即可使用短命令，原有登录与配置共用，无需重新配对。PowerShell 对应 `symbio.cmd` / `symbio-cli.cmd`。

## 2. 配置新电脑可访问的地址

填写采集端的基础地址，不要填写 `/office` 页面或 `/v1/report` 接口。管理端默认端口为 4317，采集端默认端口为 4318。

### HTTPS 直连

例如 `https://office.example.com/collector`。如果使用反向代理，需把 `/collector/v1/*` 转发到采集服务的 `/v1/*`，同时允许下载安装包与配对、状态、上报、任务查询接口。证书必须可被新电脑信任。

### 默认本机监听与 SSH 隧道

默认采集服务监听 `127.0.0.1:4318`，新电脑不能直接访问。先在新电脑打开终端：

```sh
ssh -N -L 4318:127.0.0.1:4318 user@office-host
```

将 `user@office-host` 换成工作台主机的 SSH 用户和地址，保持这个终端运行。在平台地址栏填 `http://127.0.0.1:4318`，然后在新电脑的另一个终端执行安装和 login 命令。新电脑上的 `127.0.0.1` 指它自身，通过隧道才会到达工作台。

### 可信局域网 HTTP

服务端需配置适当的 `OFFICE_COLLECTOR_HOST` 对外监听，并设置 `OFFICE_COLLECTOR_ALLOW_HTTP=1` 后重启。填写可达的 `http://主机IP:4318`，平台会生成带 `--allow-http` 的 login 命令。修改表单中的地址不会自动修改监听、证书、防火墙或反向代理。

## 3. 生成 login 命令并配对

1. 打开「发现与接入 → 采集机器 → 接入新机器」。
2. 填写机器名称、目标机可访问的采集地址和终端类型。
3. 选择任务读取范围，默认为「仅采集」，也可选择「所有项目只读」或「指定项目只读」。
4. 点击「生成 login 命令」。窗口分别显示安装命令、一次性配对码、login 命令和后续运行命令。
5. 在新电脑完成 npm 安装后执行生成的 login 命令，在终端提示时输入配对码。
6. 配对码有效期为 10 分钟且只能使用一次。生成的命令带 `--run`，登录及首次上报成功后持续采集；Ctrl+C 可停止。
7. 在平台确认机器「在线」。选择需要的运行器并点击「接入运行器」，再在「智能体」创建或编辑员工、绑定来源。

```sh
# 示例，实际使用平台生成的地址与命令
symbio login 'https://office.example.com/collector' --run

# 已配对后恢复采集，无需再次输入配对码
symbio run
```

只有配对码出现在配对窗口中，生成的 login 命令不包含长期凭据。客户端在本地保存配对结果。机器在线、运行器已接入和员工授权分别管理。当前远程客户端支持采集与只读任务查询，尚不接受远程任务执行派发。

## 4. 命令速查

以下以 macOS / Linux 命令名为例。PowerShell 使用 `symbio.cmd`。

| 命令 | 用途 |
| --- | --- |
| `symbio help` | 查看命令说明 |
| `symbio login <地址> --run` | 输入新配对码，登录并持续采集 |
| `symbio login` | 沿用保存的地址，输入新配对码，完成首次上报 |
| `symbio run` | 持续采集，Ctrl+C 停止 |
| `symbio run --once` | 只上报一次 |
| `symbio scan` | 只扫描本机，不上报，无需登录 |
| `symbio status --json` | 查看连接、机器状态和授权 |
| `symbio whoami --json` | 查看配对机器身份 |
| `symbio agents list --json` | 查看已上报运行器和实例数量 |
| `symbio tasks list --status in_progress --limit 20 --offset 0` | 按状态分页查询主任务 |
| `symbio tasks list --project <项目ID> --json` | 查询指定项目 |
| `symbio tasks show AG-12 --json` | 按实际任务编号或 ID 查看任务与子任务 |
| `symbio config show` | 查看配置，凭据隐藏 |
| `symbio config path` | 查看配置位置 |
| `symbio config get interval` | 查看上报间隔 |
| `symbio config set interval 30` | 设置上报间隔，允许 5–3600 秒 |
| `symbio config set server <新地址>` | 更改地址；地址变化会清除登录 |
| `symbio config set allowHttp true` | 允许可信局域网 HTTP，服务端也需允许 |
| `symbio logout` | 清除本地登录，保留地址等设置 |

任务查询范围由配对时的授权决定。「仅采集」会拒绝任务查询。可读取任务基本信息和子任务，不提供执行日志、提示词、凭据或共享文件。更改读取范围需要重新配对。

## 5. 配置与日常运行

默认配置保存在 `~/.agent-office/collector.json`，POSIX 系统文件权限为 `0600`。需要多份独立配置时，使用 `OFFICE_COLLECTOR_CONFIG` 指定完整路径。同一配置只运行一个持续采集进程。

默认每 10 秒上报。配置变更会在后续采集周期重新读取。默认心跳下，最后上报约 40 秒后服务器标记离线，较长的上报间隔会延长判断窗口。关闭终端或 Ctrl+C 只停止采集，不清除登录。

长期运行需使用 launchd、systemd 或 Windows 任务计划程序，客户端不会自动安装系统服务。使用 SSH 隧道时，还需保证隧道持续可用。后台服务必须在能够访问所需 Agent 的系统账号及环境下运行。

## 6. 撤销与删除

- **停止采集**：Ctrl+C，或停止你配置的系统服务。登录配置保留。
- **退出客户端**：`logout` 清除本地凭据；不使其他地方保存的凭据失效。
- **撤销配对**：平台立即拒绝此机器的旧凭据，保留记录供检查。
- **删除机器**：清除机器、配对凭据、未使用配对码和该机器的扫描记录，保留任务、执行与审计历史。

删除需要同时满足：非本机、没有近期上报、没有员工当前使用此机器来源、没有排队/执行/停止中的任务引用此机器。暂停员工或关闭执行授权仍属于绑定，必须先改绑。刚撤销但仍有近期心跳的机器也需等待离线窗口。未上报的待配对记录和满足条件的已撤销记录可删除。

平台显示删除受阻原因；提交删除时服务端会再次检查，防止页面打开后机器重新上线。删除后旧客户端不能再次上报，重新加入需生成新配对码。

## 7. 更新与独立脚本

停止采集，重新执行平台生成的 npm 安装命令，然后执行 `run`。安装更新保留当前账号下的配置，机器已删除或撤销时需要重新配对。

无法使用 npm 时，在采集机器区域下载独立脚本并放到新电脑，命令功能相同：

```sh
node office-collector.mjs login 'https://office.example.com/collector' --run
node office-collector.mjs config show
node office-collector.mjs status
```

旧客户端只显示 PID 时，可更新客户端以获得进程名和可选窗口标题。窗口标题受操作系统权限限制，不能当作 Agent 内部会话名称。

## 8. 排障

| 现象 | 处理 |
| --- | --- |
| npm 提示版本不存在 | 使用平台生成的归档安装地址，避免安装尚未发布的公共版本 |
| 命令找不到 | 重开终端，检查全局 npm bin 路径；PowerShell 使用 `.cmd` |
| 连接失败 | 核对采集端口、SSH 隧道、代理、证书和防火墙；不要误用管理页地址 |
| 配对码过期或已使用 | 删除不用的待配对记录，重新生成配对码 |
| 提示已有登录 | 先用 `status` 确认；需换配对时停止采集、logout 后使用新码 |
| 登录已保存但首次上报失败 | 修复连接后 `run --once`，不要重复使用已消耗的配对码 |
| 401 或凭据无效 | 机器可能已撤销或删除，logout 后重新配对 |
| 任务查询被拒绝 | 检查配对时是否只授权采集，以及是否限定了项目 |
| 在线但没有 Agent | 以正确系统账号安装或启动运行器，先 scan 再 run --once |
| 机器离线 | 检查采集进程与网络；已配对时直接 run 恢复 |
| 删除按钮不可用 | 按页面原因停止采集、等待离线、改绑员工或结束活动任务 |
| 远程 Agent 无法执行任务 | 当前远程接入为采集与任务查询，远程执行适配尚未实现 |

服务器配置与常驻部署见 [部署手册](DEPLOYMENT.md)，员工绑定与权限见 [接入与绑定指南](AGENT_ONBOARDING.md)。
