# AILIS 原有记忆通路审计

审计日期：2026-09-21。源目录：`F:\AILIS\MAIN`，commit `92f73b8f9597f36066d8c0725d35f876546b1224`。

## 本次实际复用的实现

`electron/ailis-memory-store.cjs` 中的 `AILISMemoryRuntime.recordTurn()` / `searchMemory()`；`electron/ailis-memory-lexical-retriever.cjs` 中的 `rankMemoryEvents()`。

检索策略 ID 为 `bm25_phrase_v2`。它使用词项频率、短语匹配、轻量时近与重要性分数，以及会话重复惩罚0.2。状态信息明确标记 dense 和 query planner 未启用。这不是向量检索或 LLM 语义排序。

| 观察 | 对本轮任务的影响 |
|---|---|
| recordTurn 对 userText/assistantText 分别最多保存1200字符 | 长对话、代码、日志尾部信息可能不进入可检索事件 |
| 文本先进行空白归一化 | Python缩进、日志换行等不能通过原事件原样恢复 |
| state.events 只保留最近500事件 | searchMemory 不能从更早的 events.jsonl 自动回读 |
| searchMemory 只调用 state.events 的词法排序 | 原始账本、画像内容不会自动出现在这条 Search 返回链路中 |
| 没有共享关键词时候选可能为空 | 同义改写和跨语言检索容易漏召回 |
| Add 没有原生 user_id 命名空间 | AML适配层需要为每个完整user_id创建独立scope |

## 其他已有通路及本轮边界

- `electron/ailis-raw-memory-ledger.cjs` 保存原始记录、支持回放和整理输入；本次没有将用户原始账本接入评测。
- `electron/ailis-user-profile-curator.cjs` 负责画像整理，本轮不启动其模型流程。
- `electron/ailis-context-compiler.cjs` 编译主模型背景，本轮不调用。
- `backend/services/memory_service.py` 的 get_context 主要是按session取最近N条消息，不是这次选用的长期记忆检索实现。
- `electron/ailis-gateway.cjs` 的 searchMemory 转发到 memoryRuntime.searchMemory，因此所测模块对应现有明确的检索入口。

本轮只能评价这条检索通路，不代表完整AILIS Agent的长期记忆上限。要衡量完整产品，还需单独接入原始账本按需回读、画像整理及统一Answer生成，并控制模型和预算。

## 实施策略

源项目已有大量其他未提交改动。本次未修改其源码，也未读取或修改 `.ailis-state`、`.ailis-runtime`、个人聊天或密钥。

只快照两个未修改的记忆模块和MIT许可证，并核验SHA-256。改动集中在比赛目录的协议封装、数据隔离、持久化、评测器。

原生模块和lossless适配使用同一份排序函数。没有根据LoCoMo题型、答案、类别或代码诊断题目在服务中分支。所有标签仅在评测器中使用。

## 验证

源项目命令：`node --test tests/ailis-memory-store.test.mjs tests/ailis-raw-memory-ledger.test.mjs`，17/17通过。

比赛项目命令：`npm test`，覆盖HTTP、鉴权、用户与赛道隔离、幂等、重启、故障恢复、原文保留、输入校验和指标计算。最新数量与能力结果见本轮报告。
