# infra — 基础设施约定

> ⚠️ **改错这里的一行，全员离线。** 本目录在 CODEOWNERS 里指向 Tech Lead，
> 任何 PR 都必须经他审查。仓库级铁律见根目录 [`AGENTS.md`](../AGENTS.md)。

## 目录约定

```
infra/
├─ compose.yaml       控制面
├─ livekit/           LiveKit 配置（1.2）
├─ turn/              TURN（1.2）
├─ measurement/       跨境网络测量脚本（1.2）
├─ hosting/           主机基准与 traceroute（8.1）
├─ monitoring/        指标与告警（1.3）
├─ staging/           预发环境（1.3）
├─ backup/            备份与恢复演练（8.2）
├─ failover/          备用 IP / 域名切换（8.2）
├─ hardening/         安全加固（8.3）
└─ nginx/ 或 caddy/   反向代理与 TLS（1.1）
```

## 硬性规则

1. **任何真实密钥、证书、`.env` 都不得提交。** 只能改 `.env.example`，值留空。
2. **容器镜像按摘要固定**，不得用 `:latest`。
3. **不得在同一台机器上混跑实时媒体与其他服务。**
   普通网站慢几秒可以接受，实时媒体对丢包、抖动和 CPU 抢占极其敏感。
4. **不得在 1.2 的测量出结果之前下单买机器**（D1）。
5. 改动任何暴露到公网的端口，必须在 PR 里说明**为什么**以及**谁能访问**。

## 媒体拓扑的前提事实

> **一个房间必须完整落在一个节点上。**

LiveKit 多区域部署可以让**不同房间**落在不同节点，但加一台欧洲服务器
**不会**自动把同一个房间切成「国内一半在亚洲、欧洲一半在欧洲」。

跨区 SFU 级联已在 Won't 列 —— 它会把项目从「小型 Discord」升级成
实时通信基础设施项目。D6 的三个备选见 `docs/04-open-decisions.md`。

## Validation

```bash
docker compose -f infra/compose.yaml config     # 配置语法
docker compose -f infra/compose.yaml up -d --wait
curl -fsS https://api.<域名>/healthz
```

**改动 LiveKit 或 TURN 配置后，必须做一次真实的两端语音验证**，
不能只看配置文件语法通过。
