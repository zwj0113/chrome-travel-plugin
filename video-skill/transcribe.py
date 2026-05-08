#!/usr/bin/env python3
"""
视频转录脚本 v4.0
功能：下载音频 → 硅基流动API转录(失败用Whisper兜底) → MiniMax纠错+结构化 → 输出Markdown → 发送飞书
优化：
1. 支持抖音视频（先下载视频再提取音频）
2. 优先使用硅基流动API，Whisper兜底
3. 合并智能纠错和结构化输出为一步
"""

import sys
import json
import subprocess
import os
import re
from datetime import datetime

# ========== 配置 ==========
VIDEO_URL = sys.argv[1] if len(sys.argv) > 1 else ""
LANGUAGE = sys.argv[2] if len(sys.argv) > 2 else "Chinese"
MODEL_SIZE = sys.argv[3] if len(sys.argv) > 3 else "base"
OUTPUT_TITLE = sys.argv[4] if len(sys.argv) > 4 else ""

TEMP_DIR = "/tmp/video_transcribe"
AUDIO_FILE = f"{TEMP_DIR}/audio.m4a"
RAW_TXT = f"{TEMP_DIR}/raw.txt"
OUTPUT_MD = f"{TEMP_DIR}/output.md"

# 配置文件路径
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "env.properties")

# ========== 加载配置（优先级：环境变量 > env.properties） ==========
def load_config():
    """从 env.properties 加载配置"""
    config = {}
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    config[key.strip()] = value.strip()
    return config

# 加载配置文件
_config = load_config()

# 硅基流动 API 配置（优先级：环境变量 > env.properties > 默认值）
SILI_FLOW_API_KEY = os.environ.get("SILI_FLOW_API_KEY") or _config.get("SILI_FLOW_API_KEY", "")
SILI_FLOW_BASE_URL = "https://api.siliconflow.cn/v1/audio/transcriptions"
SILI_FLOW_MODEL = "FunAudioLLM/SenseVoiceSmall"

# MiniMax API 配置（优先级：环境变量 > env.properties > 默认值）
MINIMAX_API_KEY = os.environ.get("MINIMAX_API_KEY") or _config.get("MINIMAX_API_KEY", "")
MINIMAX_BASE_URL = "https://api.minimaxi.com"

# ========== 1. 准备目录 ==========
os.makedirs(TEMP_DIR, exist_ok=True)


# ========== 工具函数 ==========

def run_cmd(cmd, encoding='utf-8', shell=False):
    """跨平台执行命令，正确处理编码"""
    result = subprocess.run(cmd, capture_output=True, shell=shell)
    # Windows 上 stdout可能是bytes，需要正确解码
    stdout = result.stdout
    if isinstance(stdout, bytes):
        stdout = stdout.decode(encoding, errors='replace')
    stderr = result.stderr
    if isinstance(stderr, bytes):
        stderr = stderr.decode(encoding, errors='replace')
    result.stdout = stdout
    result.stderr = stderr
    return result


def is_douyin_url(url):
    """检测是否是抖音视频URL"""
    douyin_patterns = [
        r'v\.douyin\.com',
        r'iesdouyin\.com',
        r'douyin\.com',
        r'www\.douyin\.com',
    ]
    return any(re.search(p, url) for p in douyin_patterns)


def http_request(url, options=None):
    """发送HTTP请求，返回响应"""
    cmd = ['curl', '-s', '-L', '-m', '30']
    if options and options.get('headers'):
        for k, v in options['headers'].items():
            cmd.extend(['-H', f'{k}: {v}'])
    if options and options.get('method') == 'POST':
        cmd.append('-X', 'POST')
    if options and options.get('body'):
        cmd.extend(['-d', options['body']])
    cmd.append(url)

    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.stdout


def parse_douyin_share_url(share_text):
    """解析抖音分享链接或modal_id，返回视频信息"""
    # 检查是否是 modal_id（16+位数字或 modal_id=xxx 格式）
    modal_id_match = re.search(r'(?:modal_id[=:])?(\d{16,})', share_text)
    if modal_id_match:
        modal_id = modal_id_match.group(1)
        return get_douyin_video_info_by_modal_id(modal_id)

    # 提取 URL
    url_match = re.search(r'https?:\/\/[^\s]+', share_text)
    if not url_match:
        raise ValueError('未找到有效的分享链接')

    share_url = url_match.group(0)

    # 访问分享链接，获取重定向后的 URL 和 video_id
    final_url = subprocess.run(
        ['curl', '-s', '-I', '-L', '-m', '30', share_url],
        capture_output=True, text=True
    ).stdout

    # 从 URL 中提取 video_id
    video_id_match = re.search(r'\/video\/(\d+)', final_url)
    if not video_id_match:
        # 尝试从重定向URL中提取
        video_id_match = re.search(r'\/video\/(\d+)', share_url)

    if not video_id_match:
        raise ValueError('无法从URL中提取视频ID')

    video_id = video_id_match.group(1)
    return get_douyin_video_info_by_modal_id(video_id)


def get_douyin_video_info_by_modal_id(modal_id):
    """通过 modal_id 获取抖音视频信息"""
    page_url = f"https://www.iesdouyin.com/share/video/{modal_id}/"

    # 获取页面内容
    page_content = subprocess.run(
        ['curl', '-s', '-L', '-m', '30',
         '-A', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15',
         page_url],
        capture_output=True, text=True
    ).stdout

    # 从 HTML 中提取 window._ROUTER_DATA
    match = re.search(r'window\._ROUTER_DATA\s*=\s*(.*?)<\/script>', page_content)
    if not match or not match.group(1):
        raise ValueError('从HTML中解析视频信息失败')

    # 解析 JSON
    try:
        json_data = json.loads(match.group(1).strip())
    except json.JSONDecodeError:
        raise ValueError('视频信息JSON解析失败')

    loader_data = json_data.get('loaderData', {}) or json_data

    video_data = None
    if 'video_(id)/page' in loader_data:
        video_data = loader_data['video_(id)/page'].get('videoInfoRes', {}).get('item_list', [{}])[0]
    elif 'note_(id)/page' in loader_data:
        video_data = loader_data['note_(id)/page'].get('videoInfoRes', {}).get('item_list', [{}])[0]

    if not video_data:
        raise ValueError('无法从JSON中解析视频信息')

    video_url = (video_data.get('video', {}).get('play_addr', {}).get('url_list', [''])[0] or
                 video_data.get('video', {}).get('download_addr', {}).get('url_list', [''])[0])
    # 替换 playwm 为 play 获取无水印版本
    video_url = video_url.replace('playwm', 'play')

    desc = video_data.get('desc', f'douyin_{modal_id}')
    title = re.sub(r'[\\/:*?"<>|]', '_', desc)

    return {
        'url': video_url,
        'title': title,
        'video_id': modal_id,
        'platform': 'douyin'
    }


def download_file(url, filepath):
    """下载文件"""
    subprocess.run(
        ['curl', '-s', '-L', '-m', '120',
         '-o', filepath,
         '-A', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15',
         url],
        check=True
    )


def extract_audio_from_video(video_path, audio_path):
    """从视频提取音频 - 跨平台版本"""
    cmd_str = f'ffmpeg -i "{video_path}" -vn -acodec libmp3lame -q:a 0 -y "{audio_path}"'
    result = run_cmd(cmd_str, shell=True)
    return result


# ========== 2. 下载音频 ==========
def download_audio():
    """下载音频，根据URL类型选择不同策略"""
    print(f"[1/6] 下载音频: {VIDEO_URL}")

    if is_douyin_url(VIDEO_URL):
        # 抖音视频：先下载视频，再提取音频
        print("[1/6] 检测到抖音视频，使用抖音专用下载流程...")

        video_info = parse_douyin_share_url(VIDEO_URL)
        video_path = f"{TEMP_DIR}/video.mp4"

        print(f"[1/6] 正在下载抖音视频: {video_info['title']}")
        download_file(video_info['url'], video_path)
        print(f"[1/6] 视频下载完成，正在提取音频...")

        extract_audio_from_video(video_path, AUDIO_FILE)

        # 清理视频文件
        try:
            os.remove(video_path)
        except:
            pass

        return video_info
    else:
        # 其他平台：直接用 yt-dlp 下载音频
        result = subprocess.run(
            ["yt-dlp", "-f", "30280", "-o", AUDIO_FILE, VIDEO_URL],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"yt-dlp 下载失败，尝试备选格式...")
            # 备选：下载最佳音频格式
            result = subprocess.run(
                ["yt-dlp", "-f", "bestaudio", "--audio-format", "m4a",
                 "-o", AUDIO_FILE, VIDEO_URL],
                capture_output=True, text=True
            )
            if result.returncode != 0:
                raise RuntimeError(f"音频下载失败: {result.stderr}")

        print(f"[1/6] 音频下载完成: {AUDIO_FILE}")
        return {'platform': 'general', 'title': OUTPUT_TITLE or f"视频转录-{datetime.now().strftime('%Y%m%d')}"}


# ========== 3. 语音转写（优先硅基流动，失败用Whisper兜底） ==========
def transcribe_with_sili_flow(audio_path):
    """使用硅基流动API转录"""
    if not SILI_FLOW_API_KEY:
        return None

    print("[2/6] 尝试使用硅基流动API转录...")

    # 调用硅基流动 API
    result = subprocess.run(
        ['curl', '-X', 'POST',
         SILI_FLOW_BASE_URL,
         '-H', f'Authorization: Bearer {SILI_FLOW_API_KEY}',
         '-F', f'file=@{audio_path}',
         '-F', f'model={SILI_FLOW_MODEL}'],
        capture_output=True, text=True
    )

    if result.returncode != 0:
        print("[2/6] 硅基流动API调用失败")
        return None

    try:
        response = json.loads(result.stdout)
        if 'text' in response:
            return response['text']
        elif 'error' in response:
            print(f"[2/6] 硅基流动API错误: {response['error']}")
            return None
    except json.JSONDecodeError:
        print("[2/6] 硅基流动API响应解析失败")
        return None

    return None


def transcribe_with_whisper(audio_path, language, model_size):
    """使用 Whisper 转录（兜底方案）"""
    print(f"[2/6] 使用 Whisper 转录 (model={model_size}, lang={language})...")

    result = subprocess.run(
        ["whisper", audio_path,
         "--language", language,
         "--model", model_size,
         "--output_format", "txt",
         "--output_dir", TEMP_DIR],
        capture_output=True, text=True
    )

    if result.returncode != 0:
        raise RuntimeError(f"Whisper转录失败: {result.stderr}")

    # 读取原始转录
    whisper_output = f"{TEMP_DIR}/audio.txt"
    if os.path.exists(whisper_output):
        with open(whisper_output, "r", encoding="utf-8") as f:
            return f.read()
    elif result.stdout:
        return result.stdout
    else:
        raise RuntimeError("Whisper转录无输出")


def transcribe_audio():
    """转录音频，优先硅基流动，失败用Whisper兜底"""
    print(f"[2/6] 开始转录...")

    # 优先尝试硅基流动API
    text = transcribe_with_sili_flow(AUDIO_FILE)

    if text:
        print(f"[2/6] 硅基流动API转录成功，字符数: {len(text)}")
        return text

    # 兜底：使用 Whisper
    print("[2/6] 硅基流动API不可用，使用Whisper兜底...")
    return transcribe_with_whisper(AUDIO_FILE, LANGUAGE, MODEL_SIZE)


# ========== 4. MiniMax 智能纠错 + 结构化输出 ==========
def correct_and_structure(text, video_info):
    """使用 MiniMax API 进行智能纠错和结构化输出"""
    if not MINIMAX_API_KEY:
        # 没有APIKey时，直接返回原始文本和简单结构
        return f"""# {video_info.get('title', '视频转录')}

| 属性 | 值 |
|------|-----|
| 视频链接 | {VIDEO_URL} |
| 转录时间 | {datetime.now().strftime('%Y-%m-%d %H:%M')} |
| 来源平台 | {video_info.get('platform', 'unknown')} |
| 原始字符数 | {len(text)} |

---

## 转录内容

{text}"""

    print("[3/6] 使用 MiniMax API 进行智能纠错和结构化输出...")

    video_title = video_info.get('title', '视频转录') or f"视频转录-{datetime.now().strftime('%Y%m%d')}"
    platform = video_info.get('platform', 'unknown')

    prompt = f"""你是视频转录文本的智能处理专家。请对下面这段语音转写文本进行**智能纠错与格式化并结构化输出**。

## 输入信息
- 视频标题：{video_title}
- 来源平台：{platform}
- 视频链接：{VIDEO_URL}

## 纠错原则

1. **字词纠错**：根据上下文修正常见误识别词
2. **语气词处理**：精简重复的语气词和口头禅，但保留必要的语气词
3. **语义连贯**：确保纠错后语句通顺、语义连贯
4. **专业术语**：根据视频主题保留正确的专业术语
5. **最小改动**：尽量保留原文结构和表达方式，只做必要修正

## 格式化原则

1. 根据语义完整性和内容逻辑进行分段
2. 每段应该是内容相对完整的句子或论述
3. 保持原文内容不变，只添加合理的段落分隔
4. 适当添加##小标题概括每段主旨（如果内容足够长）

## 结构化输出要求

请直接返回以下格式的 Markdown，不要添加任何解释说明：

```markdown
# {video_title}

## 第一部分：视频元数据

| 字段 | 内容 |
|------|------|
| 视频链接 | {VIDEO_URL} |
| 转录时间 | {datetime.now().strftime('%Y-%m-%d %H:%M')} |
| 来源平台 | {platform} |
| 原始字符数 | 字数统计 |

## 第二部分：转录内容

[纠错与格式化后的完整转录正文，保持原有分段格式]
```

请直接返回处理后的 Markdown 内容："""

    import urllib.request
    import urllib.error

    data = {
        "model": "MiniMax-M2.7",
        "messages": [
            {"role": "system", "content": "你是一个专业的视频转录文本处理助手。"},
            {"role": "user", "content": prompt + "\n\n下面是原始转录文本：\n\n" + text}
        ],
        "max_tokens": 8192,
        "temperature": 0.3
    }

    req = urllib.request.Request(
        f"{MINIMAX_BASE_URL}/v1/text/chatcompletion_v2",
        data=json.dumps(data).encode('utf-8'),
        headers={
            'Authorization': f'Bearer {MINIMAX_API_KEY}',
            'Content-Type': 'application/json'
        },
        method='POST'
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.loads(response.read().decode('utf-8'))
            if result.get('choices') and len(result['choices']) > 0:
                content = result['choices'][0]['message']['content']
                print(f"[3/6] MiniMax处理完成，字符数: {len(content)}")
                return content
    except Exception as e:
        print(f"[3/6] MiniMax API 调用失败: {e}")

    # API失败时返回简单结构
    return f"""# {video_title}

| 属性 | 值 |
|------|-----|
| 视频链接 | {VIDEO_URL} |
| 转录时间 | {datetime.now().strftime('%Y-%m-%d %H:%M')} |
| 来源平台 | {platform} |
| 原始字符数 | {len(text)} |

---

## 转录内容

{text}"""


# ========== 主流程 ==========
def main():
    # 1. 下载音频
    video_info = download_audio()
    print(f"[1/6] 音频下载完成")

    # 2. 语音转写
    raw_text = transcribe_audio()
    print(f"[2/6] 转录完成，原始字符数: {len(raw_text)}")

    # 保存原始转录
    with open(RAW_TXT, "w", encoding="utf-8") as f:
        f.write(raw_text)

    # 3. 智能纠错 + 结构化输出
    print("[3/6] 开始智能纠错和结构化...")
    markdown_content = correct_and_structure(raw_text, video_info)

    # 保存 Markdown
    with open(OUTPUT_MD, "w", encoding="utf-8") as f:
        f.write(markdown_content)

    print(f"[4/6] Markdown 生成完成: {OUTPUT_MD}")

    # 4. 输出 JSON 供父进程读取
    result_json = {
        "status": "ready",
        "markdown_file": OUTPUT_MD,
        "raw_text_file": RAW_TXT,
        "title": video_info.get('title', OUTPUT_TITLE or f"视频转录-{datetime.now().strftime('%Y%m%d')}"),
        "video_url": VIDEO_URL,
        "platform": video_info.get('platform', 'unknown'),
        "raw_chars": len(raw_text),
    }
    print("JSON_OUTPUT:" + json.dumps(result_json))


if __name__ == "__main__":
    main()
