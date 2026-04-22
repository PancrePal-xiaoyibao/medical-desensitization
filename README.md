<p align="center">
  <img src="./public/opencare-logo.png" width="120" alt="OpenCare Logo" />
</p>

<h1 align="center">OpenCare - 社区病历脱敏工具</h1>

<p align="center">
  <em>面向 AI 问诊时代的医疗数据隐私保护盾牌 🛡️</em>
</p>

<p align="center">
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-black?style=flat&logo=next.js&logoColor=white">
  <img alt="Go" src="https://img.shields.io/badge/Go-00ADD8?style=flat&logo=go&logoColor=white">
  <img alt="Tailwind CSS" src="https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat&logo=tailwind-css&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat">
</p>

---

## 🌟 项目简介

OpenCare 是专为社区与医疗场景打造的**病历脱敏工作台**。

随着 AI 大模型在医疗问诊环节的渗透，将未处理的实体病历直接输送给云端大模型面临严重的隐私合规风险。OpenCare 提供了一套开箱即用的前后端分离解决方案，通过多维解析和精准打码，**确保发送给云端 AI 模型的医疗文本剥离所有个人敏感信息 (PII/PHI)**，从而安全合规地在各项 AI 对话流中发挥作用。

## ✨ 核心特性

- 🔏 **多元病历脱敏工作台**
  - **文本直贴**：即时识别并处理敏感关键文本
  - **图片 OCR 解析**：自动化提取化验单、放射报告等影像文字并进行脱敏
  - **PDF 深度提取**：通过文本层抓取引擎对数字版 PDF 进行合规处理
  - **精细化手动干预**：支持前端页面点选文字，灵活增补额外的脱敏规则
- 🤖 **无缝打通大模型**
  - 可将脱敏后的安全文本 **一键接驳** 到现有的 AI 对话模型（如 FastGPT 等），避免割裂的工作流。
  - WebSockets 支持流式语音识别，直接从音频到 AI。
- 🔒 **极致安全架构**
  - **密钥不出域**：所有大模型或服务平台（豆包、阿里云等）的 Token 和代理逻辑全权交由 Go 后端管理。前端仅保留交互与展示视图，物理级别杜绝前端 API Key 泄露。

## 🏛️ 项目结构

针对系统安全要求，系统采用 **前端UI + 原生Go服务端** 的解耦架构：

- **`src/`**：前端层。基于 `Next.js` 构建，纯粹负责页面渲染、操作交互、录音采集与最终效果的呈现。（*注：原 `src/app/api` 已废弃，业务 API 均转交 Go 接管*）。
- **`backend/`**：独立服务层。基于原生 `Go` (>= 1.25.8) 实现，独立提供安全的数据出口（`/api/chat`、`/api/stt`、`/api/stt/ws`、`/api/tts`）。

## 🚀 快速接入

### 1️⃣ 安装依赖
需确保本机已安装 Node 环境以及 **Go >= 1.25.8**。
```bash
npm install
```

### 2️⃣ 环境变量配置

**前端配置（命令行复制）：**
```bash
cp .env.example .env.local
```
修改 `.env.local` 常用项：
```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
# 流式 Websockets 地址。不填时将默认从 HTTP API 地址推导
NEXT_PUBLIC_WS_BASE_URL=
```

**后端配置（命令行复制）：**
```bash
cp backend/.env.example backend/.env
```
Go Backend 启动时自动读取。建议的核心配置如下（支持显式 Shell 覆盖）：
```env
BACKEND_PORT=8080
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://localhost:3000
LOG_LEVEL=log

# ----------------------------
# AI 大模型对话配置参数 (以 FastGPT 为例)
# ----------------------------
CHAT_PROVIDER=fastgpt
CHAT_API_URL=https://your-fastgpt-host/api/v1/chat/completions
CHAT_API_KEY=fastgpt-app-key
CHAT_REQUEST_TIMEOUT_MS=300000
# 设为 false 返回普通 SSE 流，前端自动接管；设为 true 则接手底层流程事件
FASTGPT_STREAM_DETAIL=false

# ----------------------------
# 语音识别 (STT) 与 语音合成 (TTS)
# ----------------------------
STT_PROVIDER=doubao
TTS_PROVIDER=doubao
DOUBAO_STT_APP_ID=...
DOUBAO_STT_ACCESS_KEY=...
DOUBAO_TTS_APP_ID=...
DOUBAO_TTS_ACCESS_KEY=...
DOUBAO_TTS_SPEAKER=...
```
*💡 提示：如需定位握手与网络问题，可将 `LOG_LEVEL=debug`，后端将输出详细的 STT WebSocket 数据帧与请求握手细节。*

### 3️⃣ 启动本地环境

在两个并行的终端中分别启动前后端：

**后端服务 (Go):**
```bash
npm run dev:backend
```
> 默认监听 `http://localhost:8080` (取决于 `BACKEND_PORT`)。前端通过 `chatId`（当前会话 ID）传参由其转发请求。

**前端服务 (Next.js):**
```bash
npm run dev
```
> 默认运行于 `http://localhost:3000`。<br>若是需进行本地移动端调试可启动 HTTPS 版本：先执行 `npm run certs`，然后使用 `npm run dev:https`。

## 📦 构建与部署

**语法校验：**
```bash
# 前端 Lint 与 TS 校验
npm run lint
npx tsc --noEmit

# 后端单元测试与编译可用性验证
npm run test:backend
cd backend && go build ./cmd/server
```

**预生产构建：**
```bash
npm run build           # 前端 Web 构建
npm run build:backend   # 后端二进制文件打包
```

**服务器环境启动：**
```bash
npm start                       # PM2/Node 启动前端服务
go run ./backend/cmd/server     # 执行后端守卫进程
```

---

<p align="center">
  📝 详细的部署流程与接交流程见：<a href="./MEDICAL_DESENSITIZATION_HANDOFF.md">交付说明文档</a>
</p>
