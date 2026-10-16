# Kaneo

## 关于本项目

本项目 fork 自 [usekaneo/kaneo](https://github.com/usekaneo/kaneo)，原项目采用 MIT 许可证（原文保留在 [LICENSE-MIT](LICENSE-MIT)）。本仓库采用 Apache 2.0 许可证（见 [LICENSE](LICENSE)）。在原项目基础上新增了**文档（Wiki 页面）功能**：

- **项目内文档目录**：每个项目可以创建树形结构的页面，支持子页面、重命名、移动和删除。
- **实时多人协同编辑**：基于 Yjs 的协同编辑，页面内容通过 `/ws/page/:pageId` 同步；单实例无需 Redis，多实例可选配置 Redis 进行消息中继。
- **富文本编辑**：斜杠命令菜单、图片粘贴/拖放上传（需要配置 S3 兼容存储）、可选择行列数的表格、单元格框选与合并拆分、文字颜色与背景高亮。
- **权限**：页面读写沿用任务的权限规则，只读成员只能查看，不能编辑。

## Docker 部署

> 注意：`compose.yml` 默认拉取的是上游镜像 `ghcr.io/usekaneo/kaneo`，其中**不包含**本仓库新增的文档功能。要使用文档功能，请从本仓库源码构建镜像。

### 1. 准备环境变量

```bash
cp .env.sample .env
```

至少修改以下变量（`.env` 已被 `.gitignore` 排除，不会被提交）：

| 变量 | 说明 |
| --- | --- |
| `KANEO_CLIENT_URL` | 浏览器访问的地址，例如 `http://localhost:5173`。必须与浏览器中的地址完全一致。 |
| `POSTGRES_PASSWORD` | 数据库密码（必填，除非你改用 `DATABASE_URL`）。 |
| `AUTH_SECRET` | 认证密钥，至少 32 位。可用 `openssl rand -hex 32` 生成，生成后保持不变。 |

可选变量：

- **图片上传**：`S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` 等。文档中的图片和任务附件都需要 S3 兼容存储（如 Silo、MinIO），未配置时上传会返回 503。
- **多实例协同**：`REDIS_URL`。单实例无需 Redis。

### 2. 构建镜像

在仓库根目录执行：

```bash
docker build -f Dockerfile.kaneo -t kaneo-wiki:local .
```

### 3. 使用 Compose 启动

`compose.override.yml` 已被 `.gitignore` 排除，适合放本地覆盖配置。在仓库根目录创建该文件，让 Compose 使用刚构建的镜像：

```yaml
services:
  kaneo:
    image: kaneo-wiki:local
```

然后启动：

```bash
docker compose up -d
```

Compose 会同时启动 PostgreSQL（`postgres:16-alpine`，数据保存在 `postgres_data` 卷中）和应用。

### 4. 访问与首次使用

- 打开 `KANEO_CLIENT_URL`（默认 http://localhost:5173）。
- 健康检查：`curl http://localhost:5173/api/health`。
- 第一个非访客账号会完成实例初始化，请在初始化前保持实例不对外开放。

### 5. 常用命令

```bash
docker compose logs -f kaneo   # 查看应用日志
docker compose down            # 停止（保留数据）
docker compose down -v         # 停止并删除数据库卷（会丢失所有数据）
```

### 常见问题

- **浏览器请求失败或 CORS 报错**：检查 `KANEO_CLIENT_URL` 是否与浏览器地址完全一致。
- **实时协同不同步**：如果前面还有反向代理，必须转发 WebSocket 升级头（`Upgrade` 与 `Connection`），并将 `/api/` 路径转发到容器。
- **图片上传 503**：未配置 S3 兼容存储，见上文。

## 许可证

本仓库：Apache License 2.0，见 [LICENSE](LICENSE)。

原项目（usekaneo/kaneo）：MIT License，原文见 [LICENSE-MIT](LICENSE-MIT)。
