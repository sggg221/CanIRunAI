# CanIRunAI

**你的 Mac，能跑多聪明的 AI？**

面向 Apple Silicon Mac 的本地 AI 模型指南。现在包含两种独立入口：

| 入口                                    | 作用                                                   | 运行条件                              |
| --------------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| **独立网页版** `apps/site`              | 浏览与搜索模型，按手动配置估算适配，查看详情与分享配置 | 现代浏览器；可部署到静态托管平台      |
| **本地应用** `apps/web` + `apps/bridge` | 检测本机、下载和管理模型、本地文字与图片聊天           | Apple Silicon Mac、Node.js 24、Ollama |

网页版不是云端聊天服务，不会自动扫描硬件、连接本机 Bridge 或下载模型。适配计算只在浏览器内完成，配置不上传，无需登录。

## 运行网页版

开发 / 构建需要 Node.js 22.13+，建议 Node.js 24。首次安装需要网络；浏览网站的访客不需要 Node.js。

```bash
npm ci
npm --prefix apps/site ci
npm run site:dev
```

打开终端输出的 `http://localhost:5173`。

```bash
npm run site:build     # TypeScript 检查与生产构建
npm run site:preview   # 预览生产构建
```

静态产物在 `apps/site/dist/`。不需要 API 服务、数据库、云模型密钥或本机 Bridge。请使用 HTTP(S) 服务访问，不要直接双击 `index.html`。

### 网页版功能

- 中文响应式页面，适配桌面、平板和手机。
- 沿用原项目的 27 个精选模型、15 个系列；可按名称、开发者、描述搜索。
- 图文、编程、推理及轻量模型筛选；适配筛选、推荐 / 下载大小 / 名称排序。
- 手动设置统一内存、可用内存和磁盘空间，复用原项目的确定性推荐算法。
- 模型详情展示权重、KV 缓存、运行开销、上下文、最低 Ollama 版本及官方来源。
- 配置链接分享，支持直接打开和刷新恢复；不在浏览器持久存储配置。
- 本地运行包入口、使用指南和常见问题；无伪造聊天或部署按钮。
- 中文字体随站点自托管，无第三方字体请求；支持键盘操作、原生对话框与减少动画偏好。

默认 **16 GB 总内存、12 GiB 可用内存、100 GiB 剩余磁盘**只是示例，不是检测结果。切换总内存时，可用内存暂按 75% 重置，可在高级选项中修改。当前评估范围仅限 Apple Silicon Mac；其他平台可浏览目录，但不会得到兼容结论。

## 部署网页版

详细步骤见 [部署说明](docs/DEPLOYMENT.md)。

### GitHub Pages

仓库包含 `.github/workflows/website.yml`：提交和 PR 自动运行测试及构建，但**不会自动上线**。

1. 合并源码到 `main`。
2. 打开仓库 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。
3. 打开 **Actions → Website → Run workflow**，选择 `main`，勾选 `deploy` 并运行。
4. 成功后从部署任务的 environment 或 Settings → Pages 获取真实访问地址。

此文档不表示网站已经部署。工作流仅上传 `apps/site/dist/`，不会发布 Bridge、本地会话或整个源码目录。

其他静态托管平台使用以下配置：

- 项目根目录：仓库根目录。
- 构建命令：`npm ci && npm --prefix apps/site ci && npm run site:build`。
- 输出目录：`apps/site/dist`。
- Node.js：24。

## 下载与启动本地应用

**[下载完整本地源码运行包 v0.2.0](./CanIRunAI-v0.2.0.zip)**。原有 ZIP 与 SHA-256 校验文件保持不变，它们不包含新增的独立网页版。

1. 在 Apple Silicon Mac 安装 Node.js 24，解压 ZIP。
2. 双击解压目录内的 `Start CanIRunAI.command`。
3. 首次运行安装依赖并构建本地网页，随后打开 `http://localhost:3000`。
4. 需要手动配对时，输入启动终端显示的 8 位配对码。保持终端运行。

完整本地应用说明见 [本地开发与安全边界](docs/LOCAL_APP.md) 和 [中文使用说明](使用说明.md)。本仓库已将原压缩包内的源码解出纳入 Git，排除了生成缓存，可直接审查与修改；没有将本地应用改成公网服务。

这是需要 Node.js 的本地运行包，尚不是签名、公证的独立 macOS `.app`。模型权重按需下载，不包含在压缩包中。

```bash
shasum -a 256 -c SHA256SUMS.txt
```

## 验证与范围

```bash
npm test             # 原有 22 项测试 + 8 项网页版测试
npm run check        # Bridge、共享包和测试类型检查
npm run site:build   # 独立网页版类型检查与生产构建
```

新增测试覆盖 URL 参数校验、分享链接、搜索 / 分类 / 排序、不同内存配置、无磁盘 / 无可用内存、未支持平台以及不虚构运行速度。网页构建不依赖原本地前端的 Vinext / Cloudflare 开发环境。

网页目录沿用原项目记录的模型信息，**不承诺实时更新或全量覆盖**。详情中区分元数据核验与推理测试记录，没有把它们当作当前用户电脑的实测结果；本次网页版工作没有重新下载并测试全部模型。综合推荐是内置启发式排序，不是公开质量跑分。运行时版本、实际空闲内存和其他应用会影响本地运行结果。

原本地运行包的历史验证记录保留在 [VALIDATION.md](VALIDATION.md)，其中的日期、环境限制和测试结论仅对应该次交付。

## 目录

```text
apps/site/                     独立 React + Vite 静态网站
apps/web/                      原本地应用网页
apps/bridge/                   本机硬件、部署与聊天服务
packages/compatibility-engine/  共用的内存估算与推荐算法
packages/model-registry/        原项目精选模型目录
packages/protocol/              类型与协议校验
scripts/                       本地启动与原目录刷新工具
tests/                         本地应用与网页版测试
docs/                          本地应用说明、静态网站部署指南
```
