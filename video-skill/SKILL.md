---
name: video-transcribe
description: |
  视频转录工具。从URL（哔哩哔哩/抖音等）下载音频并转录为文字，智能纠错格式化后，结构化输出Markdown文件，并通过当前聊天窗口发送Markdown文件。
---

# video_transcribe

## 触发条件
用户发送视频链接，要求"转录"、"字幕"、"文字版"或"整理视频内容"

## 参数
- `video_url`（必填）：视频页面URL，支持哔哩哔哩、抖音、yt-dlp支持的平台
- `language`（可选）：转录语言，默认 Chinese
- `model_size`（可选）：Whisper兜底模型，默认 base
- `title`（可选）：文档标题，默认视频标题或"视频转录-YYYYMMDD"

## 工作流
下载音频 → 语音转写（硅基流动API优先，Whisper兜底）→ MiniMax智能纠错+结构化 → 输出Markdown

## 环境变量
- `SILI_FLOW_API_KEY`：硅基流动API密钥（可选）
- `MINIMAX_API_KEY`：MiniMax API密钥（可选）
- 均未设置时使用本地Whisper转录

## 输出
Markdown文件保存在 `/tmp/video_transcribe/{title}.md`，并通过当前聊天窗口发送输出文件

## 执行方式

调用 `transcribe.py` 脚本执行转录：

```bash
python transcribe.py <video_url> [language] [model_size] [title]
```

**示例：**
```bash
# 基础用法（仅必填参数）
python transcribe.py "https://www.bilibili.com/video/BV1xx411c7mD"

# 指定语言和标题
python transcribe.py "https://www.bilibili.com/video/BV1xx411c7mD" "Chinese" "" "Python教程"

# 完整参数（语言、模型大小、标题）
python transcribe.py "https://v.douyin.com/xxxxx" "Chinese" "base" "抖音视频转录"
```

**输出格式：** 脚本在 stdout 输出 `JSON_OUTPUT:{json}`，其中包含：
- `status`：执行状态
- `markdown_file`：生成的Markdown文件路径
- `title`：文档标题
- `video_url`：原始视频链接
- `platform`：来源平台
- `raw_chars`：原始转录字符数
