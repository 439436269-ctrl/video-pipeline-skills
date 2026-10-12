# AGENTS.md — 短视频生产流水线的 19 个 skill

本仓提供 19 个 skill（`SKILL.md` 格式），来自一条已经跑通的 AI 短剧生产流水线。**Codex / Claude Code / 任何支持 `SKILL.md` 的宿主都能用**：agent 读的是 `skills/<name>/SKILL.md`，里面是任务指令与脚本路径。

## 怎么用（给 agent 的入口说明）

1. 先读 `skills/video-pipeline/SKILL.md` —— 总入口，说明这 19 个 skill 各管什么、每个环节该加载哪一个。
2. 要完整跑一集，读 `skills/tangshi-pipeline/SKILL.md` —— 编排层，含双版本规格、时序、成本基线、质量门。
3. 只做其中一步（配音 / 出图 / 出视频 / 合成 / 封面 / 核验 / 复盘 / 发布）就只读对应的原子 skill。

## 19 个 skill

| skill | 作用 |
|---|---|
| `video-pipeline` | 总入口：环节与原子 skill 对照、占位符、前置依赖 |
| `tangshi-pipeline` | 编排：选题 → 门①报价 → 生产调度 → 门②发布确认 → 并行发布 → 回写 |
| `chinese-tts` | 中文配音：多音字读音校正 + 音色/context 模板 |
| `ark-agent-plan-image` | 火山 Agent Plan 通道文生图 |
| `ark-seedream-image` | 火山标准通道文生图（按量付费） |
| `ark-seedance-video` | Seedance 文生视频 / 图生视频（单条镜头） |
| `image-to-video` | 单张关键帧 → ffmpeg zoompan 运镜镜头 |
| `dreamina-canvas-cli` | 即梦画布 CLI（备用生成线） |
| `video-compose` | 镜头 + 配音时间轴 + SRT → 竖屏成片 |
| `video-cover` | B 站 16:10 与竖屏双封面 |
| `media-verify` | astats 音频对位 / 线上音频比对 / 抽帧白屏检测 |
| `tangshi-data-review` | 三平台播放数据采集与复盘报告 |
| `quad-platform-publish` | 四平台发布总控（含发布前读音核查与确认门） |
| `multi-platform-publish-orchestrator` | 按 JSON 配置顺序批量发布 |
| `bilibili-upload` | B 站投稿与合集管理（biliup） |
| `tencent-upload` | 视频号上传与合集管理 |
| `douyin-publish` | 抖音创作者中心上传发布与合集管理 |
| `xiaohongshu-skills` | 小红书发布 / 检索 / 互动（第三方 MIT，见 THIRD-PARTY-NOTICES.md） |
| `feishu-bitable` | 飞书多维表格读写（进度回写） |

## 关键交接（按图走）

```
chinese-tts ──wav──┐
生图(3 条线) ─关键帧─→ image-to-video ─镜头─┐
生图 ─首帧─→ ark-seedance-video ─镜头─────┴→ video-compose → media-verify
                                                              │核验通过
                                                              ▼
                       quad-platform-publish → 4 个平台 skill → feishu-bitable 回写
                                    ▲
                    tangshi-data-review（复盘修正选片权重，闭环回 tangshi-pipeline）
```

编排图（PNG/SVG）在上游仓：<https://github.com/439436269-ctrl/dsh-video-pipeline/tree/main/docs>

## 前置依赖

本仓只有 skill（指令与脚本），**不安装任何工具**：需要 ffmpeg（合成/运镜/核验）、Python 3 + Pillow（封面与图处理）、Node.js（`scripts/` 下的 mjs）、必要时 playwright（发布类），以及各平台自己的登录凭据。**本仓不含任何凭据。**

## 来源与许可

- 本仓内容由上游仓生成（`tools/sync-skills.mjs`），上游是 DSH 插件 `dsh-video-pipeline`；skill 正文只在那边维护，这边是下游分发。
- 上游发布前已剥离真实密钥、账号标识、个人路径与真实运营数据。
- `xiaohongshu-skills` 是第三方 MIT 代码；`douyin-publish` 改写自第三方 MIT 项目。署名与许可全文见 `THIRD-PARTY-NOTICES.md`。
