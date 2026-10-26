# 自己部署 Akasha

[English](deploy.md)

Akasha 只是一个前端，资料都存在你自己的 Paperless-ngx 里。想给自己家用，需要：

**硬件**
- 一台常开、能跑 Docker Compose 的设备：NAS（绿联、群晖、威联通、Unraid 等）、小主机或家里的服务器。
  发布的镜像是 `linux/amd64`；ARM 设备请自己 `docker build .`。
- 内存 4 GB 以上。Akasha 本身约 30 MB，Paperless 加 Postgres、Redis 约 1 GB。
- 磁盘：镜像约 1 GB，加上资料本身。
- **备份。** 这里会存身份证、保单这些重要资料。正式使用前先把 Paperless 的数据卷备份好
  （移动硬盘、另一台 NAS 或网盘），RAID 0 或单盘的 NAS 尤其要做。

**软件**
- Paperless-ngx 2.x 或更新版本。示例 compose 会一起装好；已有的 Paperless 也能直接用。
- 可选：一个 OpenAI 兼容、能看图的 AI 接口，用来自动识别照片（标题、家人、类别、到期日、要点）。
  照片会发给这个服务商，请选你信得过的。
- 可选：域名和 HTTPS，用于在外面访问。手机"添加到桌面"需要 HTTPS。
  用 Cloudflare Tunnel 不需要开端口。

## 步骤

1. 下载并填好 `.env`：
   ```sh
   git clone https://github.com/jianhengLiu/akasha && cd akasha
   cp .env.example .env
   ```
   填好标了 `required` 的几项：`PAPERLESS_SECRET_KEY`、`PAPERLESS_DBPASS`、
   `PAPERLESS_ADMIN_PASSWORD` 和 `AKASHA_SECRET`（都可以用 `openssl rand -hex 32` 生成）。
   `AKASHA_SECRET` 定下来就不要改，改了所有人要重新登录，保存的 AI 密钥也读不出来了。
2. 启动：
   ```sh
   docker compose -f docker-compose.example.yml up -d
   ```
   在 NAS 上也可以把 compose 文件内容贴进 Docker 的"项目"页面。已经有 Paperless 的话，
   删掉 `broker`、`db`、`paperless` 三个服务，把 `PAPERLESS_URL` 改成它的内网地址，
   例如 `http://192.168.1.10:8000`。
3. 检查：打开 `http://<设备IP>:3100/api/health`，应该显示 `{"ok":true}`。
4. 打开 `http://<设备IP>:3100`，用 Paperless 管理员账号登录。在 **设置** 里点 **初始化**
   （创建默认类别和家人，想改默认值可以先改 `AKASHA_DEFAULT_*`）。用 AI 的话，在设置里填上密钥。
5. 家人在登录页点 **申请账号**，你在设置里通过，并选"这是哪位家人"。之后通过 Akasha 存的资料
   会自动共享给全家。
6. 可选，外网访问：建一个 Cloudflare Tunnel，运行 `cloudflared`（命令 `tunnel --no-autoupdate run`，
   环境变量 `TUNNEL_TOKEN`），添加一个公共主机名指向 `http://<设备内网IP>:3100`。
   请用一级子域名，例如 `family.example.com`：Cloudflare 免费证书不覆盖 `a.b.example.com` 这种两级子域名。
   如果也要公开 Paperless，记得设置 `PAPERLESS_PUBLIC_URL`。

## 注意事项

- **中国大陆**：NAS 经常拉不到 Docker Hub 和 ghcr.io 的镜像，镜像加速也可能失效。可以在有代理的电脑上
  下载成 tar（`docker pull --platform linux/amd64 … && docker save -o akasha.tar …`，或
  `crane pull --platform linux/amd64 …`），传到 NAS 后用"导入镜像"，重新部署时不要勾"拉取最新镜像"。
  中文 OCR 包也是启动时联网下载的；离线时可以从 [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast)
  下载 `chi_sim.traineddata`，挂载到 `/usr/share/tesseract-ocr/5/tessdata/`，并去掉 `PAPERLESS_OCR_LANGUAGES`。
- **安全**：不要打开 Paperless 自带的注册（不设 `PAPERLESS_ACCOUNT_ALLOW_SIGNUPS`），新账号走 Akasha 的申请审批。
  Akasha 会按 IP 限制登录失败次数，自己不保存任何资料，每次都用登录用户自己的令牌访问 Paperless。
- **意见反馈**：想把意见收成 GitHub issue，设置 `AKASHA_GITHUB_TOKEN`（细粒度令牌，只给一个仓库
  "Issues 读写"权限）和 `AKASHA_FEEDBACK_REPO`（你自己的仓库）。不设的话存在数据卷的 `feedback.jsonl` 里。
- **更新**：`docker compose -f docker-compose.example.yml pull && docker compose -f docker-compose.example.yml up -d`。
  Akasha 自己的数据（待审批的申请、AI 密钥）在 `akasha-data` 卷里，更新不会丢。

