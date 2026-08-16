# pi-gitee-ai

[Pi](https://pi.dev) 扩展包：接入 [模力方舟 / Gitee AI](https://ai.gitee.com)（Serverless API），提供大模型 + 5 个实用工具。

## 功能

- **Provider `gitee-ai`**：注册 4 个 LLM 模型
  - `deepseek-v4-flash-0731`（DeepSeek V4 Flash）
  - `GLM-5.2`
  - `kimi-k3`
  - `Kimi-K2.7-Code`
- **工具（供 agent 自动调用）**

| 工具 | 能力 | 默认模型 |
|------|------|----------|
| `gitee_embed` | 文本向量化 | `Qwen3-Embedding-4B`（免费） |
| `gitee_rerank` | 候选文档相关性重排 | `Qwen3-Reranker-4B`（免费） |
| `gitee_vision` | 图片理解 / 通用 OCR | `Qwen3-VL-32B-Instruct` |
| `gitee_parse` | 高精度文档解析（PDF/图片/docx/pptx，输出 Markdown） | `MinerU2.5-Pro` |
| `gitee_image` | 文生图，自动保存到磁盘并返回文件路径 | `FLUX.2-klein-4B` |

所有工具的模型均可通过参数覆盖。

## 安装

```bash
# 从 npm
pi install npm:pi-gitee-ai

# 或从 git
pi install git:github.com/ZhaoCake/pi-gitee-ai@v0.1.0
```

## 配置 API Key

在模力方舟控制台创建访问令牌：<https://ai.gitee.com/dashboard/settings/tokens>

设置环境变量（任意一种方式）：

```bash
# fish
set -gx GITEE_AI_API_KEY "你的令牌"

# bash/zsh
export GITEE_AI_API_KEY="你的令牌"
```

或者在 pi 里用 `/login gitee-ai` 交互输入（会存入 `~/.pi/agent/auth.json`，不留在环境变量里）。

## 使用

```bash
pi --list-models              # 应看到 gitee-ai 的 4 个模型
pi --provider gitee-ai        # 用 gitee-ai 作为 provider
```

在交互式会话中，agent 会根据任务自动调用 `gitee_*` 工具（例如你让它"解析这份 PDF"或"把这两段文本向量化比较相似度"）。

也可以手动指定工具引用的模型，例如：

> 用 gitee_parse 解析 report.pdf，table_enable=true
> 用 gitee_embed 向量化这几个句子，model=Qwen3-Embedding-8B

## 更新

```bash
pi update --extensions        # 更新所有包（含本包）
pi update npm:pi-gitee-ai     # 只更新本包（若通过 npm 安装）
```

若通过 git tag 安装，`pi update` 会停留在已 pin 的 tag；升级到新版需显式指定：

```bash
pi install git:github.com/ZhaoCake/pi-gitee-ai@v0.2.0
```

## 安全说明

- **API key 不会硬编码**：运行时从 `GITEE_AI_API_KEY` 环境变量 / `auth.json` 读取。
- 包内扩展代码以完整系统权限运行（pi 扩展的通用特性），安装第三方包前请审阅源码。

## 开发 / 发布

```bash
# 1. 修改 extensions/ 下的代码（改完可本地验证：pi --list-models ／直接在会话里调工具）
# 2. 提交并推送
git add -A && git commit -m "feat: ..."
git push origin main

# 3. 发新版：改 package.json 的 version（或 npm version patch），打新 tag 并推送
git tag v0.2.0 && git push origin v0.2.0

# 4.（可选）发布到 npm
npm publish          # 需 npm 账号；或配置 GitHub Actions 推 tag 自动发布
```

版本约定：用户通过 `pi install git:...@vX.Y.Z` 安装，升级时显式指定新 tag。

## 致谢

- [模力方舟 Gitee AI](https://ai.gitee.com) — 提供 Serverless API
- [MinerU](https://github.com/opendatalab/MinerU) — 文档解析能力