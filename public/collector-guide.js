export function collectorQuickStart(collector, escape) {
  return `<div class="collector-onboarding">
    <ol class="collector-steps">
      <li><span>01</span><div><strong>先安装客户端</strong><p>在新电脑安装 Node.js 22.13+，再执行下方 npm 命令。</p></div></li>
      <li><span>02</span><div><strong>生成 login 命令</strong><p>点击「接入新机器」，填写新电脑可访问的采集地址和任务读取范围。</p></div></li>
      <li><span>03</span><div><strong>输入配对码并采集</strong><p>执行生成的 login 命令，输入一次性配对码，确认机器在线后接入运行器。</p></div></li>
    </ol>
    <div class="collector-install"><div><span class="description">在新电脑执行 · macOS / Linux</span>
      <pre id="collector-install-command"><code>${escape(collector?.install || '# 点击「接入新机器」，填写可达地址后生成安装命令')}</code></pre></div>
      ${collector?.install ? '<button type="button" data-action="collector-copy" data-id="collector-install-command">复制安装命令</button>' : ''}</div>
    <p id="collector-copy-status" role="status" class="description"></p>
    <p class="description">安装包由本工作台提供，通过 npm 安装，版本与服务端匹配。上方命令采用默认采集地址；请确认新电脑可达，或填写地址后复制生成的命令。PowerShell 使用 npm.cmd。</p>
  </div>`;
}

export function collectorUsageGuide(collector, escape) {
  const code = text => `<pre><code>${escape(text)}</code></pre>`;
  const commands = [
    ['help', '查看全部命令与参数'],
    ['login \'https://office.example.com/collector\' --run', '输入配对码，登录并持续采集；实际地址请使用平台生成的命令'],
    ['login', '沿用配置中的接收地址，输入新配对码；不带 --run 时只完成登录与首次上报'],
    ['run', '使用已保存登录持续采集，Ctrl+C 停止'],
    ['run --once', '扫描并上报一次，适合排障'],
    ['scan', '只扫描当前电脑，不上报、不需要登录'],
    ['status --json', '查看机器连接、状态和任务读取范围'],
    ['whoami --json', '查看当前配对机器身份'],
    ['agents list --json', '查看已上报的运行器及实例数量'],
    ['tasks list --status in_progress --limit 20 --offset 0', '按状态分页查询授权范围内的主任务'],
    ['tasks list --project 项目ID --json', '按项目查询任务'],
    ['tasks show AG-12 --json', '按实际任务编号或 ID 查看任务详情与子任务'],
    ['config show', '查看配置，凭据会隐藏'],
    ['config path', '显示配置文件位置'],
    ['config set interval 30', '设置上报间隔为 30 秒，允许 5–3600 秒'],
    ['config set server \'https://office.example.com/collector\'', '更换接收地址，地址变化会清除登录，需要重新配对'],
    ['logout', '清除当前电脑保存的登录，保留地址等设置'],
  ];
  return `<details id="collector-guide" class="collector-guide" data-discovery-details="collector-guide">
    <summary class="disclosure-chevron" data-discovery-focus="collector-guide">接入与客户端使用指南<span class="description">安装、地址、配对、命令、排障与机器删除</span></summary>
    <div class="collector-guide-body">
      <section><h3>1. 安装与准备</h3><p>在需要采集的电脑上，使用平时运行 Agent 的系统账号安装客户端。支持 macOS、Linux、Windows；要求 Node.js 22.13 或更高版本。</p>
      ${code('node --version\nnpm --version\n' + (collector?.install || '# 在平台填写可达地址后，复制生成的 npm install 命令'))}
      <p>安装完成后执行 <code>symbio help</code>。也可使用 <code>symbio-cli</code>；旧命令 <code>symbio-agent-collector</code> 仍兼容，共用登录与配置。旧客户端重新执行平台安装命令即可获得短命令。PowerShell 使用 <code>npm.cmd</code> 安装，并将客户端命令写作 <code>symbio.cmd</code>。命令找不到时重新打开终端，检查 npm 全局安装目录是否在 PATH 中。全局安装没有写入权限时，使用当前账号的 Node.js 安装环境或下方独立脚本方式。</p></section>
      <section><h3>2. 选择新电脑可访问的地址</h3><p>填写采集服务的基础地址，不要填写网站的 <code>/office</code> 页面，也不要追加 <code>/v1/report</code>。管理页默认端口是 4317，采集端默认端口是 4318。</p>
      <ul><li><strong>HTTPS 直连</strong>：例如 <code>https://office.example.com/collector</code>，反向代理应把此路径转发至采集端，并保留客户端追加的 <code>/v1/*</code> 路由。</li>
      <li><strong>默认本机监听</strong>：在新电脑另开终端建立 SSH 隧道，再填写 <code>http://127.0.0.1:4318</code>。隧道必须保持运行。</li>
      <li><strong>可信局域网 HTTP</strong>：服务器需配置对外监听，并启用 <code>OFFICE_COLLECTOR_ALLOW_HTTP=1</code> 后重启。平台才会生成带 <code>--allow-http</code> 的命令。</li></ul>
      ${code(`ssh -N -L 4318:${collector?.tunnelHost ?? '127.0.0.1'}:${collector?.port || 4318} user@office-host`)}
      <p>将 <code>user@office-host</code> 换成工作台主机的 SSH 用户和地址。新电脑上的 127.0.0.1 指新电脑自身，不能直接代表工作台主机。只修改表单地址不会改变服务器监听、证书或防火墙。</p></section>
      <section><h3>3. 配对与首次登录</h3><ol><li>点击「接入新机器」，填写机器名称、可达地址、终端类型和任务读取范围。</li>
      <li>点击「生成 login 命令」，复制对应命令到新电脑执行，按提示输入配对码。码有效期为 10 分钟，只能使用一次。</li>
      <li>生成的命令带 <code>--run</code>，登录成功后会持续上报。保持终端打开，在机器表中确认「在线」。</li>
      <li>在「发现的运行器」中选择需要的来源并点击「接入运行器」，随后到「智能体」创建或编辑员工并绑定来源。</li></ol>
      <p>机器配对、运行器接入、员工绑定是三个步骤。远程客户端目前提供发现采集与只读任务查询，尚不支持接收远程任务执行派发。</p></section>
      <section><h3>4. 客户端命令速查</h3><p>以下示例在 macOS / Linux 使用；PowerShell 将命令名改为 <code>symbio.cmd</code>。</p>
      <div class="table"><table><thead><tr><th>命令</th><th>用途</th></tr></thead><tbody>${commands.map(([command,description])=>
        `<tr><td><code>${escape('symbio ' + command)}</code></td><td>${escape(description)}</td></tr>`).join('')}</tbody></table></div></section>
      <section><h3>5. 配置、授权与日常运行</h3><p>默认配置位于 <code>~/.agent-office/collector.json</code>。可用环境变量 <code>OFFICE_COLLECTOR_CONFIG</code> 指定独立配置文件，同一配置只运行一个持续采集进程。默认每 10 秒上报，运行中的客户端会在下一个周期读取修改后的配置。</p>
      <p>配对选择「仅采集」时，任务查询会被拒绝；「所有项目只读」或「指定项目只读」仅开放对应任务的基本信息与子任务。更改任务读取范围需要重新配对，运行器和员工权限仍在平台分别管理。</p>
      <p>关闭终端或 Ctrl+C 会停止采集，但保留登录；再次执行 <code>symbio run</code> 即可恢复。默认心跳下，最后上报约 40 秒后会标记离线；更长的上报间隔会延长判断时间。长期后台运行需自行配置 launchd、systemd 或 Windows 任务计划程序，客户端不会自动安装系统服务。</p></section>
      <section><h3>6. 撤销与删除机器</h3><p>「撤销配对」立即使服务器凭据失效；<code>logout</code> 仅清除客户端本地登录。需要彻底移除机器时，先停止客户端、把仍使用此机器的员工改绑到其他来源，并等待离线。</p>
      <p>仅非本机、已无近期上报、无员工绑定且无活动任务使用时可以删除。未上报的待配对记录和满足条件的已撤销记录也可删除。删除会清除机器配对、未使用配对码和扫描记录，保留任务、执行与审计历史；重新加入需要重新生成配对码。按钮不可用时，表中会显示原因。</p></section>
      <section><h3>7. 常见问题</h3><ul>
      <li><strong>连接被拒绝或超时</strong>：检查采集端口、SSH 隧道、反向代理、证书和防火墙；确认没有误填管理页地址。</li>
      <li><strong>配对码过期或已使用</strong>：删除不用的待配对记录，再生成新码。不要再次使用旧码。</li>
      <li><strong>提示已有登录</strong>：先确认 <code>status</code>；确需换配对时停止采集，执行 <code>logout</code> 后使用新码登录。</li>
      <li><strong>登录已保存但首次上报失败</strong>：修复连接后执行 <code>run --once</code>，无需重复消耗配对码。</li>
      <li><strong>凭据无效 / 401</strong>：机器可能已撤销或删除；先 logout，再生成新配对。</li>
      <li><strong>机器在线但没有 Agent</strong>：在当前系统账号下安装或启动运行器，用 <code>scan</code> 检查扫描结果，再执行 <code>run --once</code>。</li>
      <li><strong>已接入但无法派发</strong>：检查执行适配状态；远程执行尚未接入，机器在线不代表可以远程执行任务。</li>
      <li><strong>实例仅显示 PID 或进程名</strong>：旧版本客户端可能未上报名称，窗口标题还受系统读取权限限制。升级客户端或使用后台的独立脚本。</li></ul></section>
      <section><h3>8. 更新与独立脚本</h3><p>停止采集后，重新执行平台提供的 npm 安装命令，再执行 <code>run</code>。更新通常保留当前账号下的配置；如机器已被删除，需重新登录。</p>
      <p>无法从 npm 下载时，使用本区域的「下载独立脚本」，把文件放到新电脑，通过以下命令运行。将示例地址替换为实际采集地址。</p>
      ${code("node office-collector.mjs login 'https://office.example.com/collector' --run\nnode office-collector.mjs status\nnode office-collector.mjs config show")}
      <p>工作台默认从当前客户端源码提供匹配的 npm 安装包，无需等待公共 npm 发布。管理员可用 <code>OFFICE_COLLECTOR_PACKAGE_FILE</code> 指定归档覆盖默认包。下载地址使用你填写的可达地址。</p></section>
    </div>
  </details>`;
}
