# CanIRunAI

**你的电脑，能跑什么本地 AI？**

[打开网页版](https://sggg221.github.io/CanIRunAI/)。支持 **Windows 10 22H2 / Windows 11 x64** 与 **Apple Silicon Mac** 的自动设备检测、模型选型、确认部署和本地聊天。

## 网页 + 本地助手

网页不是云端推理服务。首次启动并配对助手后，网页自动读取本机配置，不用先查显卡型号或手填内存。未连接时仍可浏览模型目录、展开手动示例评估。

1. 安装 [Node.js 24](https://nodejs.org)（最低 22.13）：Windows 选择 x64，Mac 选择原生 Apple Silicon 版本。
2. 从网页下载 **最新版 Windows / Mac 助手**并完整解压。Windows 双击 `Start CanIRunAI Helper.cmd`；Mac 双击 `Start CanIRunAI Helper.command`。不要在 ZIP 预览内运行，也无需管理员权限。
3. 保持助手终端打开。助手自动打开配对网页；按浏览器提示允许本地网络访问。未自动连接时，输入终端中的八位配对码。
4. 网页显示真实系统、CPU、内存、显卡和磁盘，自动更新推荐。点击模型的 **一键部署**，确认下载。缺少运行环境或切换模型时，页面会分别取得同意。
5. 在工作台查看下载、校验、启动、暂停/继续及错误。模型就绪后进行流式文字/图片聊天，也可停止或删除已安装模型。

[助手安装与排障说明](docs/HELPER.md)。这仍是需要 Node.js 的源代码运行包，**不是签名的 Windows 安装程序或公证的 macOS App**。首次安装、系统许可与配对不能被网页绕过。

### Windows 自动检测

- Windows 10 22H2（build 19045+）/ Windows 11，x64 Node.js；不支持 Windows ARM、32 位、旧版 Windows 或 Windows Server 部署。
- 自动读取真实系统版本、设备型号、CPU、总/可用系统内存和助手数据卷可用磁盘。
- 显卡名称来自只读 CIM 查询。NVIDIA 的总/可用独立显存来自驱动 `nvidia-smi`，多张卡分开显示。
- 不把 CIM 的 32 位 `AdapterRAM` 当成准确显存；AMD/Intel 或驱动工具读不到时明确显示未知。检测失败不等于没有显卡，也不会要求用户先填配置才能检测。
- Windows 按系统内存保守推荐，**不将内存与显存相加**，也不将多张显卡显存相加。GPU 加速由 Ollama 和驱动决定，未测量时不显示虚构速度；CPU 推理可能较慢。
- 确认后优先复用已有 Ollama，否则安装官方固定版本的 Windows 便携运行时。下载按固定大小/SHA-256 验证，通过安全解压后才启动。不会自动安装显卡驱动、注册开机启动或关闭安全软件。

### 共用功能

- 中文响应式页面；沿用原项目 27 个精选模型、15 个系列，支持搜索、分类、排序和适配筛选。
- 配对后使用真实设备与资源数据，定期刷新；部署前重新预检。
- 按平台选择运行时，固定模型摘要校验与真实部署状态。**旧版外部 Ollama 不会被强制替换**，需在本机更新/重启。
- 模型启动、停止、删除；模型下载暂停、恢复、取消；失败原因和日志。运行时大归档下载不支持断点续传。
- 本地流式聊天及取消；视觉模型可上传/粘贴 PNG、JPEG、WebP，复用图片压缩、体积和数量限制。
- 授权续期、刷新恢复配对、断开并撤销、过期/离线提示。授权丢失后不会继续提交安装到部署的操作链。
- 其他平台仍可浏览和显示检测结果，但禁用部署。手动评估的默认 16 GB 内存、12 GiB 可用内存、100 GiB 磁盘只是示例。

## 隐私与安全边界

- 助手只监听 `127.0.0.1:31415`，不公开到网络。硬件与聊天在当前网页和本机助手间传输，不上传给 GitHub Pages 或云模型。
- 只有明确允许的 Origin 可以配对。接口检查 Host 和绑定 Origin 的短期令牌，不接受任意命令。`https://sggg221.github.io` 整个 Origin 共享信任边界，不能按仓库路径隔离同源网页。
- 配对码仅放 URL fragment，读取后立即移除，不通过查询参数发送给 Pages。令牌只在 helper 内存和当前标签页 `sessionStorage`，不出现在分享链接或日志。
- 分享链接只含主动分享的配置数值，并保留 Windows/Mac 平台，不含配对凭证。聊天仅在当前页面内存中，刷新、断开或更换聊天模型会清空。
- Windows 本机状态在 `%LOCALAPPDATA%\CanIRunAI`；Mac 在 `~/Library/Application Support/CanIRunAI`。`CANIRUN_DATA_DIR` 可覆盖。模型可能由已有 Ollama 存在其他卷，那个卷也需足够空间。
- 模型和运行时下载需要网络。浏览器可能要求本地网络访问许可；SmartScreen、Defender、Gatekeeper 或管理策略可能要求审核或阻止运行。**不要关闭保护、绕过执行策略或提权来连接。**

## 开发与构建

建议 Node.js 24。构建助手 ZIP 还需 Python 3（Windows 命令为 `python`，其他平台为 `python3`）；助手用户无需 Python。

```bash
npm ci
npm --prefix apps/site ci
npm run helper:package
npm run site:dev       # http://localhost:5173
```

另一个终端启动助手：

```bash
npm run helper
```

开发时在本地网页输入终端配对码。默认自动打开公网网页；设置环境变量 `CANIRUN_NO_OPEN=1` 可禁止自动打开。

```bash
npm test
npm run check
npm run site:build     # 打包匹配源码的助手，再类型检查与构建网页
npm run site:preview
```

`apps/site/dist/` 是静态站点，包含 `downloads/CanIRunAI-Helper.zip`。只有下载并在用户电脑上启动的助手才执行本机操作。浏览目录无需助手或 API 服务。请通过 HTTP(S) 访问，不要直接打开构建后的 `index.html`。

## 发布网站

参见 [部署说明](docs/DEPLOYMENT.md)。Website 工作流在 PR / main 提交时执行 Linux 构建测试及 Windows 助手检查；只有手动选择 `main` 并勾选 `deploy`，且两平台检查通过后才发布。

- 仓库 Settings → Pages → Source：GitHub Actions。
- Actions → Website → Run workflow：`main`，勾选 `deploy`。
- 其他静态托管：`npm ci && npm --prefix apps/site ci && npm run site:build`，输出 `apps/site/dist`，提供 Node.js 24 和 Python 3。

站点与助手应同时发布。ZIP 使用明确白名单和固定时间戳，不含依赖目录、模型、凭证或本机状态。旧的已解压助手不会自动更新，Windows 用户必须下载新版。

## 原本地应用

[原本地运行包 v0.2.0](./CanIRunAI-v0.2.0.zip) 仅供 **Apple Silicon Mac** 使用其自带的 `http://localhost:3000` 网页，**不是 Windows 版，也不支持新版 GitHub 网页配对**。

Mac 用户安装 Node.js 24，解压后双击原 `Start CanIRunAI.command`。这是公网网页被浏览器阻断时的 Mac 本地替代路径，但没有新版工作台。原 ZIP 和校验文件不修改。原架构见 [本地应用文档](docs/LOCAL_APP.md) 和 [中文使用说明](使用说明.md)。

```bash
shasum -a 256 -c SHA256SUMS.txt
```

## 验证范围

自动测试覆盖推荐、Windows/CIM/NVIDIA 解析与失败回退、协议、真实 HTTP 配对/续期/撤销、部署状态机、图文流式输出、配置分享、运行时校验/路径安全，以及助手 ZIP 可复现性与独立启动。

Windows CI 会在 Windows runner 上检查 CMD 启动器、实际系统/CIM 检测与 HTTP 配对，并测试归档安全解压。具体提交是否通过以 PR/Actions 结果为准。**Windows runner 不是用户的 Windows 10/11 GPU 真机**。模拟设备、显卡和 Ollama 响应不等于实际推理验证；尚不能据此承诺 SmartScreen/Gatekeeper 首次运行、真实 NVIDIA/AMD 加速、模型下载推理或所有浏览器的本地网络许可已验证。

目录是历史精选数据，不保证实时同步。“元数据核验 / 推理测试”历史标签不代表当前用户设备实测；实际部署依旧校验固定摘要。历史记录保留于 [VALIDATION.md](VALIDATION.md)。

## 结构

```text
apps/site/                     网页、助手客户端、部署和聊天工作台
apps/bridge/                   硬件检测、运行时、部署和聊天服务
apps/web/                      原 Mac 本地应用前端
packages/                      共享协议、推荐算法、模型及运行时目录
scripts/helper.ts              跨平台助手入口
scripts/package-helper.mjs     白名单、可复现的助手 ZIP 打包
Start CanIRunAI Helper.cmd     Windows 启动器
Start CanIRunAI Helper.command Mac 启动器
tests/                         单元、协议、安全与集成测试
docs/                          安装、开发、部署与原应用说明
```
