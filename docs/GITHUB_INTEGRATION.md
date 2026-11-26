# 工作区 GitHub 集成

管理员连接一次 GitHub 账号，按仓库授予操作。平台派发给 Codex 和 Pi 员工的正式任务默认继承工作区授权。每位员工可以缩小范围或关闭 GitHub 访问。

## 连接本机账号

1. 在运行工作台的系统账号下安装 GitHub CLI，并通过 `gh auth login --hostname github.com` 登录。后台服务的 PATH 找不到 `gh` 时，可配置 `OFFICE_GH_BIN` 为可执行文件的绝对路径并重启服务。登录由 GitHub CLI 管理。[GitHub CLI 登录文档](https://cli.github.com/manual/gh_auth_login)
2. 用管理员账号打开 **设置 → 集成 → GitHub**，点击 **连接本机 gh**。页面显示通过 GitHub API 确认的账号和最近验证时间。
3. 点击 **添加仓库**，填写 `owner/repository`，选择允许的操作并保存。新仓库默认勾选读取。连接本身建立账号绑定，仓库授权逐项添加。
4. 在 **智能体 → 权限设置 → GitHub 授权** 中保留 **继承工作区 GitHub 权限**，或使用 **自定义仓库及操作范围** 选择子集。选择 **禁止访问 GitHub** 可撤销该员工的访问。
5. 创建任务时写明目标仓库和预期交付，派发给有执行授权的员工。可以先用读取任务确认仓库范围，再授权写入操作。项目档案中的 Git 仓库链接供导航使用。

## 可以授权的操作

| 操作 | 平台工具提供的能力 |
| --- | --- |
| 读取代码、Issue 和 PR | 查询仓库与分支 SHA，浏览目录、读取 UTF-8 文件，按页列出 Issue 和 PR 并查看详情。 |
| 创建分支 | 从指定分支的当前提交创建工作分支。省略来源分支时使用默认分支。 |
| 提交代码 | 在工作分支提交多文件文本变更。调用需提供预期分支 HEAD，GitHub 会原子校验。平台要求通过 PR 将改动交付到默认和受保护分支。 |
| 管理 Issue | 创建、编辑、关闭、重开和评论 Issue。 |
| 创建 PR | 从同仓库的工作分支创建 PR，可选草稿。 |
| 合并 PR | 检查 PR 状态、评审、检查项与预期 head SHA 后请求 GitHub 合并。仓库的合并规则继续生效。 |

员工可调用 `github_list_repositories` 查看本次运行的授权。读取单个文本文件上限为 160 KB。一个代码提交最多 24 个文件变更，新增和修改的文本总计最多 256 KB。文件路径相对仓库根目录。提交冲突时，员工需重新读取分支 HEAD 并核对差异后重试。[GitHub 原子提交接口](https://docs.github.com/en/graphql/reference/commits#createcommitonbranch)、[GitHub PR 合并接口](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)

## 权限生效、审计与撤销

- 实际权限取 GitHub 凭据与仓库规则、工作区仓库授权、员工授权的交集。每次调用会确认当前 GitHub 账号和仓库 ID。组织 SSO、归档状态、检查项或 GitHub 权限变化仍可能阻止操作。
- 入队时记录该任务能使用的范围。缩小仓库、员工权限或断开集成后，运行中的任务在下一次 API 请求前按新范围检查。扩大授权应用于新排队的任务。GitHub 已接收的操作以远端结果为准。
- **设置 → 操作记录** 展示 GitHub 调用及结果，可按记录查看账号、执行员工、任务、仓库和操作。分支、提交 SHA 和 Issue / PR 编号随写入结果记录。执行详情同时显示工具调用过程。
- **移除授权** 撤销单个仓库。**断开连接** 清除工作区账号绑定及仓库授权。切换账号时，先断开集成，在 `gh` 中切换到目标账号，再连接并添加仓库。终端的 `gh` 登录由系统账号单独管理。[GitHub CLI 登出文档](https://cli.github.com/manual/gh_auth_logout)
- GitHub 凭据在服务端按需读取，通过 GitHub API 发送。SQLite 保存账号标识、仓库和授权。平台工具覆盖 Codex、Pi 的正式任务，演示、评论回复、会议发言和仅采集来源沿用各自的运行方式。

本机版的授权约束平台工具。独立终端、同一系统账号可访问的凭据和另行授权的 MCP 服务由其各自的环境管理。启用 GitHub 仓库保护时，可将保护规则应用于管理员和集成执行账号。[GitHub 分支保护设置](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

## 多机器部署

多机器版本可把认证来源换为 GitHub App，由服务端按安装范围换取短期令牌。工作区仓库授权、员工范围和审计沿用现有模型。GitHub App 需要在目标仓库安装并授权 Contents、Issues、Pull requests 等对应权限。使用代表用户的令牌时，GitHub 还会检查用户权限。当前版本的认证来源为本机 GitHub CLI。[GitHub App 与 OAuth 的区别](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/differences-between-github-apps-and-oauth-apps)、[代表用户认证](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user)
