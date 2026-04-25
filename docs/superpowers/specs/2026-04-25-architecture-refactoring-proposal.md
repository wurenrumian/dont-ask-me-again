# Architecture Refactoring & Optimization Proposal

**Date**: 2026-04-25
**Status**: Proposed
**Context**: 随着 dont-ask-me-again 插件功能的不断迭代，目前的架构虽然在职责划分（API / UI / 文件操作）上有一定基础，但部分核心文件已经暴露出“上帝类（God Class）”、代码重复以及潜在的脆弱性隐患。为了保证未来的可维护性和系统的健壮性，在不引入新特性的前提下，提出以下重构与优化方向。

## 1. 解耦 `main.ts`（解决“上帝类”问题）

**现状**：
目前 `main.ts` 超过 1100 行，承担了过多的非核心路由职责，包括但不限于：插件生命周期、本地 Python Server 的进程管理与探活、复杂的流式渲染状态机（`ensureRenderPump` 等）、模板生成的工作流协调等。

**优化方案**：
将特定领域的逻辑抽离出独立的管理类：
*   **抽离 `LocalServerManager`**：将 `launchAndWaitForServer`、`checkServerHealth`、`resolveServerStartupCwd` 以及相关的子进程 `child_process.spawn` 逻辑独立。
*   **抽离 `StreamRenderer`**：将打字机效果、`requestAnimationFrame` (RAF) 队列管理、以及 `StreamRenderState` 相关的逻辑封装。该类应该只对外暴露 `pushThinking(text)`, `pushAnswer(text)`, `finish()` 等简洁的 API。
*   **主类瘦身**：`main.ts` (`DontAskMeAgainPlugin`) 仅作为各模块的协调者（Glue Code）和 Obsidian API 的注册入口。

## 2. 增强 `file-actions.ts` 中文本操作的健壮性

**现状**：
当前对 Markdown 文本的修改依赖于纯字符串搜索和手动的字符计算，这在多变的文本编辑环境中非常脆弱（Brittle）：
1.  `offsetAtPosition` 手动使用 `for` 循环和 `\r\n` 判断去计算文本偏移量，容易出错。
2.  更新流式内容时，使用了 `replaceFirstOccurrence`（基于 `content.indexOf(target)`）。如果文档内存在两段相同的文本，可能会导致错误替换。

**优化方案**：
充分利用 Obsidian 原生的 `Editor` API：
*   **废弃手写计算**：直接使用 `editor.posToOffset(position)` 和 `editor.offsetToPos(offset)` 来代替手写的 `offsetAtPosition`。
*   **位置锚定替换**：不再使用 `indexOf` 去全局搜字符串。在初次插入草稿（`appendUserAndThinkingDraft`）时，记录下插入区域的 **Start Offset** 和 **End Offset**。后续的流式更新直接基于这两个 Offset 使用 `editor.replaceRange(text, startPos, endPos)` 进行精准替换，并动态更新 End Offset。

## 3. 消除 `api-client.ts` 中的 SSE 解析重复代码

**现状**：
为了兼容不同的 API 格式，`invokeToolStream` 和 `invokeResponsesStream` 两个函数中包含了近乎一模一样的 Server-Sent Events (SSE) 解析逻辑（如 `TextDecoder` 的使用、`buffer` 的换行切割、`event:` 和 `data:` 的正则匹配等）。

**优化方案**：
*   **提取通用解析器**：抽象出一个 `parseSSEStream(response: Response, onMessage: (eventName: string, data: any) => void)` 通用函数。
*   **关注点分离**：让 `invokeToolStream` 和 `invokeResponsesStream` 仅负责处理对应 API 格式的特殊业务逻辑（如将特定的 payload 映射为内部的 `StreamEvent` 结构）。

## 4. 修复异步长请求中的“上下文丢失”风险

**现状**：
在 `main.ts` 的 `handleSubmit` 流程中，整个请求可能持续十几秒甚至更长。回调函数通过闭包捕获了发起请求时的 `context.editor`。如果在此期间用户切换了 Obsidian 的标签页或关闭了当前文件，流式回调仍然会向陈旧的 `editor` 实例中强行注入文本，导致文本错乱或丢失。

**优化方案**：
*   **增加上下文校验层**：在 RAF 渲染循环或执行 `updateThinkingDraft` / `updateAnswerDraft` 之前，实时检查 `app.workspace.getActiveViewOfType(MarkdownView)?.file.path` 是否与当初发起请求时的 `context.file.path` 一致。
*   **异常处理**：如果检测到上下文已偏移，应暂停流式写入，或者在后台默默接收完数据后，等用户切回该文件时再进行同步。

## 5. 优化 `floating-ui.ts` 的 DOM 构建方式

**现状**：
浮窗界面完全依赖纯粹的原生 DOM API（大量的 `document.createElement`, `classList.toggle` 等）构建，状态与视图混合在一起，随着悬浮菜单和模板功能的增加，代码维护难度上升。

**优化方案**：
在不引入 React 等重型框架的前提下：
*   **组件化抽象**：将 UI 拆分为小型的 Class 组件（如 `TemplateMenuComponent`, `InputBoxComponent`），每个组件维护自己的内部状态和 Render 逻辑。
*   **事件驱动**：利用简单的 EventTarget 或回调机制完成组件与主控模块的通信，解耦视图层和业务层。

---

## 6. 修复后端的“双重会话状态”与数据丢失隐患 (Server 端核心问题)

**现状**：
目前 Python Server 存在严重的状态冲突：
1. 底层 `Nanobot Adapter` 会基于 `.jsonl` 文件持久化对话历史。
2. 上层的 `InMemorySessionStore` 又在内存中维护了一份 `history`，同时存储了自动生成的 `title`。
在 `prompt_builder.py` 的 `build_chat_prompt` 中，把内存中的历史记录手动拼接到当前的 User Prompt 里，导致大模型收到双重上下文，**极大地浪费了 Token 并引起模型混乱**。此外，Python Server 重启会导致内存清空，**丢失所有会话标题**。

**优化方案**：
*   **移除历史硬拼接**：信任底层 Nanobot 的历史记录管理机制，删除 `prompt_builder.py` 中拼接 `session.history[-8:]` 的冗余逻辑。
*   **持久化会话标题**：废弃 `InMemorySessionStore` 的纯内存存储，改为轻量级的本地持久化方案（例如 `sessions/metadata.json` 或 SQLite），将 `session_id` 与生成的 `title` 和时间戳安全落盘。

## 7. 解决 `app.py` 路由过度臃肿与模块耦合

**现状**：
`app.py` 膨胀至 700 多行，包含了配置加载、后台任务（自动生成标题 `_schedule_session_title_generation`）、流式 XML 标签解析器（`_TaggedStreamParser`）、以及所有的业务接口路由（`/invoke`, `/chat/stream`, `/providers`, `/sessions` 等）。

**优化方案**：
*   **基于 `APIRouter` 拆分路由**：利用 FastAPI 的 Router 机制，将逻辑拆分到：
    *   `routes/chat.py`：负责大模型对话和流式接口。
    *   `routes/providers.py`：专门管理模型供应商 CRUD。
    *   `routes/sessions.py`：管理历史会话列表。
*   **拆分后台任务**：将会话标题生成的异步任务剥离至专门的 `services/title_generator.py` 中。

## 8. 强化流式标签解析器 (`_TaggedStreamParser`) 的健壮性

**现状**：
目前分离 `<thinking>` 和 `<answer>` 依赖手写的字符串搜索状态机。由于大模型输出的高度不确定性（可能大小写错乱、可能忘写闭合标签 `</thinking>`），单纯基于 `indexOf` 和缓冲区 `holdback` 的状态机极易卡死或导致内容截断。

**优化方案**：
*   **前端处理方案（推荐）**：简化 Server 端的解析负担，后端将 Raw Data 透传，让前端（Obsidian 客户端）借助正则或 DOM 更新策略去处理分离。
*   **后端增强方案**：如果必须在后端分离，引入更健壮的正则表达式流式处理，并增加强制兜底逻辑（如遇到特定的回答标识符或到达一定长度后强制跳出 `thinking` 模式）。

## 9. 优化本地配置与 API Key 环境变量管理

**现状**：
在 `provider_config_store.py` 的 `_upsert_env_value` 方法中，程序强行读写本地物理 `.env` 文件来存储用户的 API Key。这种做法在并发请求下不安全，容易导致文件损坏，且暴露了密钥文件。

**优化方案**：
*   **剥离 .env 强依赖**：改用专门加密或忽略版本控制的本地 JSON 配置管理 API Key，而非重写物理环境变量文件。API Key 可作为运行时动态配置参数传入 Adapter，无需常驻真实环境变量。