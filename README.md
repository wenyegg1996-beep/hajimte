# hajimi-proxy-server

## Zeabur 部署说明

这不是纯前端静态站点，**不要选择 Vite Application Preset**。

本项目是「Express API + Vite 前端构建」的 Node.js 服务：
- 前端只在构建阶段使用 Vite（`pnpm build`）。
- 运行阶段必须启动 Node 进程（`pnpm start` -> `node server.js`）。

### 推荐配置

Zeabur 使用 Node.js 服务（或读取仓库中的 `zbpack.json`）：

- Build Command: `pnpm build`
- Start Command: `pnpm start`
- Node Version: `24.x`

仓库内已提供 `zbpack.json`：

```json
{
  "app_dir": "/",
  "build_command": "pnpm build",
  "start_command": "pnpm start"
}
```

如果误选 Vite Preset，平台通常会把应用当成纯前端/预览服务处理，可能导致后端 API 或启动行为异常。
