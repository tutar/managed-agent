# Managed Agent 用户级资源隔离设计（中文版）

- `Status`: active
- `Owner`: TBD
- `Related Proposals`:
  - [../proposals/04-multi-tenant-feature-proposal.zh-CN.md](../proposals/04-multi-tenant-feature-proposal.zh-CN.md)
- `Related Design`:
  - [minimal-architecture.zh-CN.md](./minimal-architecture.zh-CN.md)
  - [technical-design.zh-CN.md](./technical-design.zh-CN.md)
  - [../interfaces/workspace-service-backend-project-storage-design.zh-CN.md](../interfaces/workspace-service-backend-project-storage-design.zh-CN.md)

## 1. 概述

本文定义 Managed Agent 平台的用户级资源隔离设计。在单租户 MVP 阶段先实现用户级隔离，后期在此基础上升级为多租户。核心隔离边界由 Firecracker MicroVM 承载，Kata Containers + Kubernetes 负责调度和生命周期。

### 1.1 核心模型

```
用户发消息
  → API 创建执行任务
    → Worker 通过 K8s API 创建 Kata Firecracker Pod
      → 挂载该用户的存储视图
      → Pod 内 pi agent 执行
      → 任务完成 → Pod 立即删除
  → 用户再发消息 → 重新拉起新 Pod → 从 transcript 恢复会话上下文继续
```

**VM（Pod）不是用户绑定，也不是 session 绑定的，而是 agent runtime 任务绑定的。** 同一 session 的不同消息可能跑在不同 VM 上，VM 之间通过持久存储保持连续性。

### 1.2 Pod 生命周期

| 阶段 | 行为 |
|------|------|
| 创建 | Sandbox Manager 通过 K8s API 提交 Kata Pod spec |
| 挂载 | 存储准备完成后 Pod 启动 |
| 执行 | pi agent 在 Pod 内执行用户消息 |
| 销毁 | 任务完成 → Sandbox Manager 删除 Pod |


## 2. 存储隔离

### 2.1 存储分层

| 层 | 载体 | 用途 |
|----|------|------|
| 热执行层 | 高速本地 SSD | VM rootfs overlay（base image + CoW 可写层） |
| 持久写层 | CSI PV | transcript JSONL、user-data |
| 冷读层 | 对象存储 | skills 文件、extensions 文件、rootfs base image |
| 元数据层 | PostgreSQL | session 索引、user_skills 安装记录、审计 |

### 2.2 VM 内挂载清单

VM 的 rootfs `/` 本身就是 workspace——agent 工作文件、中间产物、工具输出全部在此。不需要额外的 `/mnt/workspace` 挂载。

| 路径 | IO 特征 | 挂载方式 | 理由 |
|------|---------|---------|------|
| **`/`（rootfs）** | 只读 base + 高频 rw overlay | **Kata 原生 overlay**：base image (ro) + CoW overlay (rw) | agent 所有读写都在 overlay 内，base 全 node 共享 |
| **`/mnt/transcripts`** | append-only，需跨 VM 持久 | **CSI PV + virtio-fs** | session JSONL，需快照恢复能力 |
| **`/mnt/user-data/uploads`** | 读写，需持久 | **CSI PV + virtio-fs** | K8s 声明式管理，快照和扩容 |
| **`/mnt/user-data/outputs`** | 读写，需持久 | **CSI PV + virtio-fs** | 同上 |
| **`/mnt/user-data/tool_results`** | 读写，需持久 | **CSI PV + virtio-fs** | 同上 |
| **`/mnt/skills`** | 冷读 | **host 侧预拉取 + ro 挂载** | VM 启动前一次性准备，不占 VM 内网络 |
| **`/mnt/extensions`** | 冷读 | **host 侧预拉取 + ro 挂载** | 同上，仅平台批准内容 |

### 2.3 CoW 磁盘（Copy-on-Write）

所有 VM 共享同一份只读 base image（OS + 基础工具链），各自的写入走 CoW overlay：

```
┌─────────────────────┐
│  VM1 CoW overlay    │  ← 只存 VM1 独有的写入（MB 级）
├─────────────────────┤
│  VM2 CoW overlay    │  ← 只存 VM2 独有的写入
├─────────────────────┤
│  VM3 CoW overlay    │
├─────────────────────┤
│  Shared base image  │  ← 只读，全 node 一份（GB 级）
│  (OS + tools)       │
└─────────────────────┘
```

- 实现：Kata 原生 overlay 支持，rootfs 作为只读 image，VM 启动时自动附加 CoW overlay
- 效果：节点磁盘占用从 `N × rootfs_size` 变为 `1 × base_size + N × delta_size`，节省 90% 以上
- 启动加速：不需要完整拷贝 rootfs，直接基于共享 base + 新建 overlay 启动

### 2.4 写缓存策略

对于有写的路径，使用高速本地 SSD 做 write-back cache：

| 路径 | 写模式 | 缓存策略 |
|------|--------|---------|
| rootfs overlay | rw | 本地 SSD 主写，VM 销毁时 overlay 丢弃（不需持久的内容）或 flush 到对象存储（需保留的工作产物） |
| transcript | append-only JSONL | 本地 SSD 主写 → 异步 sync 对象存储 |
| user-data | 读写 | 本地 SSD 缓存，定期 flush 对象存储 |
| skills | ro | VM 启动时一次性拉取 |
| extensions | ro | 同上 |

### 2.5 用户数据隔离

存储后端按 `userId` 分区，Pod 启动时由 Sandbox Manager 准备该用户的数据视图：

- CSI PV 使用带 `userId` 标签的 PVC，或通过 CSI 驱动映射到对象存储 `users/<userId>/` 前缀
- rootfs overlay 以 `userId/sessionId` 命名，VM 销毁后回收
- skills 安装记录在元数据层（PostgreSQL `user_skills` 表），Pod 启动时根据记录拉取

## 3. 运行时隔离：Kata Containers + Firecracker

### 3.1 架构

```
                          K8s Cluster
┌──────────────────────────────────────────────────────────────┐
│  Nginx Ingress                                               │
│  Managed Agent API (Deployment)                              │
│  Harness Worker (Deployment)                                 │
│    ├─ Session Executor                                       │
│    └─ Firecracker Sandbox Manager                            │
│         ↓  K8s API (create/delete Pods)                     │
│    ┌──────────────────────────────────────┐                  │
│    │  Kata Firecracker Pod                 │                  │
│    │  ├─ / (rootfs: base ro + CoW rw)     │  ← workspace    │
│    │  ├─ pi agent runtime                  │                  │
│    │  ├─ /mnt/transcripts (CSI PV)        │                  │
│    │  ├─ /mnt/user-data (CSI PV)          │                  │
│    │  ├─ /mnt/skills (预拉取, ro)          │                  │
│    │  └─ /mnt/extensions (预拉取, ro)      │                  │
│    └──────────────────────────────────────┘                  │
│         ↓ (task complete)                                         │
│    Pod deleted                                               │
│                                                              │
│  PostgreSQL (StatefulSet)                                    │
│  对象存储 (外部服务)                                           │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Pod 规格

#### 基础规格

| 配置 | 值 | 说明 |
|------|-----|------|
| RuntimeClass | `kata-firecracker` | Kata Containers with Firecracker hypervisor |
| restartPolicy | Never | Pod 不自动重启 |
| ttl after finished | 30s | Job controller 自动回收 |

#### 资源超卖与优化

agent 负载是脉冲式特征：执行时吃 CPU/内存，等待用户输入时几乎零占用。硬分配导致大量资源浪费。

| 资源 | 优化手段 | 机制 |
|------|---------|------|
| **CPU** | vCPU overcommit | K8s requests << limits，空闲时 burst 到 limits，争抢时 cgroup shares 按比例分配 |
| **内存** | virtio-balloon | Firecracker balloon 驱动，VM 空闲时归还内存给 host，需要时再申请 |
| **磁盘** | CoW overlay | rootfs 全 node 共享 base image，VM 只存增量写入 |

#### 按 session 分级

不是所有 session 都需要同等资源，按类型分级减少浪费：

| 等级 | 场景 | requests | limits |
|------|------|----------|--------|
| **small** | 纯对话，很少 bash/文件操作 | 128Mi mem, 0.1 vCPU | 512Mi mem, 1 vCPU |
| **medium** | 常规开发，bash + 文件操作 | 256Mi mem, 0.2 vCPU | 1Gi mem, 2 vCPU |
| **large** | 重编译、大数据处理 | 512Mi mem, 0.5 vCPU | 2Gi mem, 4 vCPU |

用户创建 session 时选择等级，或平台根据历史行为自动推荐/升级。

#### Node 级别规划

- CPU overcommit 比例：1:3（实际核心:可分配 requests）
- 内存 overcommit 比例：1:1.5
- 监控 node 实际利用率，峰值超 80% 告警
- Harness Worker 做 HPA 水平扩展

### 3.3 镜像与启动优化

Kata Pod 需要精简 rootfs base image 以缩短冷启动时间：

- 最小系统：node runtime、pi agent 包、rclone、bash + 少量基础工具（git、python3）
- 镜像预拉取：DaemonSet 在每个 node 上缓存最新 base image
- 避免在 VM 内做重量级初始化——skills 拉取、存储准备由 Sandbox Manager 在 host 侧完成
- CoW overlay 启动快：不需要完整拷贝 rootfs，直接共享 base + 新建 overlay

### 3.4 同一 host 多 VM

同一 K8s node 上可同时运行多个 Kata Pod（多个用户的 VM）：

- 每个 Pod 通过 Firecracker 提供独立内核，进程/内存/文件系统完全隔离
- CPU：vCPU 通过 cgroup shares 公平调度，空闲时 burst，争抢时按比例
- 内存：virtio-balloon 回收空闲内存 + limits 封顶
- 磁盘：CoW overlay 共享 base，各自隔离增量
- 一个用户的 agent 耗尽资源只影响自己的 Pod，不影响同 node 其他用户

## 4. 网络隔离

### 4.1 方案：K8s NetworkPolicy + HTTP Proxy

```
VM 出站流量
  ├─ 非 HTTP → K8s NetworkPolicy（默认 DROP，仅允许必要 IP）
  └─ HTTP(S) → 通过 HTTP Proxy（域名白名单 + 审计）
       ├─ 模型 API endpoint ✓
       ├─ MCP service endpoint（用户配置） ✓
       ├─ 包管理器源（apt/pip/npm 镜像） ✓
       └─ 其他 → DENY + 审计记录
```

### 4.2 各层职责

| 层 | 组件 | 职责 |
|----|------|------|
| L3/L4 | K8s NetworkPolicy | 禁止 Pod 间通信，限制出站 IP 段 |
| L7 HTTP | HTTP Proxy（Squid / tinyproxy） | 域名白名单，请求日志，速率限制 |
| 兜底 | Firecracker tap + iptables | VM 级别基础规则 |

### 4.3 网络策略明细

| 策略 | 规则 |
|------|------|
| Pod 间通信 | **完全禁止**——NetworkPolicy deny all between pods |
| 入站 | 仅允许 Harness Worker 到 Pod 的控制连接 |
| 出站 HTTP(S) | 必须通过 HTTP Proxy |
| 出站非 HTTP | 默认 DROP，例外白名单 |

不在 MVP 阶段引入 Istio/Service Mesh，保持网络层简单。以后需要更细粒度 L7 控制时再升级。

## 5. 非运行时资源隔离

### 5.1 Skills：用户级安装

Skills 安装通过平台 API + 元数据层管理，不直接依赖对象存储目录结构：

```
用户安装 skill
  → API 校验格式和来源
  → 记录到 user_skills 表（userId, skillId, version, installedAt）
  → skill 文件存储到对象存储独立位置

Pod 启动
  → Sandbox Manager 查询 user_skills 表获取该用户已安装 skills 列表
  → 从对象存储拉取 skill 文件到 host 本地
  → 只读挂载进 VM
```

优点：
- 安装/卸载/版本更新都有审计和管控入口
- 不会因为 VM 销毁而丢失安装记录
- 平台可以校验和审核用户安装的 skills

### 5.2 Extensions：平台管理，共享挂载

- 仅平台批准和管理的 extensions
- 不允许用户上传任意 extension 代码
- 所有用户共享同一份 extensions（只读挂载）
- Sandbox Manager 在 Pod 启动前拉取到 host 本地

### 5.3 MCP Clients：用户注册，平台校验

- 用户通过 API 注册 MCP client 配置
- 平台校验配置格式、目标地址、认证方式
- 注册记录持久化到 PostgreSQL
- Pod 启动时注入该用户的 MCP client 配置
- 按用户隔离，A 用户的 MCP 配置不会出现在 B 用户的 VM 中

### 5.4 命令 allowlist：平台默认 + 用户增量

- 平台级默认 allowlist：基础开发命令
- 用户级增量 allowlist：用户在页面上配置可用的额外命令
- 平台级强制 denylist：`docker`、`kubectl` 等高风险命令默认禁用
- 配置按 userId 存储，Pod 启动时注入

## 6. 与多租户的关系

本文定义的用户级隔离，与后期多租户的关系：

| 维度 | 用户级（本文） | 租户级（04 提案） |
|------|--------------|-----------------|
| 存储分区 | `userId` | `tenantId/userId` |
| VM 归属 | 不归属，任务绑定 | 不归属，任务绑定（不变） |
| 网络隔离 | Pod 间禁止通信 | 租户间额外 VPC/网络段隔离 |
| Skills | 用户级安装 | 租户可管理共享 skill 集 |
| MCP Clients | 用户级注册 | 租户级 MCP 模板 + 用户覆盖 |
| 命令 allowlist | 用户级增量 | 租户级默认 + 用户增量 |
| 配额 | 用户级 | 租户级 + 用户级 |
| API 查询 | 按 userId 过滤 | 按 tenantId 过滤 |

核心原则不变：`tenantId` 只留在平台层，不进入 pi agent 运行时语义。

## 7. 实现顺序建议

基于当前实现状态，建议按以下顺序推进：

1. **存储层改造**：CSI PV 接入，rootfs base image 构建 + CoW overlay 模型
2. **Kata + K8s 基础**：Kata RuntimeClass 配置，精简 rootfs base image，overcommit 策略
3. **Sandbox Manager**：Pod 生命周期管理（创建/删除），挂载准备，virtio-balloon 配置
4. **网络策略**：NetworkPolicy + HTTP Proxy
5. **Skills 用户安装**：API + `user_skills` 表 + Pod 启动拉取
6. **命令 allowlist + 配额 + session 资源分级**：用户配置 + Pod 注入

每步独立可验证，不阻塞其他功能。
