# infra

基础设施目录按执行面和存储面拆分：

- `local`: 本地联调用 docker-compose 基础设施
- `ingress`: Nginx / Ingress 入口层配置与说明
- `k8s`: 部署清单与运行拓扑
- `firecracker`: MicroVM 运行与回收说明
- `storage`: transcript、热盘、持久层分层说明
- `rclone`: 挂载约定与目录规划
