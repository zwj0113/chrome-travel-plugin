# 旅游攻略助手 Chrome 插件设计文档

> 日期：2026-05-08
> 状态：已确认

## 1. 概述

### 1.1 产品定位

Chrome 浏览器侧边栏插件，面向旅游攻略信息收集场景，一键从视频平台（YouTube、B站、抖音）和小红书提取内容，生成一站式 Markdown 文件。

### 1.2 核心功能

1. **视频平台**：下载视频 + 语音转录 + 内容总结 + 抓取评论
2. **小红书**：图片理解 + 笔记文本提取 + 内容总结 + 抓取评论
3. **统一输出**：生成包含所有信息的一站式 Markdown 文件，支持下载

### 1.3 目标平台

| 平台 | 内容类型 | 核心能力 |
|------|---------|---------|
| YouTube | 视频 | 视频下载、语音转录、评论 |
| Bilibili | 视频 | 视频下载、语音转录、评论 |
| 抖音 | 视频 | 视频下载、语音转录、评论 |
| 小红书 | 图文笔记 | 图片理解、文本提取、评论 |

## 2. 架构设计

### 2.1 整体架构：适配器 + 流水线

采用三层架构：

```
网页层（Content Scripts）  ←→  后台服务层（Service Worker）  ←→  侧边栏（Side Panel）
     4个平台适配器                  5个核心模块                    UI交互
```

**选择理由：**
- 平台适配器只做 DOM 提取（薄层），核心逻辑集中在 Background
- 新增平台只需添加适配器，不影响流水线
- AI 调用和降级策略统一管理

### 2.2 组件职责

#### 网页层 — 平台适配器

每个平台一个适配器 Content Script，职责：检测页面类型、提取 DOM 数据、发送给 Background。

统一接口：

```typescript
interface AdapterOutput {
  platform: "youtube" | "bilibili" | "douyin" | "xiaohongshu"
  type: "video" | "note"
  url: string                    // 当前页面 URL
  title: string                  // 标题
  author: string                 // 作者
  publishDate?: string           // 发布日期
  description?: string           // 简介/描述
  mediaUrls: string[]            // 视频/音频URL（视频类）或图片URL（图文类）
  subtitleUrl?: string           // 字幕URL（如有）
  comments: Comment[]            // 评论列表
  rawText?: string               // 页面纯文本内容（图文类）
  metadata: Record<string, any>  // 平台特有元数据（播放量、点赞数等）
}

interface Comment {
  author: string
  content: string
  likes: number
  time: string
  replies?: Comment[]
}
```

各适配器提取要点：

| 适配器 | 核心提取内容 | 实现要点 |
|--------|-------------|---------|
| YouTube | 视频流URL、自动字幕、元数据、评论 | 视频URL从页面JS变量提取；评论需滚动加载 |
| Bilibili | 视频流URL、弹幕、元数据、评论 | 可调用B站API（bv号→cid→播放地址） |
| Douyin | 视频流URL、元数据、评论 | 解析分享链接获取无水印视频；页面结构变化频繁 |
| Xiaohongshu | 图片URL列表、笔记文本、元数据、评论 | 图片需处理水印；笔记文本从DOM提取 |

#### 后台服务层 — Service Worker

5 个核心模块：

1. **Pipeline Orchestrator** — 流水线编排器，控制 整体流程：提取→下载→转录→总结→评论→生成MD
2. **Video Downloader** — 视频下载器，从适配器提供的 URL 下载音频/视频，通过 Offscreen Document 提取音频轨道
3. **AI Service** — AI 服务，统一管理硅基流动和 DeepSeek API 调用，处理降级逻辑
4. **Markdown Generator** — Markdown 生成器，按模板生成一站式 MD 文件
5. **Config Manager** — 配置管理，管理 API Key、评论设置等

#### 侧边栏 — Side Panel

三种状态：
- **空闲首页**：品牌标识 + 一键提取按钮 + 最近记录列表
- **处理中**：分步骤实时进度展示
- **完成预览**：Markdown 预览 + 下载/复制按钮

### 2.3 数据流

**视频类页面：**

```
用户点击 → 适配器提取视频URL/元数据
         → 下载音频（Offscreen Document 处理）
         → 硅基流动转录（失败→Whisper降级）
         → DeepSeek 内容总结
         → 抓取评论（可配置数量和排序）
         → 生成 Markdown
         → 侧边栏预览 + 下载
```

**图文类页面：**

```
用户点击 → 适配器提取图片/文本/元数据
         → DeepSeek 图片理解 + 内容总结
         → 抓取评论（可配置数量和排序）
         → 生成 Markdown
         → 侧边栏预览 + 下载
```

## 3. AI 服务与降级策略

### 3.1 AI 服务接口

```typescript
interface AIService {
  // 语音转文字 — 硅基流动优先，Whisper 降级
  transcribe(audioBlob: Blob): Promise<string>

  // 图片理解 — DeepSeek Vision
  describeImage(imageUrl: string): Promise<string>

  // 内容总结 — DeepSeek
  summarize(content: string, context: string): Promise<string>
}
```

### 3.2 降级与容错

| 场景 | 主方案 | 降级方案 | 失败处理 |
|------|--------|---------|---------|
| 语音转文字 | 硅基流动 ASR（SenseVoiceSmall 模型） | 本地 Whisper | 标记转录失败，仍输出其他内容 |
| 图片理解 | DeepSeek Vision | 跳过，仅记录图片URL | 标记图片未识别 |
| 内容总结 | DeepSeek | 跳过总结，仅输出原始转录/文本 | 不影响MD生成 |
| API Key 缺失 | — | — | 侧边栏提示用户配置 |

### 3.3 音频处理流程

1. 适配器提取视频URL → Background 下载视频
2. 通过 Offscreen Document 使用 Web Audio API 提取音频轨道
3. 音频转码为 16kHz WAV（硅基流动要求格式）
4. 调用硅基流动转录（`FunAudioLLM/SenseVoiceSmall` 模型），失败则送入本地 Whisper
5. 返回转录文本

### 3.4 本地 Whisper

初期不实现，仅保留接口。原因：
- Chrome 插件内运行 Whisper 模型需要 WASM + Offscreen Document，技术复杂度高
- 硅基流动 API 稳定性足够，降级场景少
- 后续可按需扩展，不影响主架构

## 4. 侧边栏 UI 设计

### 4.1 空闲首页

- 品牌标识（旅游攻略助手）
- "一键提取当前页面"主按钮
- 最近记录列表（平台、标题、时间）

### 4.2 提取配置弹窗

点击"一键提取"时弹出，配置本次提取参数：

- **评论数量**：热门前 20/50/100 条，或全部
- **评论排序**：按热度 / 按时间
- **视频下载**：仅转录 / 下载+转录

### 4.3 处理中状态

分步骤实时进度展示，每步有状态标识：
1. ✓ 提取视频/图文信息
2. ✓/⟳ 下载音频/获取图片
3. ✓/⟳ 语音转录/图片理解
4. ✓/⟳ 内容总结
5. ✓/⟳ 抓取评论
6. ✓/⟳ 生成 Markdown

支持取消操作。

### 4.4 完成预览

- 标题 + 统计信息（平台、字数、评论数）
- Markdown 预览区域（可滚动）
- "下载 Markdown"按钮
- "复制到剪贴板"按钮

## 5. Markdown 输出格式

### 5.1 视频类页面

```markdown
# {标题}

> 📌 来源：{平台} | 作者：{作者} | 发布：{日期}
> 🔗 {URL}
> 📊 播放 {播放量} | 点赞 {点赞数} | 收藏 {收藏数}

---

## 📝 内容总结

{DeepSeek 生成的总结}

---

## 🎬 转录文本

{完整转录内容}

---

## 💬 评论（{排序方式}，前{N}条）

### [1] @{用户名}
{评论内容}

### [2] @{用户名}
{评论内容}

（N条评论）

---

*由旅游攻略助手生成 | {生成时间}*
```

### 5.2 图文类页面

```markdown
# {标题}

> 📌 来源：小红书 | 作者：{作者} | 发布：{日期}
> 🔗 {URL}
> ❤️ 点赞 {点赞数} | 收藏 {收藏数}

---

## 📝 内容总结

{DeepSeek 生成的总结}

---

## 🖼️ 图片解读

### 图1
{DeepSeek 对图片的描述}

### 图2
{DeepSeek 对图片的描述}

---

## 📖 笔记原文

{完整笔记文本}

---

## 💬 评论（{排序方式}，前{N}条）

### [1] @{用户名}
{评论内容}

（N条评论）

---

*由旅游攻略助手生成 | {生成时间}*
```

## 6. 配置与权限

### 6.1 API Key 管理

| API | 用途 | 配置方式 |
|-----|------|---------|
| 硅基流动（SILI_FLOW_API_KEY） | 语音转录 | 设置页输入，存入 chrome.storage.local |
| DeepSeek（DEEPSEEK_API_KEY） | 图片理解 + 内容总结 | 设置页输入，存入 chrome.storage.local |

- API Key 存储在 `chrome.storage.local`，不上传、不泄露到内容脚本
- 首次使用时侧边栏顶部显示"请先配置 API Key"提示
- 支持一键测试 API Key 有效性

### 6.2 Chrome 插件权限

```json
{
  "permissions": [
    "sidePanel",
    "storage",
    "downloads",
    "activeTab"
  ],
  "host_permissions": [
    "*://*.youtube.com/*",
    "*://*.bilibili.com/*",
    "*://*.douyin.com/*",
    "*://*.iesdouyin.com/*",
    "*://*.xiaohongshu.com/*",
    "*://*.xhscdn.com/*"
  ],
  "optional_permissions": [
    "offscreen"
  ]
}
```

### 6.3 设置页面（Options Page）

- API Key 配置（硅基流动、DeepSeek）
- 评论默认数量和排序方式
- 转录语言偏好（中文/英文/自动检测）
- 历史记录管理（查看/删除/导出）

## 7. 技术参考

基于 `video-skill` 技能包的已有实现经验：

- **硅基流动转录**：使用 `FunAudioLLM/SenseVoiceSmall` 模型，API 端点 `https://api.siliconflow.cn/v1/audio/transcriptions`
- **视频下载**：原方案依赖 `yt-dlp` + `ffmpeg`，Chrome 插件中改为从页面 DOM 直接提取视频 URL，用 `fetch` 下载
- **音频提取**：原方案用 `ffmpeg`，Chrome 插件中改为通过 Offscreen Document + Web Audio API 处理
- **抖音处理**：原方案解析分享链接获取 `modal_id` → 请求页面提取视频 URL，插件中由适配器在页面内直接完成
- **文本纠错**：原方案用 MiniMax，本设计改为 DeepSeek 统一处理
