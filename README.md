# dont-ask-me-again

一个由 Obsidian 插件和本地 FastAPI 服务组成的项目，用于基于当前笔记上下文生成带会话能力的 AI 内容。

## 当前状态

- 目前已经是一个可运行的双端项目：
  - 仓库根目录是 Obsidian 插件
  - `server/` 是本地 FastAPI 服务
- 核心工作流已经落地：
  - 读取当前笔记内容与可选选中文本
  - 将笔记上下文发送给本地会话型 AI 服务
  - 以流式方式把 thinking / answer 内容写回当前笔记
  - 基于选中文本生成新的关联笔记
- 会话能力已经实现：
  - 新建会话
  - 切换会话
  - 清空当前会话
  - 从本地 runtime 工作区读取历史会话列表
- 插件设置页已经支持模型与提供商管理：
  - 新增 / 编辑 / 删除模型配置
  - 设置默认模型
  - 配置独立的标题生成模型和生图模型
- 本地服务集成已经实现：
  - 健康检查与自动启动流程
  - DAMA 原生流式接口
  - OpenAI Responses 兼容接口
  - provider 配置同步与本地密钥存储
- 图像生成功能已经接通：
  - 可以按请求启用生图
  - 可以接收服务端返回的图片事件
  - 可以把生成图片保存到当前 vault 文件夹
- 配置标题模型后，支持自动生成会话标题。
- 前后端测试框架都已经存在：
  - TypeScript 单元测试覆盖插件模块
  - Python 测试覆盖服务端路由、schema、配置、prompt 组装、session metadata 和 image generation
- 插件入口：`src/main.ts`
- 本地服务入口：`server/app.py`
- 默认服务地址：`http://127.0.0.1:8787`
- Vendor 子模块：`vendor/nanobot`
- 为了聚焦 Obsidian 插件和本地 API 服务，本仓库移除了 `vendor/nanobot/webui`

## 已实现功能

- Obsidian 内悬浮输入框，可基于当前笔记直接发起 AI 请求
- 基于选区的操作：
  - 将选中文本引用进输入框
  - 从编辑器右键菜单使用模板
  - 基于选中文本生成一篇全新的笔记
  - 在源笔记中插入指向新笔记的反向链接
- 流式响应渲染，并区分 thinking / answer 内容
- Session Picker 弹窗，用于浏览和切换会话
- 从插件设置中自动启动本地服务
- 模型 / provider 设置界面，以及本地 API key 存储
- 同时支持原生 tool-stream 请求格式和 OpenAI Responses 风格请求
- 可选的图片生成能力，生成文件会保存进 vault
- 可选的自动会话标题生成
- 通过 vendored `nanobot` 作为底层 runtime，但保持服务边界清晰

## 已知限制

- 当前仍然是早期版本，版本号为 `0.1.0`，还不算面向公开用户的成熟插件发布版。
- 端到端效果仍然依赖可用的本地 provider 配置，以及正常运行的本地服务。
- 在当前受限沙箱环境里，Node 侧的 `pnpm test` / `pnpm run build` 可能因为 `spawn EPERM` 失败，因此命令验证有时需要在限制更少的本地环境下进行。

## 环境约定

- Python 虚拟环境使用 `uv` 管理。
- Node 依赖（`node_modules`）使用 `pnpm` 管理。

## 运行要求

- Node.js 18+
- `pnpm` 10+
- Python 3.11+
- `uv`

## 快速开始（Windows PowerShell）

1. 初始化本地环境：

```powershell
pnpm run setup
```

2. 安装 Node 依赖：

```powershell
pnpm install
```

3. 创建 Python 虚拟环境并安装服务端依赖：

```powershell
uv venv server/.venv
uv pip install --python server/.venv/Scripts/python.exe -r server/requirements.txt
```

4. 准备 runtime 配置文件：

```powershell
Copy-Item server/nanobot.config.example.json server/nanobot.config.json
```

5. 在插件设置界面中配置模型提供商。Provider 密钥会存储在本地 `server/provider_secrets.json`。

6. 启动本地 API 服务：

```powershell
server/.venv/Scripts/python.exe -m uvicorn server.app:app --host 127.0.0.1 --port 8787
```

7. 构建插件：

```powershell
pnpm run build
```

如果你已经运行过 `pnpm run setup`，第 3 步和第 4 步通常可以跳过。

## 开发命令

```powershell
pnpm run dev
pnpm run test
pnpm run build
```

## 配置文档

- 服务端说明：[`server/README.md`](server/README.md)

## 被 Git 忽略的本地文件

- `.env`
- `server/.env`
- `server/nanobot.config.json`
- `server/model_providers.json`
- `server/provider_secrets.json`
- `server/.venv`
