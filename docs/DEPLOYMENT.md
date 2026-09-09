# 独立网页版部署

`apps/site` 是 React + Vite 静态网站，与 `apps/web` 的本地应用界面独立。它只读取随站点打包的模型目录，并在浏览器中运行 `packages/compatibility-engine`，没有服务端 API。

## 本地检查

在仓库根目录运行，建议 Node.js 24：

```bash
npm ci
npm --prefix apps/site ci
npm test
npm run check
npm run site:build
npm run site:preview
```

访问终端显示的预览地址，检查：

- 8 GB 与 64 GB 内存配置的可运行模型数量不同。
- 搜索、分类、适配筛选和排序能组合使用，无匹配时出现清除筛选入口。
- 其他平台、0 GiB 可用内存或 0 GiB 磁盘不显示兼容模型。
- 模型详情可通过按钮与 Escape 关闭；手机上不会出现整页横向溢出。
- 分享链接可恢复配置；剪贴板被拒绝时提供手动复制输入框。
- 不启动本地 Bridge 或 Ollama，网页也能正常使用。

仅支持 HTTP(S) 访问；Vite 的 ES 模块构建不能依靠 `file://` 双击运行。静态站点无需服务器路由重写，导航使用页面锚点，分享配置使用 `#config?…` URL 片段。片段不会随 HTTP 请求发送给托管服务器；拿到分享链接的人仍可看到其中的配置，请只分享你愿意公开的数值。

## GitHub Pages

工作流 `.github/workflows/website.yml`：

- `pull_request` 和 `main` 分支 `push`：安装锁定依赖、执行测试和构建，并提供名为 `website` 的可下载 artifact。
- `workflow_dispatch`：默认仅检查；只有选择 `main` 且勾选 `deploy` 才会发布。
- 普通检查只有仓库只读权限；仅发布 job 拥有 Pages 和 OIDC 权限。

首次发布：

1. 将变更合并到默认分支 `main`。
2. 在 GitHub 仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions → Website → Run workflow** 选择 `main`，勾选 `deploy`。
4. 等待 build 与 deploy 成功。如果仓库的 `github-pages` environment 要求人工审批，按仓库规则批准部署。
5. 从部署任务的 environment 链接或 Pages 设置中复制网站 URL，不要将本地预览地址当成公网地址。

后续更新也需手动触发勾选 `deploy` 的工作流。CI 检查成功本身不代表部署完成。需要暂停站点时，在 GitHub Pages 设置中取消发布。

Vite 使用 `base: './'`，产物里的脚本、CSS、图标及字体采用相对路径，兼容仓库子目录和独立域名。仓库根目录及子目录部署均需要验证；如果修改了构建配置，不要将资源路径硬编码为 `/assets/`。

## 其他静态托管

在 Vercel、Netlify、Cloudflare Pages 或其他可托管静态文件的平台设置：

| 配置       | 值                                                          |
| ---------- | ----------------------------------------------------------- |
| 根目录     | 仓库根目录                                                  |
| Node.js    | 24                                                          |
| 构建命令   | `npm ci && npm --prefix apps/site ci && npm run site:build` |
| 输出目录   | `apps/site/dist`                                            |
| 预设       | Vite / 静态网站，不选择 Next.js                             |
| 服务端密钥 | 不需要                                                      |

仅将 `apps/site/dist` 上传或设为站点目录。不要托管整个仓库、`apps/bridge`、本地应用的数据目录或任何会话令牌。部署提供方会有自己的访问日志；本网站代码不采集硬件数据、不配置遥测。

无构建功能的服务器也可使用：在开发机执行构建，把 `apps/site/dist/` 全部内容拷贝到网站目录即可，须包含 `assets/`、`favicon.svg` 和字体许可文件。

## 边界与数据维护

- 不自动检测硬件，不请求 `127.0.0.1`，不提供在线推理或下载控制。
- 示例配置和链接配置均为用户输入，不用于推断实际设备。
- 支持度仅指内存、磁盘和平台估算；不会检测 Ollama 版本或产生实测速度。
- 模型来源、最低运行时版本和历史核验范围在详情中展示；目录不会在浏览器打开时更新。
- 维护模型目录仍使用原项目的 `npm run registry:refresh` 流程，审查差异并运行测试后重新构建与发布。没有在本次网页改造中宣称已重新核验所有上游模型。
- 本地运行包下载链接指向仓库原有 v0.2.0 ZIP；替换下载版本时须一起更新 `apps/site/src/App.tsx`、根 README 与校验文件。
- 字体使用自托管的 Noto Sans SC Variable（OFL-1.1）；许可证随静态站点分发，不依赖第三方字体 CDN。
