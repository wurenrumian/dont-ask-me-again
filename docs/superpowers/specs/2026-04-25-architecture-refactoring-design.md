# 架构重构设计

## 目标

在不引入新功能、尽量不改变前端交互体验的前提下，降低当前 Obsidian 插件和本地 Python Server 的维护成本，并修复几处已经存在的稳定性风险。

本轮重构的重点是：

- 让 `main.ts` 和 `server/app.py` 从“大文件协调所有事情”变成清晰的模块入口。
- 让流式输出始终写回发起请求时的目标文件，即使用户切换到其他文件。
- 修复草稿更新依赖全局字符串搜索导致的误替换风险。
- 消除前端 SSE 解析重复代码。
- 移除后端重复会话历史拼接，并持久化会话标题元数据。

## 范围

本设计覆盖：

- 前端本地 server 启动与健康检查逻辑拆分。
- 前端流式渲染状态机拆分。
- 前端草稿写入从“当前 editor + 字符串搜索”调整为“目标文件 + 草稿锚点”。
- 前端 SSE 通用解析器抽取。
- 后端 session 元数据持久化。
- 后端 prompt history 去重。
- 后端 FastAPI 路由和标题生成服务拆分。
- 关键行为的单元测试与回归测试。

本设计不覆盖：

- 重做浮窗 UI 或选择菜单 UI。
- 引入 React、Svelte 等前端框架。
- 修改现有输入框、模板菜单、选择菜单的可见交互。
- API key 从 `.env` 迁移到新密钥存储。
- 将后端 `<thinking>` / `<answer>` 流式协议改成 raw stream 透传。
- 改变 Nanobot runtime 的核心行为。

## 当前问题核对

现有代码与重构提案中的主要判断基本一致：

- `src/main.ts` 约 1100 行，同时负责插件生命周期、server 启动、请求提交流程、流式渲染和 UI 协调。
- `src/file-actions.ts` 的 `replaceFirstOccurrence` 使用 `content.indexOf(target)`，当文档内存在相同草稿文本时可能替换错误位置。
- `src/file-actions.ts` 的 `offsetAtPosition` 手写行列到 offset 的转换，应该优先使用 Obsidian `Editor` API。
- `src/api-client.ts` 的 `invokeToolStream` 和 `invokeResponsesStream` 重复实现了 SSE buffer 切块、`event:` / `data:` 解析和 `TextDecoder` 读取循环。
- `src/main.ts` 当前流式回调闭包持有发起时的 `context.editor`，但没有明确的目标文件写入层。
- `server/app.py` 约 700 行，混合了路由、标题生成、Responses API 兼容、流式标签解析和配置管理入口。
- `server/session_store.py` 只在内存中保存历史和标题；`server/prompt_builder.py` 又把内存历史拼进 prompt。Nanobot 自身也会按 session 持久化上下文，这会造成重复上下文风险。
- 标题只存在内存里，Server 重启后会丢失。

## 设计原则

### 前端交互保持稳定

前端可见交互保持不变：

- 悬浮输入框的显示、隐藏、busy 状态不改变。
- 选择文本后的菜单位置和模板行为不改变。
- 用户提交请求后仍然在当前笔记末尾插入流式草稿。
- 打字机式流式输出节奏尽量保持原样。
- 设置页和样式不在本轮重构中重做。

前端重构只改变内部模块边界和写入可靠性。

### 写入绑定目标文件

流式写入必须绑定请求创建时的目标文件，而不是绑定当前 active editor。

规则：

- 请求开始时记录 `targetFile.path`。
- 初始草稿插入到发起请求时的 editor 中，并记录草稿锚点。
- 用户切换到其他文件后，流式输出仍继续写回原目标文件。
- 如果目标文件仍在某个 MarkdownView 中打开，优先使用该 view 的 `editor` 更新草稿。
- 如果目标文件没有打开 editor，但文件仍存在，允许通过 vault 文件内容更新草稿。
- 如果目标文件已被删除或草稿锚点失效，停止写入该文件，保留内存中的最终答案，并用 Notice 告知用户写入失败。
- 不允许把流式内容写入用户当前切换到的其他文件。

### 小步拆分

本轮重构避免一次性重写 UI 和协议。每个拆分都应保持现有 public behavior：

- 先用测试固定行为。
- 再抽模块。
- 最后删除重复代码。

## 前端架构

### `LocalServerManager`

新增 `src/local-server-manager.ts`，负责本地 Python Server 的生命周期相关逻辑。

职责：

- `ensureServerRunning(showNotice, options)`。
- `checkServerHealth()`。
- `launchAndWaitForServer(showNotice)`。
- `resolveServerStartupCwd()`。
- server 启动中的 in-flight promise 去重。

依赖：

- Obsidian `requestUrl`。
- 插件 settings。
- `Notice`。
- `app.vault.adapter.getBasePath()`。
- `manifest.id`。

`DontAskMeAgainPlugin` 只保留调用入口，不直接持有 spawn 和健康检查细节。

### `StreamRenderer`

新增 `src/stream-renderer.ts`，封装当前 `StreamRenderState`、RAF 队列、fallback thinking 文案和 drain 等逻辑。

建议 API：

```ts
interface StreamRenderer {
  pushThinking(text: string): void;
  pushAnswer(text: string): void;
  finish(): void;
  fail(): void;
  waitForDrain(timeoutMs?: number): Promise<void>;
}
```

`StreamRenderer` 不直接知道业务请求和 API 格式，只负责：

- 缓冲 thinking / answer delta。
- 维持当前打字机节奏。
- 调用传入的草稿写入函数。
- 在内容变化后触发滚动回底部。

### 目标文件写入层

新增或扩展 `file-actions.ts` 中的草稿模型，引入明确的草稿引用。

建议数据结构：

```ts
interface ChatDraftAnchor {
  filePath: string;
  startOffset: number;
  endOffset: number;
  currentBlock: string;
}
```

初始插入返回 anchor，而不是只返回字符串：

```ts
appendUserAndThinkingDraft(editor, filePath, instruction): ChatDraftAnchor
```

更新草稿时：

- 使用 `editor.offsetToPos(anchor.startOffset)` 和 `editor.offsetToPos(anchor.endOffset)`。
- 使用 `editor.replaceRange(nextBlock, startPos, endPos)`。
- 更新 `anchor.endOffset = anchor.startOffset + nextBlock.length`。
- 更新 `anchor.currentBlock = nextBlock`。

当目标文件没有打开 editor 时：

- 使用 `app.vault.process(file, updater)`。
- 在文件内容中根据 `anchor.currentBlock` 做一次定位替换。
- 替换成功后更新 `anchor.currentBlock` 和 `anchor.endOffset`。

这里的 fallback 仍然用当前 block 文本定位，但只针对目标文件内容，不再对当前活动 editor 全局误写。

### SSE 通用解析器

在 `src/api-client.ts` 中抽出：

```ts
async function parseSSEStream(
  response: Response,
  onMessage: (eventName: string, data: unknown) => void
): Promise<void>
```

职责：

- 检查 `response.ok` 和 `response.body` 由调用方或 helper 统一处理。
- 使用 `TextDecoder` 读取 stream。
- 按空行切分 SSE block。
- 合并多行 `data:`。
- 解析 JSON data。
- 将 `eventName` 和 `data` 交给调用方。

`invokeToolStream` 和 `invokeResponsesStream` 只负责各自事件到内部 `StreamEvent` 的映射。

## 后端架构

### Session 元数据持久化

替换纯内存标题存储，新增轻量持久化存储。

建议文件：

- `server/session_metadata_store.py`
- 数据文件：`.runtime/session-metadata.json`

存储内容：

```json
{
  "sessions": {
    "sess_abc": {
      "title": "整理配置同步流程",
      "title_generation_state": "done",
      "created_at": "2026-04-25T00:00:00+00:00",
      "updated_at": "2026-04-25T00:00:00+00:00"
    }
  }
}
```

规则：

- 原子写入：先写临时文件，再 replace。
- 标题生成状态持久化。
- 不在该 store 中保存完整聊天历史。
- session 列表从 Nanobot session 文件读取，再叠加 metadata 中的 title。

### 移除 prompt history 拼接

修改 `server/prompt_builder.py`：

- `build_chat_prompt` 不再拼接 `session.history[-8:]`。
- `build_responses_prompt` 不再拼接 `session.history[-8:]`。
- `build_runtime_prompt` 如果仍被使用，也应避免拼接内存历史。

理由：

- Nanobot runtime 已按 `session_id` 管理上下文。
- 上层手动拼接历史会重复消耗 token。
- 内存历史在 server 重启后丢失，不能作为可靠上下文来源。

保留：

- 当前文件路径。
- 当前文件内容。
- 当前选择文本。
- 当前用户 instruction。
- 输出格式要求。

### 路由拆分

新增后端包结构：

```text
server/
  app.py
  routes/
    __init__.py
    chat.py
    providers.py
    sessions.py
  services/
    __init__.py
    title_generator.py
```

`server/app.py` 负责：

- 创建 FastAPI app。
- 配置 CORS。
- 初始化共享依赖。
- 注册 routers。
- 暴露 `/healthz`。

`routes/chat.py` 负责：

- `/api/v1/invoke`
- `/api/v1/chat/stream`
- `/v1/responses`
- Responses session index。
- 调用 prompt builder、runtime、title generator。

`routes/providers.py` 负责：

- `/api/v1/provider-config`
- `/api/v1/model-providers`

`routes/sessions.py` 负责：

- `/api/v1/sessions`
- Nanobot session list 与 metadata title 合并。

`services/title_generator.py` 负责：

- 标题 prompt 构造。
- title model 解析。
- 临时 runtime config 构造。
- 标题生成任务调度。
- 标题标准化。
- 失败日志与状态更新。

### 流式标签解析器

本轮不改变协议，不做 raw stream 透传。

保留 `_TaggedStreamParser` 的现有行为，但移动到合适模块，例如：

- `server/stream_parser.py`

并增加测试覆盖：

- 标签分块跨 chunk。
- 无标签纯文本 fallback。
- 大小写标签行为。
- 缺失闭合标签时 flush 不丢内容。

## 错误处理

前端：

- server 不可用时仍显示现有错误提示。
- 流式请求失败时仍在草稿中写入失败信息。
- 目标文件丢失或草稿锚点失效时，不写入当前 active 文件。
- 写入失败应给出简短 Notice，floating box 保留错误信息。

后端：

- 标题生成失败不影响主请求。
- provider 配置错误保持现有 response shape。
- session metadata 写入失败应记录日志，并让 session list 退回无标题显示。

## 测试策略

前端测试：

- `file-actions`：初始草稿返回 start/end offset。
- `file-actions`：重复草稿文本存在时，只替换 anchor 指向的草稿。
- `file-actions`：`replaceRange` 更新后 end offset 正确推进。
- `api-client`：两个 stream API 继续通过现有 SSE 测试。
- `api-client`：多行 `data:` 和 CRLF block 解析通过通用 parser。
- `main` 或新写入层：切换 active 文件后仍选择目标文件写入，不写入当前文件。

后端测试：

- prompt builder 不再包含 `Session history:`。
- session metadata store 可写入、读取、覆盖 title。
- session metadata 使用原子写入。
- session list 可叠加持久化 title。
- server 重启等价场景下 title 不丢失。
- chat 路由拆分后现有 invoke、stream、responses 测试继续通过。
- stream parser 在无闭合标签时 flush 不截断内容。

验证命令：

```bash
pnpm test
```

```bash
uv run pytest server/tests -q
```

## 风险与缓解

### 前端草稿锚点失效

风险：用户在流式过程中手动编辑了草稿区域，offset 可能不再准确。

缓解：

- 优先用 anchor offset 更新。
- offset 更新失败时，在目标文件内用 `currentBlock` fallback 定位。
- fallback 仍失败时停止写入，不把内容写到其他文件。

### 后台文件写入与打开 editor 不一致

风险：同一个目标文件打开时直接改 vault 内容可能和 editor 状态冲突。

缓解：

- 目标文件存在打开的 MarkdownView 时优先使用 editor。
- 只有找不到打开 editor 时才使用 `vault.process`。

### 路由拆分引入 import 循环

风险：`app.py` 全局变量较多，直接拆分容易产生循环依赖。

缓解：

- 建立小型 dependency container，例如 `ServerContext`。
- routers 通过 context 闭包或 `app.state` 获取 runtime、settings、stores。
- 不让 route 模块反向 import `app.py`。

### 标题 metadata 文件损坏

风险：JSON 写入中断导致 metadata 读取失败。

缓解：

- 原子 replace。
- 读取失败时记录日志并返回空 metadata。
- 不影响主聊天和 session 文件本身。

## 分阶段实施建议

### 第一阶段：测试固定行为

- 为 SSE 通用解析、prompt history 移除、metadata store、草稿 anchor 写入补测试。
- 保证现有行为在重构前被测试描述清楚。

### 第二阶段：低风险前端拆分

- 抽 `LocalServerManager`。
- 抽 SSE parser。
- 保持 public API 和 UI 行为不变。

### 第三阶段：草稿写入可靠性

- 引入目标文件绑定和草稿 anchor。
- 保证切换文件后仍写回原文件。
- 增加目标文件关闭时的 fallback 写入。

### 第四阶段：后端状态与路由拆分

- 引入 session metadata store。
- 移除 prompt history 拼接。
- 拆 title generator service。
- 拆 FastAPI routers。

### 第五阶段：验证和清理

- 跑前端和后端测试。
- 构建插件。
- 检查 `main.ts`、`app.py` 是否只保留协调职责。

