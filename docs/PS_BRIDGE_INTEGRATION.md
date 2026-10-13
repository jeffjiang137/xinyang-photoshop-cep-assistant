# PS 桥接集成

左侧“桥接” → “启动桥接”。启动成功后，原 psMCP 客户端可按现有本机地址及令牌文件连接。旧桥接占用端口时，请先在旧插件中停止桥接。

生产代码来自用户已安装的 `com.edy.codex.photoshop`，仅迁入 PS 桥接相关 runtime、planner、OCR 和宿主命令，不包含素材、日志、访问令牌及历史任务脚本。

- 面板：`js/modules/bridge/panel.js`，按需加载并挂载到现有导航。
- 服务：`js/modules/bridge/service.js`，HTTP 鉴权、连接生命周期及任务路由。
- 任务运行时：`js/modules/bridge/runtime/`、`planner/`。
- 宿主：`jsx/modules/bridge/commands.jsx`，注册为 `XinyangHostModules.photoshopBridge` 工厂，通过 `LongStitchCEP.toolsBridgeExecute` 调用。
- 共享 Photoshop 调度：桥接与主面板统一使用 `XinyangRuntime.hostInvoke` 队列。

宿主导入时对 codex/inspect 公共名称进行隔离，并发布专属批处理历史回调。升级原桥接时需保持这些适配，不能直接覆盖。

验证命令：

```powershell
node --test tests/bridge-integration.test.cjs tests/bridge-runtime/*.test.js
node tests/slice-export-visibility.test.cjs
```

详细验证与尚未完成的 Photoshop 实测见 `V2.2.83_TEST_REPORT.txt`。

## MCP 与 CEP 接口

MCP 服务端通过 stdio 向 MCP 客户端注册 Photoshop 工具，再由本机 HTTP 桥接到 CEP 面板。MCP 工具注册和 stdio transport 属于外部 psMCP 服务端；本扩展负责 CEP 面板、HTTP 服务和 Photoshop 宿主适配。

| 用途 | CEP 接口 | 鉴权 |
| --- | --- | --- |
| 连通性探测 | `GET http://127.0.0.1:32123/health` | 无 |
| 运行状态 | `GET /runtime/status` | `x-codex-token` 请求头 |
| Photoshop 命令 | `POST /execute`，JSON `{ "token": "…", "command": { "action": "…" } }` | 请求体令牌或 `x-codex-token` 请求头 |
| 查询任务 | `GET /tasks/{taskId}` | `x-codex-token` 请求头 |
| 取消任务 | `POST /tasks/{taskId}/cancel` | 请求体令牌或 `x-codex-token` 请求头 |

令牌默认位于 `%APPDATA%\CodexPhotoshopBridge\token.txt`，也可用 `PS_CODEX_TOKEN` 或 `PS_CODEX_TOKEN_FILE` 覆盖。MCP 客户端的默认执行地址是 `http://127.0.0.1:32123/execute`，可用 `PS_BRIDGE_URL` 覆盖。

Windows 的 `PrivateMemorySize64` 表示 Photoshop 私有提交量（commit），不是物理内存常驻量。它以 `photoshopPrivateCommitMb` 上报；旧字段 `photoshopPrivateMemoryMb` 保留兼容。任务准入、紧急保护、自动恢复和用户确认根据 Photoshop 工作集及系统可用内存判断。提交量仅作为诊断信号，除非显式开启 `privateCommitAffectsAdmission`。
