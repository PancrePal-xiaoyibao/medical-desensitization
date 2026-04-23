# medical-desensitization

病历脱敏工作台。

这个仓库用于演示和交付“小胰宝”中的病历资料脱敏能力：在用户把病历、检查报告和聊天记录发给 AI 之前，先做文本抽取、敏感信息识别与脱敏，再把安全版本送入现有 AI 对话流程。

当前产品定位很明确：

- 主要处理 PDF 病历和纯文本病例资料
- 重点解决姓名、手机号、身份证号、地址、病历编号等敏感信息脱敏
- 输出适合继续发给 AI、继续归档或继续人工整理的安全版本文本

当前仓库交付方式与社区里现有公开 repo 保持一致，优先提供：

- 完整源码
- 清晰的 README
- 本地启动方式
- 交付说明与验收路径

当前默认不是“必须先上线到公网才能看”的项目。没有域名也可以直接本地运行和演示。

## 项目概览

前端和后端现在是彻底分离的两套进程：

- 前端：Next.js，只负责页面、交互、录音采集和调用后端
- 后端：Go，独立提供 `/api/chat`、`/api/stt`、`/api/stt/ws`、`/api/tts`、`/api/desensitize`

密钥只允许存在于 Go 后端环境变量中。前端只持有后端地址，不再包含任何第三方服务代理逻辑。

## 当前能力

- 文本直贴脱敏
- 图片 OCR 抽字后脱敏
- PDF 文本层提取后脱敏
- 手动选中文字补充脱敏规则
- 将脱敏后的安全文本直接发送到现有 AI 对话流

## 适用场景

- 医生、运营或患者家属需要先整理病例，再把内容发给 AI 做总结、问答或改写
- 需要把连续性的癌症病例资料先统一脱敏，再进行下一步分析
- 团队内部先输出安全版病例文本，再做归档、分享或二次加工

## 后续可扩展方向

- 批量上传：很多癌症患者的病例是连续性的，适合一次上传多份 PDF / 文本并复用同一套脱敏规则
- 批量导出：脱敏结果优先导出成 Markdown 即可，便于技术团队继续整理、入库或喂给后续工具
- 规则复用：支持把一位患者在同一阶段的脱敏规则保存下来，后续批量处理时直接复用

## 目录结构

- `src/`：前端 UI
- `backend/`：Go 原生后端
- `.env.example`：前端环境变量模板
- `backend/.env.example`：后端环境变量模板

## 演示入口

本地启动后，浏览器打开：

```text
http://localhost:3000
```

首页即为“病历脱敏工作台”。

## 交付说明

详细交付说明见：

- [`MEDICAL_DESENSITIZATION_HANDOFF.md`](./MEDICAL_DESENSITIZATION_HANDOFF.md)

建议演示路径：

1. 打开首页
2. 上传病历图片 / PDF，或直接粘贴文本
3. 点击“开始识别并脱敏”
4. 查看右侧脱敏结果、分类统计和识别明细
5. 如已接入 AI 服务，再点击“发送脱敏文本给 AI”

## 前后端分离约束

- Next.js `src/app/api` 已移除，前端仓库不再提供业务 API
- 豆包 / 阿里云 / chat 的密钥只给 Go 后端
- 前端通过 `NEXT_PUBLIC_API_BASE_URL` 和 `NEXT_PUBLIC_WS_BASE_URL` 访问后端
- 流式语音识别走 Go 后端的 WebSocket，再由 Go 后端代理到上游服务

## 启动方式

1. 安装前端依赖

```bash
npm install
```

后端需要 Go 1.25.8 或更高版本；仓库已在 `backend/go.mod` 中锁定该版本，旧版本 Go 在执行 `go run`、`go build`、`go test` 时会继续触发标准库漏洞告警。

2. 配置前端环境变量

根目录创建 `.env.local`：

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
# 可选；不填时默认从 NEXT_PUBLIC_API_BASE_URL 推导
NEXT_PUBLIC_WS_BASE_URL=
```

3. 配置后端环境变量

复制`backend/.env.example` 为 `backend/.env`
Go backend 启动时会自动读取这个文件；如果你已经在 shell 里显式导出同名环境变量，显式值优先，不会被 `backend/.env` 覆盖。

最小配置通常至少包括：

```env
BACKEND_PORT=8080
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://localhost:3000
LOG_LEVEL=log
CHAT_PROVIDER=fastgpt
CHAT_API_URL=https://your-fastgpt-host/api/v1/chat/completions
CHAT_API_KEY=fastgpt-app-key
CHAT_REQUEST_TIMEOUT_MS=300000
FASTGPT_STREAM_DETAIL=false
STT_PROVIDER=doubao
TTS_PROVIDER=doubao
DOUBAO_STT_APP_ID=...
DOUBAO_STT_ACCESS_KEY=...
DOUBAO_TTS_APP_ID=...
DOUBAO_TTS_ACCESS_KEY=...
DOUBAO_TTS_SPEAKER=...
```

如果 chat 上游是 FastGPT：

- `CHAT_PROVIDER=fastgpt`
- `CHAT_API_URL` 使用 FastGPT 文档里的 `/api/v1/chat/completions`
- 前端会自动把当前会话 ID 作为 `chatId` 传给后端，后端再转发给 FastGPT
- `FASTGPT_STREAM_DETAIL=false` 时，返回的是 OpenAI 风格 SSE，当前前端可直接解析
- 如果你后续要接 FastGPT 的工作流节点事件，再把 `FASTGPT_STREAM_DETAIL=true`
- `LOG_LEVEL=log` 只输出常规日志；`LOG_LEVEL=debug` 会额外输出上游握手、SSE/STT WebSocket 细节和请求调试信息

4. 启动后端

```bash
npm run dev:backend
```

5. 启动前端

```bash
npm run dev
```

如需 HTTPS 前端开发环境：

```bash
npm run certs
npm run dev:https
```

## 构建

前端构建：

```bash
npm run build
```

后端构建：

```bash
npm run build:backend
```

前端生产启动：

```bash
npm start
```

后端生产启动：

```bash
go run ./backend/cmd/server
```

## 一体化部署

仓库根目录已经提供单服务部署方案：

- `Dockerfile`：同时构建 Next.js 前端和 Go 后端
- `render.yaml`：可直接导入 Render Blueprint
- 容器内通过 Nginx 暴露单一公网入口

这套部署方式的特点：

- 不需要先购买域名
- 前端和后端共用一个公网地址
- 浏览器直接访问同域名，不需要额外处理跨域

在 Render 中部署时，直接导入本仓库即可。服务启动后会得到一个类似 `https://xxx.onrender.com` 的公网地址。

如果只做病历脱敏演示，默认配置就可以先跑起来；如果要启用 AI 对话、语音识别、语音播报，再去补充对应环境变量即可。

如果只是对齐社区里现有 repo 的交付方式，则本地运行 + README 说明已经足够，不必强制购买域名。

## 校验

前端：

```bash
npm run lint
npx tsc --noEmit
```

后端：

```bash
npm run test:backend
cd backend && go build ./cmd/server
```
