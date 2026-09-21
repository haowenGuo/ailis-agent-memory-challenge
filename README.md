# AILIS Memory — Agent Memory Leaderboard

已实现文本（textual）和代码（coding）的 Add/Search。源码来自 `F:\AILIS\MAIN`，独立保存在本目录，不连接 AILIS 的桌面进程，不读取用户的日常记忆、画像或凭据。

这是**不调用模型的记忆检索基线**。文本和代码的同一套服务已部署到 `https://150.109.13.189/aml`；官方申请和评测状态另行记录，本仓库不声称已获准进入公榜。官网开源榜清单要求 Add/Search 使用 `gpt-4o-mini`，申请表提示则约束“任何被使用的模型”；申请将如实声明完全无模型调用，由主办方确认资格。

## 运行

要求 Node.js 22 或以上，无第三方 npm 依赖。

```powershell
Set-Location 'F:\CSIG_Agent记忆挑战赛'
npm test

# 仅本机无鉴权冒烟模式
$env:AML_ALLOW_UNAUTHENTICATED = '1'
npm start
```

默认监听 `127.0.0.1:8787`。部署服务设置独立 `AML_MEMORY_KEY`，由 Caddy 终止 HTTPS 并去掉公网 `/aml` 前缀。调用凭据仅通过官方受控字段提供，不发布到仓库。

环境变量：

| 变量 | 默认值 | 含义 |
|---|---|---|
| `AML_VARIANT` | `lossless` | `native` 或 `lossless` |
| `AML_DATA_DIR` | `.state` | 独立数据根目录，禁止放公开仓库 |
| `AML_HOST` | `127.0.0.1` | 监听地址 |
| `AML_PORT` | `8787` | 监听端口 |
| `AML_MEMORY_KEY` | 无 | 接口访问密钥，通过环境变量设置 |
| `AML_ALLOW_UNAUTHENTICATED` | 未启用 | 只有设为 `1` 且监听本机才允许免鉴权 |
| `AML_CACHE_SCOPES` | 8 | 常驻用户 scope 的数量上限，淘汰后从持久日志重建 |
| `AML_CACHE_BYTES` | 67108864 | 缓存 scope 的序列化日志字节总预算；不是 RSS 上限 |
| `AML_MAX_IN_FLIGHT` | 4 | 同时接收的鉴权请求上限，超额返回可重试的429 |
| `AML_VERSION` | 0.1.0 | 健康接口报告的部署版本 |
| `AML_EXTERNAL_LOCK` | 未设置 | Linux 经 `flock --no-fork` 启动时设置为 `flock` |

接口支持 `Authorization: Bearer ...`、`Authorization: Token ...` 或 `X-Api-Key`，Health 无需鉴权。单个数据根只允许一个服务写入；进程锁防止重复启动。异常退出留下锁时，应先确认锁中 PID 已退出，再手动移除该根目录的 `server.lock`，不能在进程运行时删除。

上述 PID 文件适用于直接启动。生产由 Linux `flock --nonblock --no-fork` 持有系统锁，并设置 `AML_EXTERNAL_LOCK=flock`；进程退出时锁自动释放，systemd 可重启服务。不要在没有外部锁的命令中设置该选项。

## 接口

| 方法 | 地址 | 功能 |
|---|---|---|
| GET | `/health` | 存活、版本与无模型调用声明 |
| POST | `/add` | 报名用统一写入入口，兼容文本/代码 |
| POST | `/search` | 报名用统一检索入口，兼容文本/代码 |
| POST | `/textual/add` | 文本材料写入 |
| POST | `/textual/search` | 文本记忆检索 |
| POST | `/coding/add` | 代码/工程历史写入 |
| POST | `/coding/search` | 工程经验检索 |

官网当前申请表只接收一组Add/Search URL，拟报名使用`/add`、`/search`。两赛道字符串协议及本轮算法相同，统一入口按完整`user_id`隔离，不通过内容或ID猜赛道。分赛道路径保留给本地诊断，拥有独立命名空间；同一次写入/检索必须配对使用相同入口。最终两赛道Key/版本绑定方式在获批后核对。

Add 示例：

```json
{
  "request_id": "example-write-1",
  "user_id": "example-run1-user1",
  "session_id": "example-session1",
  "messages": [
    {"role": "user", "content": "load_config 读取空 YAML 返回 None；验证过的修复是在读取边界规范化为空字典。"}
  ]
}
```

成功返回 `{"success":true,"request_id":"example-write-1","user_id":"example-run1-user1","session_id":"example-session1"}`。

Search 示例：

```json
{"query":"load_config 如何处理空 YAML？","user_id":"example-run1-user1","top_k":100}
```

成功返回 `{"data":[{"id":"稳定记忆ID","content":"来源信息和原始证据","score":1.2,"created_at":"ISO时间"}]}`。空结果为 `{"data":[]}`。

- 每条消息支持可选 Unix 毫秒 `timestamp`，保留来源时间；未提供时 `created_at` 为写入时间。
- 仅支持文本字符串和 user/assistant 角色。本轮未做多模态。
- `options` 选择题选项合法接收，但冻结的词法基线不使用选项改写查询。
- 一个逻辑写入以同一 scope 内的 `request_id` 去重；相同 ID、不同请求体返回 409。
- `user_id` 原样作为隔离标识，磁盘目录使用 SHA-256；不会截断 ID 或根据文字猜测赛道。
- session 只表示来源，同一 `user_id` 可跨 session 检索。不同 track 额外隔离。
- 持久化原始请求、建立可检索状态后才返回 200。原子请求日志支持进程中断后的重建。
- `top_k` 支持 1–100；HTTP 请求体上限 16 MiB，超限明确拒绝，不静默截断。
- 不返回最终答案，不执行历史中的代码或命令，不把历史材料当指令。

## 两个对照版本

### native：原生记忆模块，逐消息映射

直接调用快照中的 `AILISMemoryRuntime.recordTurn()` 和 `searchMemory()`。**一条传入消息映射为一个 AILIS 事件**：保留原实现的 1,200 字符截断、空白归一化、secret-like 内容脱敏、最近 500 事件窗口。

这不是整个 AILIS Agent 的端到端评测。生产中的 `recordTurn` 可以把 user/assistant 两条消息合成一个事件；本适配映射不同，因此“500事件”不能直接等同于生产中的“500条聊天消息”。原始账本、画像整理、上下文编译器和工具按需回读未进入本轮 Search 通路。

### lossless：保留原文的协议适配

保留全部原始消息、代码换行、缩进、角色、session 和来源时间，将完整事件交给 **同一份未经修改的** AILIS `rankMemoryEvents()`。

没有替换 BM25 排序，没有增加基准专用规则、模型推理、query expansion 或 reranker。两版之间主要比较存储/表示层差异，不能将改进后的成绩冒充原生产品成绩。

两个赛道当前复用相同算法。代码轨迹不会被自动解析为根因/修复图，文本也不会进行语义事实更新；这些属于后续优化，本轮先测基线。

## 复现评测

```powershell
npm test
node scripts/evaluate.mjs --locomo 'F:\AILIS_self_evolution_runtime\build-cache\benchmarks\locomo\data\locomo10.json'
```

也可自行从 https://github.com/snap-research/locomo 获取原始公开数据，再通过 `--locomo` 指定文件。脚本使用前10组对话，可用 `--samples 2` 做较小检查，`--variants native,lossless` 选择版本。结果自动创建时间目录；重跑时建议使用默认新目录。

文本评测：原始公开 LoCoMo，全量加载对话，QA 仅用于检索问题和离线计分。**不将答案、evidence 标签、观察摘要或事件金标输入记忆系统**。两个原始说话人都映射为 user，并在正文保留姓名和来源日期；这不是官方冻结 Adapter，也不是 AML 的 LoCoMo-Refined。

代码评测：`evals/coding-diagnostic.mjs` 中原创的22道诊断题，分别在20条历史记录、加入180条无关记录的条件运行。另有超过500条事件的保留压力测试。**不是 CAMBench，不能据此估计官方代码排名或软件任务解决率。**

指标：Recall@1/5/10/100（标注证据召回比例）、All evidence@K（整题全部证据覆盖率）、MRR@100。LoCoMo类别5属于对抗/不可回答问题，其关联历史不能当作正确答案支持，因此不计入支持证据召回；拒答能力留待Answer阶段测试。没有证据标注或引用无法定位的题目也单独列出，不混入分母。明确列出的多条证据ID按分隔符展开，错误ID不猜测修正。原生结果的证据ID召回仍可能掩盖内容截断，应结合长文本诊断看待。

结果入口：`results/latest.json`。每次生成 `summary.json`、逐题 `details.json`、`REPORT.md`；本轮人工解读见 `FINDINGS.zh-CN.md`（生成后）。性能记录是本机直接服务调用的延迟，HTTP正确性由独立契约测试验证，不能当作公网容量承诺。

## 已知限制与接入前工作

- 本轮没有统一 Answer/Eval 模型，因此不能报告答题准确率或官方分数。
- 词法检索不具备可靠的同义改写、多跳推理、矛盾裁决和语义拒答能力。
- 当前存储为单进程原子 JSON 文件，检索每次扫描事件并重建词频统计；需在正式规模下测容量，再决定数据库/索引优化。
- memory scopes 按最近使用顺序淘汰缓存，受 scope 数量和序列化日志字节预算约束；完整持久化数据不因此删除。单次超大 scope 的解析和排序仍可能超过常驻缓存预算，因此这不是硬 RSS 限制。
- 请求日志包含评测内容，只保留完成任务所需信息；正式评测后按赛事期限删除，不能用于训练或重建私有题库。
- 公网部署已完成；无模型方法的资格由官方审核。运行方自测不会消耗官方评测机会，也不能代替官方 Smoke / Full。

## 部署和运行验证

服务版本 `v0.1.0-aml`；公开入口为 `https://150.109.13.189/aml/add`、`/aml/search` 和 `/aml/health`。同步 Add，Bearer 鉴权；建议申请 Add=1、Search=1。服务在共享 Ubuntu 22.04 主机上运行，单进程，cgroup 上限 1 GiB RAM / 0.5 CPU，专用账号及持久化目录。鉴权请求接收上限4，Body上限16 MiB，请求超时30分钟。

14项单元/协议测试在 Windows 和 Linux 通过。公网9项自测通过正常证书验证；已检查原有服务路由继续返回200。原始合成负载在单scope写入10,000条、6,570,000字节文本，21次检索的P95约886ms；跨12个scope的缓存淘汰后仍可重建检索。该数字是合成运行诊断，不是私有Full套件容量证明或官方成绩。

锁互斥、强制异常退出后的自动重启与100条证据内容一致性已实测。方法、公共数据来源与复现说明见下方；详细运行说明见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 来源与版本

AILIS：https://github.com/haowenGuo/AILIS ，MIT，原作者 Haowen Guo。两个模块原样复制，许可证保留在 `vendor/ailis/LICENSE`，commit 和 SHA-256 在 `vendor/ailis/manifest.json`。

刷新快照：`node scripts/snapshot-ailis.mjs 'F:\AILIS\MAIN'`。刷新会改变被测版本，之后应重新评测，不能与旧结果混用。

官方协议：https://agentmemoryleaderboard.ai/api-guide （核对日期：2026-09-21）。
