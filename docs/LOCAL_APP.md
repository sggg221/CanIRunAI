# CanIRunAI

Apple Silicon macOS 本地 AI 应用，0.2 版。网页默认使用简体中文，提供硬件适配、模型部署与本地图文聊天。

**Detect → Recommend → Deploy → Chat**

## 启动

需要 macOS Apple Silicon 和 Node.js 22.13+（建议 Node 24）。

第一次双击 `Start CanIRunAI.command`。它会安装项目依赖、构建网页、启动本地网页和 Bridge，然后打开浏览器并用一次性配对码连接。保持启动器终端打开；关闭它将结束本次服务。已有本版网页运行时会复用网页。已有 Ollama 会被自动检测；没有时可在网页中安装固定版本、SHA-256 验证的官方运行时。

开发者也可以执行：

```bash
npm install
npm --prefix apps/web install
npm run dev
```

打开 http://localhost:3000。自动连接未生效时，输入终端显示的 8 位配对码。

## 已实现

- 独立 TypeScript/Zod 协议；严格 action schemas，不接收命令或脚本。
- 精确扫描 Apple 芯片、CPU/GPU 核心、统一内存、系统版本、Metal 信息与可用磁盘。无法可靠获取的参数为 Unknown。
- 27 个模型版本、15 个系列的精选本地目录，2026-09-08 按官方注册表核验。收录 Qwen 3.5 / 3.8、Gemma 4、Granite 4.2 等系列；不等同于 Ollama 全量目录。
- 名称与开发者搜索、视觉/编程/推理分类、适合当前电脑的精选推荐；显示核验日期、图片能力、最低运行时版本及实际推理验证状态。
- 使用官方实际文件大小、GGUF 结构、量化、上下文与固定 SHA-256；混合架构按实际注意力层计算 KV。
- 确定性推荐：权重、上下文 KV cache、运行时开销、系统预留、当前可回收内存、磁盘空间、平台及运行时兼容性。
- 预检、下载、校验、启动、健康检查的持久化部署状态机。Ollama 负责模型层的校验与断点续传；Bridge 负责进度、暂停、恢复、重试和重启恢复。
- My AI：启动、停止、重新部署配置、删除以及模型切换确认。
- 本地流式聊天，可终止回答；视觉模型支持图片上传、粘贴、拖拽、预览及移除。图文记录仅保存在当前浏览器的 IndexedDB，兼容旧版文字记录，关闭保存会删除旧记录。
- 本地 OpenAI-compatible `/v1/chat/completions` 与 `/v1/models`；页面可复制带临时令牌的示例。
- 实测生成速度的快速基准测试，结果只保存在本地。
- 固定版本 Ollama 运行时安装：只下载注册表中的官方归档，在解压前验证 SHA-256。

## 安全边界

Bridge 只监听 `127.0.0.1:31415`。Host 校验防止 DNS rebinding；Origin 仅允许 `http://localhost:3000` 和 `https://canirun.ai`。API 客户端同样需要允许的 Origin 及 Bearer token。

一次性配对码有效 10 分钟，challenge 有效 1 分钟，session 有效 15 分钟。session 绑定 Origin、支持轮换及撤销；页面将 session 放在 sessionStorage，静态本地 secret 不会返回给浏览器。服务端会限制配对尝试频率。支持 HTTPS 页面 localhost 请求仍受具体浏览器的 Local Network Access 策略影响。

Bridge 不提供文件浏览、任意路径读取、终端或任意命令接口。内部硬件检测和运行时安装使用固定可执行文件及固定参数，通过 execFile/spawn 执行，不使用 shell。该 Node 开发版本使用当前用户权限运行，不是操作系统沙箱应用，因此不能宣称进程在操作系统层面完全不能访问文件。

推理仅访问本机 Ollama。注册表中不包含云模型。不配置遥测。下载模型和运行时需要网络，但聊天无需网络。已有 Ollama 是独立服务，其自身的配置和访问边界由 Ollama 管理。

## 数据位置

默认：`~/Library/Application Support/CanIRunAI/`，保存本地 secret、部署状态、基准结果和自行安装的 runtime。设置 `CANIRUN_DATA_DIR` 可变更位置。

模型由 Ollama 管理在其默认模型目录中；删除模型会操作对应 Ollama 模型。取消下载保留可续传分片，不保证立即释放其磁盘空间。图文聊天记录在浏览器 IndexedDB 中。旧版文字记录从 localStorage 兼容读取，保存后迁移；会话令牌仍在 sessionStorage 中。

## 当前范围与限制

此交付是带双击启动器的本地可运行版，需要 Node.js，不是已签名、公证的独立 macOS 安装应用。静默安装、登录启动和原生自动更新尚未提供。

仅支持 Apple Silicon macOS + Ollama。Windows/Linux、MLX、多 GPU 等没有假装支持。当前目录提供经核验的 Q4 / Q8 等本地 GGUF 版本，具体量化以详情为准。每个型号选择一个明确的推荐分发版本，历史已审计修订仅用于识别已有安装。Qwen 3.5、Gemma 4 等已登记视觉模型支持图文输入，文字模型会在界面及 Bridge 双重拒绝图片。支持 PNG/JPEG/WebP，每次最多 4 张、原图单张最多 10 MB；浏览器会将长边缩小至最多 1568px，并重新编码去除原始元数据。发送到 Bridge 的图片单张最多 2 MB。最近 4 张图片保留在视觉上下文中，更早图片仍保留在聊天记录，需重新发送才能再次让模型查看。

缺少可靠带宽与基准数据时不输出虚假的速度范围。当前基准是本机当前模型的一次短生成测试，不代表长期稳定吞吐，也不把小模型测量值套用到其他模型。模型质量分来自人工维护的产品排序，并非公开测评成绩。

模型下载信任固定的官方 manifest 和 Ollama 的逐层完整性验证。若上游可变 tag 改变且不再匹配固定 digest，会失败关闭，需要维护者审查后更新注册表。运行时下载后验证固定 SHA-256；尚未覆盖所有运行时安装失败恢复场景。

此交付作为本地应用运行，未上传 Bridge、会话或硬件信息，也未发布公网网站。网页基于 Sites/Vinext 的 React/Next API 兼容脚手架，保留标准构建配置。

## 验证

```bash
npm test                     # 协议、安全、配对、推荐逻辑
npm run check                # Bridge 和共享包类型检查
(cd apps/web && npm exec tsc -- --noEmit)
npm --prefix apps/web run build
node --import tsx scripts/smoke.ts   # 真实集成测试：下载约 523 MB 模型
```

实际运行证据见 `VALIDATION.md`。单元测试不下载模型；smoke 测试会下载并启动 Qwen 3 Mini。

## 结构

```text
apps/web/                       React UI / Sites Vinext
apps/bridge/                    本地 HTTP Bridge + runtime/deployment manager
packages/protocol/              Zod schemas + TypeScript types
packages/model-registry/         固定模型元数据和校验值
packages/runtime-registry/       固定官方 runtime 版本
packages/compatibility-engine/   内存规划和确定性推荐
scripts/                        启动与实机验证
 tests/                         安全和推荐测试
```

## 核验来源

- https://docs.ollama.com/api/chat
- https://docs.ollama.com/api/pull
- https://ollama.com/library/qwen3:0.6b
- https://github.com/ollama/ollama/releases/tag/v0.33.3
- https://registry.ollama.ai/v2/library/qwen3/manifests/0.6b

注册表抓取日期、manifest digest 及各模型来源保存在 `packages/model-registry/models.json`；原始官方配置与 GGUF 头部证据保存在 `catalog-evidence.json`。

维护者执行 `npm run registry:refresh` 可重新核验 `catalog-seeds.json` 中的全部条目，不下载完整模型。任一抓取失败都不会替换目录。官方新增系列需要维护者补充种子信息再核验；此版本没有后台自动更新或“已覆盖全部最新模型”的承诺。模型修订变化会撤回旧版本的推理实测标识，需要重新执行集成测试。更新目录后重新启动启动器，让前后端同时使用新版本。

## 图片消息 API

使用标准 OpenAI 多模态消息格式。`image_url.url` 仅接受内嵌图片 data URL，不接受远程网址或本地文件路径：

```json
{
  "model": "gemma3-4b",
  "messages": [{
    "role": "user",
    "content": [
      {"type": "text", "text": "图片里是什么？"},
      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,<图片数据>"}}
    ]
  }],
  "stream": true
}
```

Bridge 检查模型能力、图片格式签名、base64 编码、图片数量与体积后，转换成 Ollama REST API 的 `images` 数组。图片只发往 `127.0.0.1:11434`，不上传外部服务器。
