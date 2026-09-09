# 网页与助手发布

`apps/site` 是 React + Vite 静态网站，与原 `apps/web` 界面独立。未连接助手时，在浏览器中进行手动配置评估；配对后使用本机 Bridge 的实际设备数据、推荐、部署和聊天接口。**Pages 服务器不运行 Bridge。**

## 构建与检查

构建机需 Node.js 24 和 Python 3。Python 仅用于生成确定性的助手 ZIP，助手用户不需要安装 Python。

```bash
npm ci
npm --prefix apps/site ci
npm test
npm run check
npm run site:build
npm run site:preview
```

`site:build` 先执行 `helper:package`，从明确的源码文件白名单生成 `apps/site/public/downloads/CanIRunAI-Helper.zip`，然后由 Vite 复制到产物。ZIP 不含 node_modules、模型、聊天、令牌、secret 或运行状态。源码更新后必须重新构建，不能沿用旧版助手下载包。

验证清单：

- 未授权浏览时不主动探测本机；模型目录和展开的手动评估可用。
- 新版助手启动并配对后显示真实设备，不再使用示例参数。刷新网页可恢复未过期授权。
- 非 Apple Silicon 平台、内存或磁盘不足时，部署入口禁用；版本过旧时给出更新提示。
- 部署前明确显示下载大小及上下文，需要环境安装和模型切换时单独取得同意。
- 下载、校验、启动、失败与日志来自真实助手；模拟推理测试必须明确标注，不当作真机证据。
- 模型就绪后可流式聊天；停止生成、图片限制、拒绝远程图片 URL、断开连接清空聊天等行为正常。
- 断开授权立即禁用本机操作并请求撤销；续期不能让并发部署或聊天发送旧令牌。
- 桌面和窄屏对话框无整页横向溢出，键盘关闭与焦点恢复正常。
- 网站及助手 ZIP 可从仓库子目录访问；ZIP 中启动器保留可执行权限。

仅支持 HTTP(S)，不能通过 `file://` 双击构建产物。分享配置使用 `#config?…`，助手启动配对使用 `#pair=…`；配对片段立即移除。两者都不会作为 HTTP 查询参数发送给 Pages，但分享链接本身含有用户选择分享的内存/磁盘数值。

## GitHub Pages

工作流 `.github/workflows/website.yml`：

- `pull_request` 和 `main` 的 `push`：测试、构建、提供名为 `website` 的 artifact，不自动发布。
- `workflow_dispatch`：选择 `main` 并勾选 `deploy` 才会发布。
- 普通构建只读仓库；仅发布 job 具有 Pages 和 OIDC 权限。

步骤：

1. 合并到 `main`。
2. Settings → Pages → Source 选择 GitHub Actions。
3. Actions → Website → Run workflow，选择 `main` 并勾选 `deploy`。
4. 若 environment 要求审批，遵循仓库规则审批。
5. 从部署任务或 Pages 设置获取真实 URL，验证网页以及 `downloads/CanIRunAI-Helper.zip`。

现有入口是 https://sggg221.github.io/CanIRunAI/ 。构建成功不等于最新版本已经上线，需确认发布任务及公网产物。

## 其他托管平台

| 配置       | 值                                                          |
| ---------- | ----------------------------------------------------------- |
| 根目录     | 仓库根目录                                                  |
| Node.js    | 24                                                          |
| Python     | 3，仅构建助手时需要                                         |
| 构建命令   | `npm ci && npm --prefix apps/site ci && npm run site:build` |
| 输出目录   | `apps/site/dist`                                            |
| 预设       | Vite / 静态站点，不是 Next.js                               |
| 云模型密钥 | 无                                                          |

只上传 `apps/site/dist`，并保留 `assets/`、`downloads/`、图标和字体许可。没有 Python 的托管平台可在外部构建后上传完整产物。

Vite 使用相对 base，适用于根路径与子目录。**换域名时必须同时更新助手端显式 Origin 白名单和 `scripts/helper.ts` 的 PUBLIC_SITE，并重新分发助手**。不要使用 `*` 或根据请求动态放行 Origin。Origin 不含路径，GitHub 同一账户下其他同源页面共享信任边界。

## 浏览器与本机连接

助手只绑定 `127.0.0.1:31415`，检测和本机操作需要配对后的短期令牌。网页向本机而非服务器发送硬件请求和聊天，默认访问网页不连接本机，只有用户发起连接、打开助手配对链接或恢复已保存的有效会话时才连接。

HTTPS 公网页访问 loopback 受浏览器本地网络访问策略限制。建议最新版 Chrome / Edge，首次按提示授权；不能承诺 Safari、所有浏览器版本或组织管理策略均可用。不要移除安全保护来实现连接。遇到阻断可使用原本地运行包的 localhost:3000 网页作为另一条路径。

当前助手不是签名、公证的独立 Mac App，首次系统提示与 Node.js 安装仍需用户操作。真实 Mac 验证必须包括首次打开、权限提示、配对、实际模型下载及推理，不可仅凭 Linux HTTP 测试宣布完成。

## 数据维护

目录仍通过 `npm run registry:refresh` 人工更新并审查。元数据变化后要重建网页与助手；固定摘要不符时部署应失败，不得取消校验以让下载“成功”。不要把目录排序当作公开跑分。

原 `CanIRunAI-v0.2.0.zip` 保留给原本地界面，不用于 GitHub 网页配对。新助手由构建流程生成，不覆盖原校验文件。
