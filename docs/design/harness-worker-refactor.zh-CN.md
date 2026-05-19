# Harness-Worker 重构计划

- `Status`: done
- `Owner`: TBD
- `Related Design`:
  - [user-isolation-design.zh-CN.md](./user-isolation-design.zh-CN.md)
  - [minimal-architecture.zh-CN.md](./minimal-architecture.zh-CN.md)

## 1. 动机

当前 `apps/harness-worker` 混合了两个职责：
- **薄调度层**：K8s Pod 管理、runtime 选择、SSE 转发
- **harness 运行时**：pi agent 封装、mock executor

重构后拆为两个独立概念：
- `harness/` — 纯 agent 运行时，感知不到调度
- `managed-agent-api/harness-worker/` — 调度模块，决定 runtime

## 2. 目标结构

```
managed-agent/
├─ apps/managed-agent-api/
│  └─ src/harness-worker/          ← 调度模块（原 worker 内）
│     ├─ runtime-selector.ts       ← mock / pi / sandbox
│     ├─ scheduler.ts              ← K8s Pod 生命周期
│     ├─ sandbox-executor.ts       ← Pod 模式 SessionExecutor
│     ├─ pi-executor.ts            ← in-process 调 harness 包
│     ├─ mock-executor.ts          ← 本地 mock
│     └─ transcript-bridge.ts      ← host 缓存桥接
│
├─ harness/                        ← 独立包（纯 agent 运行时）
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ Dockerfile
│  ├─ src/
│  │  ├─ entrypoint.ts             ← 容器入口（曾 sandbox-entrypoint.mjs）
│  │  ├─ cli.ts                    ← CLI 入口
│  │  ├─ executor.ts               ← pi agent 封装
│  │  ├─ session-runner.ts         ← createAgentSession
│  │  └─ extensions/
│  └─ contracts/                   ← 共享类型（原 managed-agent-contracts）
│     └─ index.ts
│
└─ apps/web-ui/                    ← 不变
```

## 3. 文件迁移表

| 当前路径 | 目标路径 | 改动 |
|---------|---------|------|
| `apps/harness-worker/src/runtime/pi-session-executor.ts` | `harness/src/executor.ts` | 类型文件格式 |
| `apps/harness-worker/src/jobs/session-run-job.ts` | `harness/contracts/index.ts` | 合并 managed-agent-contracts |
| `packages/managed-agent-contracts/src/index.ts` | 删除 | 合并入 harness/contracts |
| `apps/harness-worker/sandbox/Dockerfile` | `harness/Dockerfile` | 构建上下文变更 |
| `apps/harness-worker/sandbox/sandbox-entrypoint.mjs` | `harness/src/entrypoint.ts` | .mjs → .ts |
| `apps/harness-worker/src/runtime/sandbox-manager.ts` | `managed-agent-api/src/harness-worker/scheduler.ts` | SandboxManager → Scheduler |
| `apps/harness-worker/src/runtime/sandbox-session-executor.ts` | `managed-agent-api/src/harness-worker/sandbox-executor.ts` | |
| `apps/harness-worker/src/runtime/create-session-executor.ts` | `managed-agent-api/src/harness-worker/runtime-selector.ts` | |
| `apps/harness-worker/src/runtime/mock-session-executor.ts` | `managed-agent-api/src/harness-worker/mock-executor.ts` | |
| `apps/harness-worker/src/http/internal-run-server.ts` | 删除 | API 直调，不再需要 |
| `apps/harness-worker/src/server.ts` | 删除 | 不再作为独立服务 |
| `apps/harness-worker/src/runtime/mount-paths.ts` | 拆分为二 | API 和 harness 各一份 |
| `apps/harness-worker/sandbox/smoke-test.mjs` | `managed-agent-api/src/harness-worker/__tests__/scheduler.test.ts` | |
| `apps/harness-worker/test/pi-session-executor.test.ts` | `harness/src/__tests__/executor.test.ts` | |
| `apps/harness-worker/test/create-session-executor.test.ts` | 合并入 scheduler.test.ts | |

## 4. harness 中 .mjs → .ts 变更

- `sandbox-entrypoint.mjs` → `src/entrypoint.ts`，编译为 `dist/entrypoint.js`
- 新增 `cli.ts`，编译为 `dist/cli.js`
- Dockerfile 改为 `COPY dist/ /agent/`，入口 `node /agent/entrypoint.js`
- `package.json` 加 `"build": "tsc"`，`"bin": { "harness": "./dist/cli.js" }`

## 5. 实施步骤

| 步骤 | 内容 | 可验证 |
|------|------|--------|
| 1 | 创建 `harness/` 目录结构 + tsconfig + package.json | `npm install && npx tsc --noEmit` |
| 2 | 迁移 contracts 类型 → `harness/contracts/` | API 和 harness 都能 import |
| 3 | 迁移 pi-session-executor → `harness/src/executor.ts` + session-runner.ts | 单元测试通过 |
| 4 | 迁移 Dockerfile + entrypoint(.mjs→.ts) → `harness/` | `docker build` 成功 |
| 5 | 创建 `managed-agent-api/src/harness-worker/`，迁移 scheduler、sandbox-executor 等 | API typecheck 通过 |
| 6 | 更新 API 引用路径，删除 `harness-worker` 独立服务 | `npm run dev:all` 只启 API + web-ui |
| 7 | 更新 design docs 引用 | 文档一致 |
| 8 | 端到端测试：mock / pi / sandbox 三种模式 | 页面正常 |

每步做完跑 `typecheck + lint + test`。
