# 抖音直播神秘人观察页

## 不用 Railway：改用 Render（一键 Blueprint）

GitHub 仓库根目录已经准备好 [render.yaml](../render.yaml)，所以不需要复制项目或填写构建命令。

1. 打开 https://dashboard.render.com/blueprints ，用 GitHub 登录 Render。
2. 点击 **New Blueprint**，连接 **sggg221/CanIRunAI**（Branch: main）。
3. Blueprint Path 保持 `render.yaml`；页面会识别一个免费 Docker Web Service，根目录 `douyin-mystery`。
4. 按提示在 **DASHBOARD_TOKEN** 输入自己生成的、至少 16 字符的私有口令（请勿发给其他人）。
5. 点击 **Deploy Blueprint**，等服务状态显示 `Live`，打开分配的 `*.onrender.com` 网址。
6. 在网页里输入直播间和前一步的口令，点击 **开始监听**。

Render 免费 Web Service 在约 15 分钟没有入站访问时可能休眠，重新访问需要冷启动；休眠、服务器重启会清空本次监听记录。建议仅用于测试，不适合作为全天候采集服务。


本目录是一个**独立单功能网页**，在直播进行中读取 WebSocket 消息里标注为神秘人或匿名用户的事件，展示协议返回的昵称、secUid、消费等级和进场/弹幕/礼物事件。不能保证这些字段是真实账号，更不能得出现实身份。没有跨房间关联或去匿名化数据库。

## 部署到 Railway

1. 打开 https://railway.com/new ，登录后选择 Deploy from GitHub Repo。
2. 选择仓库 sggg221/CanIRunAI（本目录不影响原站）。
3. 新服务的 Settings → Root Directory 设为 **/douyin-mystery**，使用本目录的 Dockerfile 构建。
4. 在 Variables 添加 **DASHBOARD_TOKEN**，值为**你自己生成的随机口令（至少 16 字符）**。口令不要放进 GitHub，也不要在聊天中发送。
5. 部署成功后在 Settings → Networking → Generate Domain 生成 HTTPS 地址。打开这个 **Railway 地址**，输入数字直播间号和口令，点击开始监听。

GitHub Pages 只能预览网页外观，不能运行 Python 后端或直播 WebSocket。实时查询必须从 Railway 地址打开。

## 注意事项

- 无需 macOS，Windows 和 iPhone 都可通过浏览器使用。
- API 需要 Bearer 口令；后端未设置口令会拒绝启动。事件保存在内存中，最多 150 条，不写入数据库。
- 上游依赖 [douyin-kekemi-public](https://github.com/kkray983681062-bit/douyin-kekemi-public) 的 mystery_hunter.py，Docker 在部署时拉取其固定 Git 提交。该独立脚本称无需 Cookie，但抖音接口、签名或风控变化可能导致无法连接。
- 仅用于有权访问的直播数据，避免公开披露或试图揭示用户主动隐藏的私人身份；secUid 不是实名。
- 开始监听后如果没有数据，不代表直播间没有匿名用户。需核对开播状态、连接状态、服务器日志。
