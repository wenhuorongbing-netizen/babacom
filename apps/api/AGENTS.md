# apps/api — 后端约定

> 只有改动这棵树时才会被加载。仓库级铁律见根目录 [`AGENTS.md`](../../AGENTS.md)。

## 技术栈（不得擅自更换）

FastAPI + SQLAlchemy + Alembic + PostgreSQL + WebSocket

**MVP 不需要 Kafka、微服务、Kubernetes，也不需要一开始就上 Redis。**
Redis 在做多 LiveKit 节点、共享房间数据和跨节点路由时才引入 —— R02 之后。
提议引入任何新的基础组件都必须先开 Issue。

## 目录约定

```
app/
├─ accounts/       2.2      auth/ 同属 2.2
├─ invites/        2.1
├─ permissions/    2.3      can() 的唯一实现
├─ voice/          3.1
├─ messages/       5.1
├─ attachments/    5.2
├─ search/ threads/ 5.3
├─ channels/       6.1
├─ dm/ notifications/ 6.3
├─ realtime/       7.1      WebSocket 网关
├─ tokens/ ratelimit/ 7.2
├─ jobs/ mail/ storage/ 7.3
└─ health/         1.3
migrations/
├─ _proposed/      ← 各模块写这里
└─ versions/       ← Tech Lead 编号后移入，任何模块都不得直接改
```

## 硬性规则

1. **迁移写进 `migrations/_proposed/<模块id>-<描述>.sql`。**
   正式序列 `migrations/versions/` 由 Tech Lead 合并编号。这条由 CODEOWNERS 强制。
2. **路由命名空间按模块划分**，两个模块不得声明同一个路径前缀。
3. **权限判断一律调用 `permissions.can(user, action, channel)`。**
   任何模块自己写一遍权限逻辑都是架构违规。
4. **不得跨模块直接 import 对方的 ORM 模型。** 需要跨模块数据 → 走 service 层或契约。
5. **所有写接口都要限流。** 尤其是令牌、登录、邀请兑换。
6. **不得在日志里记录密码、令牌、邮箱全文、消息正文。**

## 数据模型的共享对象

下列对象**必须全局只有一套定义**，改动走 schema 契约（Tech Lead 所有）：

```
User · Community · Channel · VoiceRoom · Participant · Message · MediaTrack
```

`plan01.md` 指出的失败模式就是这些对象被三个人各定义一套 —— 到集成时才发现
「语音房间 ID 和文字频道 ID 不是同一套模型」，然后被迫重写。

## Validation

```bash
ruff check . && ruff format --check .
pytest -v
alembic check           # 模型与迁移是否一致
```
