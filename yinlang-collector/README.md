# 音浪采集服务（Render 独立服务）
- 使用开源 DyHub，固定到 2026-11-03 的提交 `21251a1150b7320abaac7ab8222cfa6856abcee2`。
- 端口 $PORT 是限制访问的桥接服务器，DyHub 管理端仅绑定 127.0.0.1:8757。
- `COLLECTOR_TOKEN` 是桥接鉴权密钥，不要公开。
- 配置 `DYHUB_COOKIE` 后才可能接收到抖音完整礼物事件；不要将账号 Cookie 发到聊天、代码仓库或公开网页。请自行在 Render 的 Environment 中配置并理解会话泄漏风险。
- Render Free 会休眠且丢失未持久化数据。禁止把样例值当成完整官方音浪。
- 配套音浪网页需配置 `DYHUB_URL=https://<collector-host>` 和相同 `DYHUB_TOKEN`。