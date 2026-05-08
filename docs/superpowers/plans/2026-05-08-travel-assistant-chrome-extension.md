# 旅游攻略助手 Chrome 插件实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 构建 Chrome 浏览器侧边栏插件，一键从视频平台（YouTube、B站、抖音）和小红书提取内容，生成一站式 Markdown 文件。

**架构：** 三层适配器+流水线架构：Content Scripts（4个平台适配器）→ Service Worker（流水线编排、AI服务、MD生成）→ Side Panel（用户交互）。使用 WXT 框架构建，TypeScript 编写，vitest 测试。

**技术栈：** WXT (Web Extension Tools) · TypeScript · vitest · 硅基流动 ASR API · DeepSeek API · Web Audio API · chrome.storage.local

---

## 文件结构

```
travel-assistant/
├── wxt.config.ts                # WXT 构建配置
├── package.json
├── tsconfig.json
├── assets/
│   └── icon.svg                 # 插件图标（SVG 源文件）
├── entrypoints/
│   ├── background.ts            # Service Worker 入口
│   ├── sidepanel/
│   │   ├── index.html           # 侧边栏 HTML
│   │   ├── main.ts              # 侧边栏主逻辑
│   │   └── style.css            # 侧边栏样式
│   ├── options/
│   │   ├── index.html           # 设置页 HTML
│   │   ├── main.ts              # 设置页逻辑
│   │   └── style.css            # 设置页样式
│   ├── offscreen/
│   │   ├── index.html           # Offscreen Document HTML
│   │   └── main.ts              # 音频处理逻辑
│   ├── youtube.content.ts       # YouTube 适配器
│   ├── bilibili.content.ts      # B站适配器
│   ├── douyin.content.ts        # 抖音适配器
│   └── xiaohongshu.content.ts   # 小红书适配器
├── lib/
│   ├── types.ts                 # 共享类型定义
│   ├── messages.ts              # 消息协议常量
│   ├── config-manager.ts        # 配置管理（API Key、设置）
│   ├── ai-service.ts            # AI 服务（硅基流动 + DeepSeek）
│   ├── markdown-generator.ts    # Markdown 生成器
│   ├── pipeline.ts              # 流水线编排器
│   └── audio-processor.ts       # 音频处理（Offscreen 侧）
└── tests/
    ├── config-manager.test.ts
    ├── ai-service.test.ts
    ├── markdown-generator.test.ts
    └── pipeline.test.ts
```

**文件职责：**

| 文件 | 职责 |
|------|------|
| `lib/types.ts` | 定义 AdapterOutput、Comment、PipelineStep、PipelineState、ExtractConfig 等类型 |
| `lib/messages.ts` | 定义所有消息名称常量和请求/响应类型，规范组件间通信协议 |
| `lib/config-manager.ts` | 读写 chrome.storage.local 中的 API Key 和用户设置，提供设置校验 |
| `lib/ai-service.ts` | 封装硅基流动语音转录 API、DeepSeek Vision 图片理解 API、DeepSeek 总结 API |
| `lib/markdown-generator.ts` | 接收 AdapterOutput + 转录文本 + 总结文本，按模板生成一站式 MD 字符串 |
| `lib/pipeline.ts` | 编排执行流水线：提取→下载→转录→总结→评论→生成，发送进度到侧边栏 |
| `lib/audio-processor.ts` | 在 Offscreen Document 中运行，从视频 URL 下载并转码音频为 16kHz WAV |
| `entrypoints/background.ts` | Service Worker 入口，注册消息处理器，协调 pipeline 和 offscreen |
| `entrypoints/*.content.ts` | 各平台适配器，从 DOM 提取 AdapterOutput 数据 |
| `entrypoints/sidepanel/` | 侧边栏 UI（空闲/处理中/完成三种状态） |
| `entrypoints/options/` | 设置页 UI（API Key 配置、默认设置、历史管理） |
| `entrypoints/offscreen/` | Offscreen Document，提供 AudioContext 环境进行音频转码 |

---

### 任务 1：项目脚手架

**目标：** 初始化 WXT 项目，配置构建环境，创建基础文件结构。

**前置条件：** Node.js >= 18, npm

- [ ] **步骤 1：初始化 npm 项目并安装依赖**

运行：
```bash
mkdir -p D:/home/chrome/travel-assistant && cd D:/home/chrome/travel-assistant && npm init -y
```

然后安装依赖：
```bash
npm install wxt@latest && npm install -D vitest typescript @types/chrome
```

- [ ] **步骤 2：创建 wxt.config.ts**

创建 `travel-assistant/wxt.config.ts`：
```typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '旅游攻略助手',
    description: '一键提取视频/图文内容为 Markdown，旅游攻略信息收集利器',
    permissions: ['sidePanel', 'storage', 'downloads', 'activeTab'],
    host_permissions: [
      '*://*.youtube.com/*',
      '*://*.bilibili.com/*',
      '*://*.douyin.com/*',
      '*://*.iesdouyin.com/*',
      '*://*.xiaohongshu.com/*',
      '*://*.xhscdn.com/*',
      '*://api.siliconflow.cn/*',
      '*://api.deepseek.com/*',
    ],
    action: {
      default_title: '旅游攻略助手',
    },
  },
  modules: ['@wxt-dev/module-vite'],
});
```

- [ ] **步骤 3：创建 tsconfig.json**

创建 `travel-assistant/tsconfig.json`：
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "baseUrl": ".",
    "paths": {
      "~/*": ["./*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **步骤 4：创建目录结构**

运行：
```bash
cd D:/home/chrome/travel-assistant && mkdir -p entrypoints/sidepanel entrypoints/options entrypoints/offscreen lib tests assets
```

- [ ] **步骤 5：创建占位图标 SVG**

创建 `travel-assistant/assets/icon.svg`：
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#7c4dff"/>
  <text x="64" y="82" text-anchor="middle" font-size="72" fill="white">🗺️</text>
</svg>
```

- [ ] **步骤 6：验证项目能构建**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx wxt build
```
预期：`dist/` 目录生成，包含 `manifest.json` 等文件。

- [ ] **步骤 7：Commit**

```bash
cd D:/home/chrome/travel-assistant && git init && git add -A && git commit -m "chore: init WXT project scaffold"
```

---

### 任务 2：共享类型与消息协议

**目标：** 定义项目中所有组件共享的类型和消息通信协议。

**文件：**
- 创建：`travel-assistant/lib/types.ts`
- 创建：`travel-assistant/lib/messages.ts`

- [ ] **步骤 1：创建 types.ts**

创建 `travel-assistant/lib/types.ts`：
```typescript
/** 平台标识 */
export type Platform = 'youtube' | 'bilibili' | 'douyin' | 'xiaohongshu';

/** 内容类型 */
export type ContentType = 'video' | 'note';

/** 评论 */
export interface Comment {
  author: string;
  content: string;
  likes: number;
  time: string;
  replies?: Comment[];
}

/** 平台适配器输出统一接口 */
export interface AdapterOutput {
  platform: Platform;
  type: ContentType;
  url: string;
  title: string;
  author: string;
  publishDate?: string;
  description?: string;
  mediaUrls: string[];
  subtitleUrl?: string;
  comments: Comment[];
  rawText?: string;
  metadata: Record<string, unknown>;
}

/** 流水线步骤状态 */
export type StepStatus = 'pending' | 'running' | 'done' | 'error';

/** 单个流水线步骤 */
export interface PipelineStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

/** 流水线整体状态 */
export interface PipelineState {
  steps: PipelineStep[];
  cancelled: boolean;
}

/** 提取配置 */
export interface ExtractConfig {
  commentCount: 20 | 50 | 100 | 0; // 0 = 全部
  commentSort: 'hot' | 'time';
  downloadVideo: boolean;
}

/** 用户设置 */
export interface UserSettings {
  siliflowApiKey: string;
  deepseekApiKey: string;
  defaultCommentCount: 20 | 50 | 100 | 0;
  defaultCommentSort: 'hot' | 'time';
  language: 'zh' | 'en' | 'auto';
}

/** 历史记录条目 */
export interface HistoryEntry {
  id: string;
  platform: Platform;
  title: string;
  url: string;
  timestamp: number;
  charCount: number;
}
```

- [ ] **步骤 2：创建 messages.ts**

创建 `travel-assistant/lib/messages.ts`：
```typescript
import type { AdapterOutput, ExtractConfig, PipelineState } from './types';

/** 消息名称常量 */
export const MSG = {
  // 侧边栏 → Background
  START_EXTRACTION: 'startExtraction',
  CANCEL_EXTRACTION: 'cancelExtraction',

  // Background → 内容脚本
  EXTRACT_PAGE_DATA: 'extractPageData',

  // 内容脚本 → Background
  PAGE_DATA_EXTRACTED: 'pageDataExtracted',

  // Background → 侧边栏
  PROGRESS_UPDATE: 'progressUpdate',
  EXTRACTION_COMPLETE: 'extractionComplete',

  // Background ↔ Offscreen
  PROCESS_AUDIO: 'processAudio',
  AUDIO_PROCESSED: 'audioProcessed',
} as const;

/** 消息载荷类型 */
export interface StartExtractionPayload {
  tabId: number;
  config: ExtractConfig;
}

export interface PageDataExtractedPayload {
  data: AdapterOutput;
}

export interface ProgressUpdatePayload {
  state: PipelineState;
}

export interface ExtractionCompletePayload {
  markdown: string;
  filename: string;
}

export interface ProcessAudioPayload {
  videoUrl: string;
}

export interface AudioProcessedPayload {
  audioBlob: ArrayBuffer;
}
```

- [ ] **步骤 3：验证 TypeScript 编译**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx tsc --noEmit
```
预期：无类型错误。

- [ ] **步骤 4：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add lib/types.ts lib/messages.ts && git commit -m "feat: add shared types and message protocol"
```

---

### 任务 3：配置管理器

**目标：** 实现 API Key 和用户设置的读写，基于 chrome.storage.local。

**文件：**
- 创建：`travel-assistant/lib/config-manager.ts`
- 创建：`travel-assistant/tests/config-manager.test.ts`

- [ ] **步骤 1：编写失败的测试**

创建 `travel-assistant/tests/config-manager.test.ts`：
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserSettings } from '../lib/types';

// Mock chrome.storage
const mockStorage: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (keys: string[], cb: (result: Record<string, unknown>) => void) => {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in mockStorage) result[key] = mockStorage[key];
        }
        cb(result);
      },
      set: (items: Record<string, unknown>, cb?: () => void) => {
        Object.assign(mockStorage, items);
        cb?.();
      },
    },
  },
  runtime: { lastError: null },
});

import {
  loadSettings,
  saveSettings,
  getApiKey,
  setApiKey,
  DEFAULT_SETTINGS,
} from '../lib/config-manager';
```

- [ ] **步骤 2：扩展测试文件，添加测试用例**

在测试文件末尾添加：
```typescript
describe('config-manager', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
  });

  describe('loadSettings', () => {
    it('returns defaults when storage is empty', async () => {
      const settings = await loadSettings();
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it('merges stored values with defaults', async () => {
      mockStorage.settings = { defaultCommentCount: 100 };
      const settings = await loadSettings();
      expect(settings.defaultCommentCount).toBe(100);
      expect(settings.language).toBe(DEFAULT_SETTINGS.language);
    });
  });

  describe('saveSettings', () => {
    it('persists settings to chrome.storage.local', async () => {
      const partial: Partial<UserSettings> = { language: 'en', defaultCommentCount: 20 };
      await saveSettings(partial);
      const loaded = await loadSettings();
      expect(loaded.language).toBe('en');
      expect(loaded.defaultCommentCount).toBe(20);
    });
  });

  describe('getApiKey', () => {
    it('returns stored API key when present', async () => {
      mockStorage.siliflowApiKey = 'sk-test123';
      const key = await getApiKey('siliflow');
      expect(key).toBe('sk-test123');
    });

    it('returns empty string when no key stored', async () => {
      const key = await getApiKey('siliflow');
      expect(key).toBe('');
    });
  });

  describe('setApiKey', () => {
    it('stores API key in dedicated storage key', async () => {
      await setApiKey('deepseek', 'sk-ds-456');
      expect(mockStorage.deepseekApiKey).toBe('sk-ds-456');
    });
  });
});
```

- [ ] **步骤 3：运行测试验证失败**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx vitest run tests/config-manager.test.ts
```
预期：FAIL，模块未创建。

- [ ] **步骤 4：实现 config-manager.ts**

创建 `travel-assistant/lib/config-manager.ts`：
```typescript
import type { UserSettings } from './types';

export const DEFAULT_SETTINGS: UserSettings = {
  siliflowApiKey: '',
  deepseekApiKey: '',
  defaultCommentCount: 50,
  defaultCommentSort: 'hot',
  language: 'zh',
};

const STORAGE_KEY = 'settings';

export function loadSettings(): Promise<UserSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      const stored = result[STORAGE_KEY] as Partial<UserSettings> | undefined;
      resolve({ ...DEFAULT_SETTINGS, ...stored });
    });
  });
}

export function saveSettings(partial: Partial<UserSettings>): Promise<void> {
  return new Promise((resolve) => {
    loadSettings().then((current) => {
      const updated = { ...current, ...partial };
      chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => resolve());
    });
  });
}

const API_KEY_KEYS: Record<'siliflow' | 'deepseek', string> = {
  siliflow: 'siliflowApiKey',
  deepseek: 'deepseekApiKey',
};

export function getApiKey(service: 'siliflow' | 'deepseek'): Promise<string> {
  const key = API_KEY_KEYS[service];
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve((result[key] as string) || '');
    });
  });
}

export function setApiKey(service: 'siliflow' | 'deepseek', value: string): Promise<void> {
  const key = API_KEY_KEYS[service];
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx vitest run tests/config-manager.test.ts
```
预期：全部 PASS。

- [ ] **步骤 6：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add lib/config-manager.ts tests/config-manager.test.ts && git commit -m "feat: add config manager with chrome.storage.local"
```

---

### 任务 4：AI 服务

**目标：** 实现硅基流动语音转录和 DeepSeek 图片理解/内容总结三个 API 调用。

**文件：**
- 创建：`travel-assistant/lib/ai-service.ts`
- 创建：`travel-assistant/tests/ai-service.test.ts`

- [ ] **步骤 1：创建 ai-service.test.ts**

创建 `travel-assistant/tests/ai-service.test.ts`：
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock chrome.storage for getApiKey
const mockStorage: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (keys: string[], cb: (result: Record<string, unknown>) => void) => {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in mockStorage) result[key] = mockStorage[key];
        }
        cb(result);
      },
    },
  },
  runtime: { lastError: null },
});

import { transcribeAudio, describeImage, summarize } from '../lib/ai-service';

describe('AI Service', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
  });

  describe('transcribeAudio', () => {
    it('calls SiliconFlow API with correct parameters', async () => {
      mockStorage.siliflowApiKey = 'sk-test';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: '这是转录文本' }),
      });

      const formData = new FormData();
      formData.append('file', new Blob(['audio data']), 'audio.wav');
      formData.append('model', 'FunAudioLLM/SenseVoiceSmall');

      const result = await transcribeAudio(new Blob(['audio data']));

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.siliconflow.cn/v1/audio/transcriptions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test',
          }),
        })
      );
      expect(result.text).toBe('这是转录文本');
    });

    it('throws when API key is missing', async () => {
      await expect(transcribeAudio(new Blob(['data']))).rejects.toThrow('API Key');
    });
  });

  describe('describeImage', () => {
    it('calls DeepSeek API with image URL', async () => {
      mockStorage.deepseekApiKey = 'sk-ds';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '这是一张樱花照片' } }],
        }),
      });

      const result = await describeImage('https://example.com/img.jpg');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.deepseek.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-ds',
          }),
        })
      );
      expect(result).toBe('这是一张樱花照片');
    });
  });

  describe('summarize', () => {
    it('calls DeepSeek API for summarization', async () => {
      mockStorage.deepseekApiKey = 'sk-ds';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '总结内容' } }],
        }),
      });

      const result = await summarize('长篇内容...', '旅游攻略');

      expect(result).toBe('总结内容');
    });
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx vitest run tests/ai-service.test.ts
```
预期：FAIL，模块未创建。

- [ ] **步骤 3：实现 ai-service.ts**

创建 `travel-assistant/lib/ai-service.ts`：
```typescript
import { getApiKey } from './config-manager';

const SILICONFLOW_ASR_URL = 'https://api.siliconflow.cn/v1/audio/transcriptions';
const DEEPSEEK_CHAT_URL = 'https://api.deepseek.com/v1/chat/completions';

export async function transcribeAudio(audioBlob: Blob): Promise<{ text: string }> {
  const apiKey = await getApiKey('siliflow');
  if (!apiKey) throw new Error('缺少硅基流动 API Key');

  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.wav');
  formData.append('model', 'FunAudioLLM/SenseVoiceSmall');

  const res = await fetch(SILICONFLOW_ASR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`硅基流动 API 错误 (${res.status}): ${errText}`);
  }

  return res.json();
}

export async function describeImage(imageUrl: string): Promise<string> {
  const apiKey = await getApiKey('deepseek');
  if (!apiKey) throw new Error('缺少 DeepSeek API Key');

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '请详细描述这张图片的内容，包括场景、人物、物品、文字等。用中文回答。' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 1000,
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek 图片理解错误 (${res.status})`);
  const data = await res.json();
  return data.choices[0].message.content;
}

export async function summarize(content: string, context: string): Promise<string> {
  const apiKey = await getApiKey('deepseek');
  if (!apiKey) throw new Error('缺少 DeepSeek API Key');

  const res = await fetch(DEEPSEEK_CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [
        {
          role: 'system',
          content: '你是一个旅游攻略助手。请将以下内容总结为简洁的要点摘要，突出关键信息（景点、美食、交通、住宿、费用等），用中文回答。',
        },
        { role: 'user', content: `【标题】${context}\n\n【内容】\n${content.slice(0, 8000)}` },
      ],
      max_tokens: 1500,
    }),
  });

  if (!res.ok) throw new Error(`DeepSeek 总结错误 (${res.status})`);
  const data = await res.json();
  return data.choices[0].message.content;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx vitest run tests/ai-service.test.ts
```
预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add lib/ai-service.ts tests/ai-service.test.ts && git commit -m "feat: add AI service with SiliconFlow and DeepSeek APIs"
```

---

### 任务 5：Markdown 生成器

**目标：** 将 AdapterOutput + 转录/总结文本按模板拼接为 Markdown 字符串。

**文件：**
- 创建：`travel-assistant/lib/markdown-generator.ts`
- 创建：`travel-assistant/tests/markdown-generator.test.ts`

- [ ] **步骤 1：创建 markdown-generator.test.ts**

创建 `travel-assistant/tests/markdown-generator.test.ts`：
```typescript
import { describe, it, expect } from 'vitest';
import { generateVideoMarkdown, generateNoteMarkdown } from '../lib/markdown-generator';
import type { AdapterOutput, Comment } from '../lib/types';

const videoAdapterOutput: AdapterOutput = {
  platform: 'bilibili',
  type: 'video',
  url: 'https://bilibili.com/video/BV1xx',
  title: '大阪5日游攻略',
  author: '旅行达人',
  publishDate: '2026-03-15',
  description: '大阪旅游完整路线规划',
  mediaUrls: ['https://example.com/video.mp4'],
  comments: [
    { author: '用户A', content: '很详细的攻略！', likes: 120, time: '2026-03-16' },
    { author: '用户B', content: '收藏了', likes: 45, time: '2026-03-17' },
  ],
  metadata: { views: 123000, likes: 8456, favorites: 5201 },
};

describe('Markdown Generator', () => {
  describe('generateVideoMarkdown', () => {
    it('generates complete markdown for video content', () => {
      const transcript = '大家好，今天给大家分享大阪5日游攻略。第一天我们到达关西机场...';
      const summary = '本视频介绍了大阪5日游的完整路线规划。';

      const md = generateVideoMarkdown(videoAdapterOutput, transcript, summary, 'hot', 50);

      expect(md).toContain('# 大阪5日游攻略');
      expect(md).toContain('📌 来源：B站');
      expect(md).toContain('作者：旅行达人');
      expect(md).toContain('## 📝 内容总结');
      expect(md).toContain(summary);
      expect(md).toContain('## 🎬 转录文本');
      expect(md).toContain(transcript);
      expect(md).toContain('## 💬 评论');
      expect(md).toContain('@用户A');
      expect(md).toContain('很详细的攻略！');
      expect(md).toContain('@用户B');
      expect(md).toContain('收藏了');
      expect(md).toContain('*由旅游攻略助手生成');
    });

    it('includes metadata when available', () => {
      const md = generateVideoMarkdown(videoAdapterOutput, 'test', 'sum', 'hot', 50);
      expect(md).toContain('📊 播放');
      expect(md).toContain('123000');
      expect(md).toContain('8456');
    });
  });

  describe('generateNoteMarkdown', () => {
    const noteAdapterOutput: AdapterOutput = {
      platform: 'xiaohongshu',
      type: 'note',
      url: 'https://xiaohongshu.com/explore/abc',
      title: '京都赏樱5大绝美地点',
      author: '樱花酱',
      publishDate: '2026-04-01',
      mediaUrls: ['https://img1.jpg', 'https://img2.jpg'],
      rawText: '今天分享京都最美的5个赏樱地点，第一个是岚山...',
      comments: [],
      metadata: { likes: 2341, favorites: 8902 },
    };

    it('generates complete markdown for note content', () => {
      const imageDescriptions = ['第一张图：岚山竹林中的樱花步道', '第二张图：清水寺俯瞰樱花全景'];
      const summary = '本文推荐了京都5个最佳赏樱地点。';

      const md = generateNoteMarkdown(noteAdapterOutput, imageDescriptions, summary, 'hot', 20);

      expect(md).toContain('# 京都赏樱5大绝美地点');
      expect(md).toContain('📌 来源：小红书');
      expect(md).toContain('作者：樱花酱');
      expect(md).toContain('❤️ 点赞');
      expect(md).toContain('## 📝 内容总结');
      expect(md).toContain(summary);
      expect(md).toContain('## 🖼️ 图片解读');
      expect(md).toContain('### 图1');
      expect(md).toContain('岚山竹林中的樱花步道');
      expect(md).toContain('### 图2');
      expect(md).toContain('清水寺俯瞰樱花全景');
      expect(md).toContain('## 📖 笔记原文');
      expect(md).toContain('今天分享京都最美');
    });
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx vitest run tests/markdown-generator.test.ts
```
预期：FAIL，模块未创建。

- [ ] **步骤 3：实现 markdown-generator.ts**

创建 `travel-assistant/lib/markdown-generator.ts`：
```typescript
import type { AdapterOutput, Comment, Platform } from './types';

const PLATFORM_NAMES: Record<Platform, string> = {
  youtube: 'YouTube',
  bilibili: 'B站',
  douyin: '抖音',
  xiaohongshu: '小红书',
};

function formatMetadata(data: AdapterOutput): string {
  const lines: string[] = [];
  const meta = data.metadata || {};

  lines.push(`📌 来源：${PLATFORM_NAMES[data.platform]} | 作者：${data.author}${data.publishDate ? ` | 发布：${data.publishDate}` : ''}`);
  lines.push(`🔗 ${data.url}`);

  if (data.type === 'video' && meta.views) {
    const parts = [`📊 播放 ${meta.views}`];
    if (meta.likes) parts.push(`点赞 ${meta.likes}`);
    if (meta.favorites) parts.push(`收藏 ${meta.favorites}`);
    lines.push(parts.join(' | '));
  } else if (data.type === 'note') {
    const parts = [];
    if (meta.likes) parts.push(`❤️ 点赞 ${meta.likes}`);
    if (meta.favorites) parts.push(`收藏 ${meta.favorites}`);
    if (parts.length) lines.push(parts.join(' | '));
  }

  return lines.map(l => `> ${l}`).join('\n');
}

function formatComments(comments: Comment[], sort: string, count: number): string {
  if (!comments.length) return '';

  const sorted = [...comments];
  const displayCount = count === 0 ? sorted.length : Math.min(count, sorted.length);
  const items = sorted.slice(0, displayCount);

  const parts = items.map((c, i) => {
    let text = `### [${i + 1}] @${c.author}\n${c.content}`;
    if (c.replies?.length) {
      text += '\n\n' + c.replies.map(r => `> **@${r.author}**：${r.content}`).join('\n\n');
    }
    return text;
  });

  return parts.join('\n\n');
}

export function generateVideoMarkdown(
  data: AdapterOutput,
  transcript: string,
  summary: string,
  commentSort: string,
  commentCount: number
): string {
  const sortLabel = commentSort === 'hot' ? '按热度' : '按时间';
  const now = new Date().toLocaleString('zh-CN');

  return [
    `# ${data.title}`,
    '',
    formatMetadata(data),
    '',
    '---',
    '',
    '## 📝 内容总结',
    '',
    summary,
    '',
    '---',
    '',
    '## 🎬 转录文本',
    '',
    transcript,
    '',
    '---',
    '',
    `## 💬 评论（${sortLabel}，前${commentCount}条）`,
    '',
    formatComments(data.comments, commentSort, commentCount),
    '',
    '---',
    '',
    `*由旅游攻略助手生成 | ${now}*`,
  ].join('\n');
}

export function generateNoteMarkdown(
  data: AdapterOutput,
  imageDescriptions: string[],
  summary: string,
  commentSort: string,
  commentCount: number
): string {
  const sortLabel = commentSort === 'hot' ? '按热度' : '按时间';
  const now = new Date().toLocaleString('zh-CN');
  const imagesSection = imageDescriptions.length
    ? ['## 🖼️ 图片解读', '', ...imageDescriptions.map((desc, i) => `### 图${i + 1}\n${desc}`), '']
    : ['## 🖼️ 图片解读', '', '*图片未能识别*', ''];

  const sections: string[] = [
    `# ${data.title}`,
    '',
    formatMetadata(data),
    '',
    '---',
    '',
    '## 📝 内容总结',
    '',
    summary,
    '',
    '---',
    '',
    ...imagesSection,
    '',
    '---',
    '',
    '## 📖 笔记原文',
    '',
    data.rawText || '*未提取到文本内容*',
    '',
    '---',
    '',
    `## 💬 评论（${sortLabel}，前${commentCount}条）`,
    '',
    formatComments(data.comments, commentSort, commentCount),
    '',
    '---',
    '',
    `*由旅游攻略助手生成 | ${now}*`,
  ];

  return sections.join('\n');
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx vitest run tests/markdown-generator.test.ts
```
预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add lib/markdown-generator.ts tests/markdown-generator.test.ts && git commit -m "feat: add markdown generator for video and note content"
```

---

### 任务 6：B站内容脚本适配器

**目标：** 实现 B站视频页面的 DOM 提取，输出 AdapterOutput。

**文件：**
- 创建：`travel-assistant/entrypoints/bilibili.content.ts`

- [ ] **步骤 1：创建 bilibili.content.ts**

创建 `travel-assistant/entrypoints/bilibili.content.ts`：
```typescript
import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';
import type { PageDataExtractedPayload, StartExtractionPayload, ExtractionCompletePayload, ProgressUpdatePayload } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.bilibili.com/video/*'],
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === MSG.EXTRACT_PAGE_DATA) {
        extractBilibiliData()
          .then((data) => sendResponse({ data }))
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }
    });
  },
});

async function extractBilibiliData(): Promise<AdapterOutput> {
  const url = window.location.href;
  const bvid = url.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1] || '';

  // 从页面脚本变量提取视频信息
  const initialState = (window as any).__INITIAL_STATE__;
  const videoData = initialState?.videoData;

  const title = videoData?.title || document.title.replace('_哔哩哔哩_bilibili', '').trim();
  const author = videoData?.owner?.name || '未知';
  const publishDate = videoData?.pubdate
    ? new Date(videoData.pubdate * 1000).toISOString().split('T')[0]
    : undefined;
  const description = videoData?.desc || '';

  // 通过 B站 API 获取播放地址
  const mediaUrls: string[] = [];
  if (bvid) {
    try {
      const cid = videoData?.pages?.[0]?.cid || videoData?.cid;
      if (cid) {
        const apiUrl = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=16&fourk=1`;
        const resp = await fetch(apiUrl);
        const json = await resp.json();
        const dash = json?.data?.dash;
        if (dash?.video?.length) {
          mediaUrls.push(dash.video[0].baseUrl || dash.video[0].base_url);
        }
        if (dash?.audio?.length) {
          mediaUrls.push(dash.audio[0].baseUrl || dash.audio[0].base_url);
        }
      }
    } catch (e) {
      // 降级：尝试从 video 标签获取 src
      const videoEl = document.querySelector('video');
      if (videoEl?.src) mediaUrls.push(videoEl.src);
    }
  }

  // 提取评论（从页面数据）
  const comments: Comment[] = [];
  try {
    const pagelist = initialState?.videoData?.pages;
    const aid = videoData?.aid;
    if (aid) {
      const commentUrl = `https://api.bilibili.com/x/v2/reply/main?oid=${aid}&type=1&mode=3`;
      const resp = await fetch(commentUrl);
      const json = await resp.json();
      const replies = json?.data?.replies || [];
      for (const r of replies.slice(0, 100)) {
        comments.push({
          author: r.member?.uname || '未知',
          content: r.content?.message || '',
          likes: r.like || 0,
          time: new Date((r.ctime || 0) * 1000).toISOString().split('T')[0],
          replies: (r.replies || []).map((rr: any) => ({
            author: rr.member?.uname || '',
            content: rr.content?.message || '',
            likes: rr.like || 0,
            time: '',
          })),
        });
      }
    }
  } catch (e) {
    // 评论获取失败不阻塞主流程
  }

  const metadata: Record<string, unknown> = {};
  const stat = videoData?.stat;
  if (stat) {
    if (stat.view) metadata.views = stat.view;
    if (stat.like) metadata.likes = stat.like;
    if (stat.favorite) metadata.favorites = stat.favorite;
  }

  return {
    platform: 'bilibili',
    type: 'video',
    url,
    title,
    author,
    publishDate,
    description,
    mediaUrls,
    comments,
    metadata,
  };
}
```

- [ ] **步骤 2：更新 wxt.config.ts 确保内容脚本配置正确**

运行 TypeScript 检查：
```bash
cd D:/home/chrome/travel-assistant && npx tsc --noEmit
```
预期：无类型错误。

- [ ] **步骤 3：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add entrypoints/bilibili.content.ts && git commit -m "feat: add Bilibili content script adapter"
```

---

### 任务 7：后台服务入口与 Offscreen 音频处理

**目标：** 创建 Service Worker 入口和 Offscreen Document，实现视频下载和音频转码。

**文件：**
- 创建：`travel-assistant/entrypoints/background.ts`
- 创建：`travel-assistant/entrypoints/offscreen/index.html`
- 创建：`travel-assistant/entrypoints/offscreen/main.ts`

- [ ] **步骤 1：创建 Offscreen HTML**

创建 `travel-assistant/entrypoints/offscreen/index.html`：
```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
  <script src="./main.ts" type="module"></script>
</body>
</html>
```

- [ ] **步骤 2：创建 offscreen/main.ts**

创建 `travel-assistant/entrypoints/offscreen/main.ts`：
```typescript
import { MSG } from '../../lib/messages';

// 从视频 URL 下载音频并转码为 16kHz WAV
async function downloadAndExtractAudio(videoUrl: string): Promise<ArrayBuffer> {
  // 下载视频
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`下载视频失败: ${response.status}`);
  const videoBlob = await response.blob();

  // 使用 Web Audio API 提取音频
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const arrayBuffer = await videoBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // 创建离线渲染上下文，转码为 16kHz 单声道 WAV
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();

  const renderedBuffer = await offlineCtx.startRendering();
  await audioContext.close();

  // 将 AudioBuffer 转为 WAV ArrayBuffer
  return audioBufferToWav(renderedBuffer);
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const dataLength = length * numChannels * 2;
  const headerLen = 44;
  const totalLength = headerLen + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === MSG.PROCESS_AUDIO) {
    downloadAndExtractAudio(msg.videoUrl)
      .then((audioBlob) => sendResponse({ audioBlob: new Uint8Array(audioBlob) }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});
```

- [ ] **步骤 3：创建 background.ts**

创建 `travel-assistant/entrypoints/background.ts`：
```typescript
import { MSG } from '../lib/messages';

let offscreenDocument: string | null = null;

async function ensureOffscreen(): Promise<void> {
  if (offscreenDocument) return;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts.length > 0) {
    offscreenDocument = 'active';
    return;
  }
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Audio processing for video transcription',
  });
  offscreenDocument = 'active';
}

// 处理来自侧边栏的提取请求
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG.START_EXTRACTION) {
    handleStartExtraction(msg.tabId, msg.config)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

async function handleStartExtraction(tabId: number, config: any) {
  // 向内容脚本发送提取请求
  const response = await chrome.tabs.sendMessage(tabId, { type: MSG.EXTRACT_PAGE_DATA });
  if (response.error) throw new Error(response.error);
  return response;
}
```

- [ ] **步骤 4：更新 wxt.config.ts 支持 offscreen**

将 `wxt.config.ts` 中的 permissions 添加 `offscreen`：
```typescript
import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: '旅游攻略助手',
    description: '一键提取视频/图文内容为 Markdown，旅游攻略信息收集利器',
    permissions: ['sidePanel', 'storage', 'downloads', 'activeTab', 'offscreen'],
    host_permissions: [
      '*://*.youtube.com/*',
      '*://*.bilibili.com/*',
      '*://*.douyin.com/*',
      '*://*.iesdouyin.com/*',
      '*://*.xiaohongshu.com/*',
      '*://*.xhscdn.com/*',
      '*://api.siliconflow.cn/*',
      '*://api.deepseek.com/*',
    ],
    action: {
      default_title: '旅游攻略助手',
    },
    side_panel: {
      default_path: 'sidepanel.html',
    },
  },
  modules: ['@wxt-dev/module-vite'],
});
```

- [ ] **步骤 5：构建验证**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx wxt build
```
预期：无错误，`dist/` 目录正确生成。

- [ ] **步骤 6：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add entrypoints/background.ts entrypoints/offscreen/ wxt.config.ts && git commit -m "feat: add background service worker and offscreen audio processor"
```

---

### 任务 8：流水线编排器

**目标：** 实现视频处理流水线的编排逻辑，协调各模块按步骤执行。

**文件：**
- 创建：`travel-assistant/lib/pipeline.ts`
- 创建：`travel-assistant/tests/pipeline.test.ts`

- [ ] **步骤 1：创建 pipeline.test.ts**

创建 `travel-assistant/tests/pipeline.test.ts`：
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdapterOutput, PipelineStep } from '../lib/types';

// Mock 外部依赖
const mockTranscribe = vi.fn();
const mockSummarize = vi.fn();
const mockGenerateVideoMarkdown = vi.fn();
const mockProcessAudio = vi.fn();

vi.mock('../lib/ai-service', () => ({
  transcribeAudio: (...args: any[]) => mockTranscribe(...args),
  summarize: (...args: any[]) => mockSummarize(...args),
}));

vi.mock('../lib/markdown-generator', () => ({
  generateVideoMarkdown: (...args: any[]) => mockGenerateVideoMarkdown(...args),
}));

vi.mock('../lib/config-manager', () => ({
  loadSettings: () => Promise.resolve({ defaultCommentCount: 50, defaultCommentSort: 'hot', language: 'zh' }),
}));

import { runVideoPipeline } from '../lib/pipeline';
import type { ExtractConfig } from '../lib/types';

function makeAdapterOutput(overrides?: Partial<AdapterOutput>): AdapterOutput {
  return {
    platform: 'bilibili',
    type: 'video',
    url: 'https://example.com',
    title: 'Test Video',
    author: 'Tester',
    mediaUrls: ['https://example.com/video.mp4'],
    comments: [{ author: 'User', content: 'Nice!', likes: 10, time: '2026-01-01' }],
    metadata: { views: 1000 },
    ...overrides,
  };
}

describe('Video Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTranscribe.mockResolvedValue({ text: '转录文本' });
    mockSummarize.mockResolvedValue('视频总结内容');
    mockGenerateVideoMarkdown.mockReturnValue('# Test Video\n\n## Content');
    mockProcessAudio.mockResolvedValue(new ArrayBuffer(0));
  });

  it('runs through all steps and returns markdown', async () => {
    const onProgress = vi.fn();
    const config: ExtractConfig = {
      commentCount: 50,
      commentSort: 'hot',
      downloadVideo: false,
    };

    const data = makeAdapterOutput();
    const result = await runVideoPipeline(data, config, onProgress);

    expect(result.markdown).toContain('# Test Video');
    expect(onProgress).toHaveBeenCalled();

    // 验证步骤顺序
    const steps = onProgress.mock.calls.map((c: any[]) => c[0].steps.map((s: PipelineStep) => s.status));
    const finalSteps = steps[steps.length - 1];
    expect(finalSteps.every((s: string) => s === 'done')).toBe(true);
  });

  it('handles transcription failure gracefully', async () => {
    mockTranscribe.mockRejectedValue(new Error('API Error'));

    const onProgress = vi.fn();
    const config: ExtractConfig = {
      commentCount: 20,
      commentSort: 'time',
      downloadVideo: false,
    };

    const data = makeAdapterOutput();
    const result = await runVideoPipeline(data, config, onProgress);

    // 应该仍然返回 markdown，但转录内容标记为失败
    expect(result.markdown).toBeDefined();
    expect(mockSummarize).toHaveBeenCalled();
  });

  it('skips summary when summarize fails', async () => {
    mockSummarize.mockRejectedValue(new Error('Summarize failed'));

    const onProgress = vi.fn();
    const config: ExtractConfig = {
      commentCount: 20,
      commentSort: 'hot',
      downloadVideo: false,
    };

    const data = makeAdapterOutput();
    const result = await runVideoPipeline(data, config, onProgress);

    expect(result.markdown).toBeDefined();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx vitest run tests/pipeline.test.ts
```
预期：FAIL。

- [ ] **步骤 3：实现 pipeline.ts**

创建 `travel-assistant/lib/pipeline.ts`：
```typescript
import type { AdapterOutput, ExtractConfig, PipelineState, PipelineStep } from './types';
import { transcribeAudio, summarize } from './ai-service';
import { generateVideoMarkdown, generateNoteMarkdown } from './markdown-generator';
import { loadSettings } from './config-manager';
import { MSG } from './messages';

function makeSteps(data: AdapterOutput): PipelineStep[] {
  if (data.type === 'video') {
    return [
      { id: 'extract', label: '提取视频信息', status: 'pending' },
      { id: 'download', label: '下载与处理音频', status: 'pending' },
      { id: 'transcribe', label: '语音转录', status: 'pending' },
      { id: 'summarize', label: '内容总结', status: 'pending' },
      { id: 'comments', label: '抓取评论', status: 'pending' },
      { id: 'generate', label: '生成 Markdown', status: 'pending' },
    ];
  }
  return [
    { id: 'extract', label: '提取笔记信息', status: 'pending' },
    { id: 'images', label: '图片理解', status: 'pending' },
    { id: 'summarize', label: '内容总结', status: 'pending' },
    { id: 'comments', label: '抓取评论', status: 'pending' },
    { id: 'generate', label: '生成 Markdown', status: 'pending' },
  ];
}

function buildState(steps: PipelineStep[], cancelled = false): PipelineState {
  return { steps: [...steps], cancelled };
}

export async function runVideoPipeline(
  data: AdapterOutput,
  config: ExtractConfig,
  onProgress: (state: PipelineState) => void
): Promise<{ markdown: string; filename: string }> {
  const steps = makeSteps(data);
  const update = (id: string, status: PipelineStep['status'], detail?: string) => {
    const step = steps.find((s) => s.id === id);
    if (step) {
      step.status = status;
      if (detail) step.detail = detail;
    }
    onProgress(buildState(steps));
  };

  // 步骤 1: 提取（由适配器完成，这里直接传入了 data）
  update('extract', 'done');
  update('download', 'running');

  // 步骤 2: 下载音频 + 提取
  let audioBlob: Blob | null = null;
  try {
    const response = await fetch(data.mediaUrls[0]);
    if (response.ok) {
      audioBlob = await response.blob();
    }
    update('download', 'done', audioBlob ? `${(audioBlob.size / 1024 / 1024).toFixed(1)}MB` : '通过URL下载');
  } catch (e) {
    update('download', 'error', (e as Error).message);
  }

  // 步骤 3: 转录
  update('transcribe', 'running', '硅基流动');
  let transcript = '';
  try {
    if (audioBlob) {
      const result = await transcribeAudio(audioBlob);
      transcript = result.text;
    }
    update('transcribe', 'done', `${transcript.length}字`);
  } catch (e) {
    update('transcribe', 'error', (e as Error).message);
    transcript = '*音频转录失败*';
  }

  // 步骤 4: 总结
  update('summarize', 'running', 'DeepSeek');
  let summary = '';
  try {
    const content = transcript || data.description || data.title;
    summary = await summarize(content, data.title);
    update('summarize', 'done');
  } catch (e) {
    update('summarize', 'error', (e as Error).message);
    summary = '*内容总结不可用*';
  }

  // 步骤 5: 评论（适配器中已抓取）
  update('comments', 'done', `${data.comments.length}条`);

  // 步骤 6: 生成 Markdown
  update('generate', 'running');
  const settings = await loadSettings();
  const markdown = generateVideoMarkdown(
    data,
    transcript,
    summary,
    config.commentSort || settings.defaultCommentSort,
    config.commentCount || settings.defaultCommentCount
  );
  update('generate', 'done', `${markdown.length}字`);

  const filename = `${data.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;

  return { markdown, filename };
}

export async function runNotePipeline(
  data: AdapterOutput,
  config: ExtractConfig,
  onProgress: (state: PipelineState) => void
): Promise<{ markdown: string; filename: string }> {
  const { describeImage } = await import('./ai-service');
  const steps = makeSteps(data);
  const update = (id: string, status: PipelineStep['status'], detail?: string) => {
    const step = steps.find((s) => s.id === id);
    if (step) {
      step.status = status;
      if (detail) step.detail = detail;
    }
    onProgress(buildState(steps));
  };

  update('extract', 'done');

  // 步骤 2: 图片理解
  update('images', 'running');
  const imageDescs: string[] = [];
  for (const imgUrl of data.mediaUrls) {
    try {
      const desc = await describeImage(imgUrl);
      imageDescs.push(desc);
    } catch {
      imageDescs.push('*图片无法识别*');
    }
  }
  update('images', 'done', `${imageDescs.length}张`);

  // 步骤 3: 总结
  update('summarize', 'running', 'DeepSeek');
  let summary = '';
  try {
    summary = await summarize(data.rawText || data.title, data.title);
    update('summarize', 'done');
  } catch (e) {
    update('summarize', 'error');
    summary = '*内容总结不可用*';
  }

  // 步骤 4: 评论
  update('comments', 'done', `${data.comments.length}条`);

  // 步骤 5: 生成
  update('generate', 'running');
  const settings = await loadSettings();
  const markdown = generateNoteMarkdown(
    data,
    imageDescs,
    summary,
    config.commentSort || settings.defaultCommentSort,
    config.commentCount || settings.defaultCommentCount
  );
  update('generate', 'done', `${markdown.length}字`);

  const filename = `${data.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;

  return { markdown, filename };
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx vitest run tests/pipeline.test.ts
```
预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add lib/pipeline.ts tests/pipeline.test.ts && git commit -m "feat: add pipeline orchestrator for video and note processing"
```

---

### 任务 9：侧边栏 UI — 结构、样式与空闲状态

**目标：** 创建侧边栏的 HTML 结构、CSS 样式和空闲首页状态逻辑。

**文件：**
- 创建：`travel-assistant/entrypoints/sidepanel/index.html`
- 创建：`travel-assistant/entrypoints/sidepanel/style.css`
- 创建：`travel-assistant/entrypoints/sidepanel/main.ts`

- [ ] **步骤 1：创建 sidepanel/index.html**

创建 `travel-assistant/entrypoints/sidepanel/index.html`：
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <div id="app" class="container">
    <!-- 初始加载状态 -->
    <div id="loading" class="loading">加载中...</div>
  </div>
  <script src="./main.ts" type="module"></script>
</body>
</html>
```

- [ ] **步骤 2：创建 sidepanel/style.css**

创建 `travel-assistant/entrypoints/sidepanel/style.css`：
```css
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --primary: #7c4dff;
  --primary-light: #b388ff;
  --bg: #fafafa;
  --card-bg: #ffffff;
  --text: #333333;
  --text-secondary: #666666;
  --text-muted: #999999;
  --border: #e0e0e0;
  --success: #4caf50;
  --error: #e53935;
  --warning: #ff9800;
  --running: #2196f3;
  --radius: 8px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: var(--text);
  background: var(--bg);
  min-height: 100vh;
}

.container {
  padding: 16px;
  max-width: 400px;
}

/* 空闲状态 */
.brand {
  text-align: center;
  padding: 24px 0 16px;
}

.brand-icon {
  font-size: 48px;
  margin-bottom: 8px;
}

.brand-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
}

.brand-subtitle {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 4px;
}

/* 按钮 */
.btn {
  display: block;
  width: 100%;
  padding: 12px;
  border: none;
  border-radius: var(--radius);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn:hover { opacity: 0.9; }

.btn-primary {
  background: var(--primary);
  color: white;
}

.btn-outline {
  background: white;
  color: var(--primary);
  border: 1px solid var(--primary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 进度列表 */
.progress-section {
  margin-top: 16px;
}

.progress-header {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--text-muted);
  transition: color 0.3s;
}

.progress-item.active { color: var(--text); font-weight: 500; }
.progress-item.done { color: var(--success); }
.progress-item.error { color: var(--error); }

.progress-icon {
  width: 20px;
  font-size: 14px;
  text-align: center;
  flex-shrink: 0;
}

.progress-label { flex: 1; }
.progress-detail {
  font-size: 11px;
  color: var(--text-muted);
}

/* 预览区 */
.preview-section {
  margin-top: 16px;
}

.preview-info {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.preview-content {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  max-height: 300px;
  overflow-y: auto;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.action-bar {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.action-bar .btn { flex: 1; }

/* 配置弹窗 */
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: white;
  border-radius: 12px;
  padding: 20px;
  width: 90%;
  max-width: 320px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.15);
}

.modal-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
}

.form-group {
  margin-bottom: 12px;
}

.form-label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.form-select, .form-input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  background: white;
  color: var(--text);
}

.form-radio-group {
  display: flex;
  gap: 12px;
}

.form-radio-group label {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}

.modal-actions .btn { flex: 1; font-size: 13px; padding: 10px; }

/* 提示条 */
.toast {
  background: var(--warning);
  color: white;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.toast a {
  color: white;
  font-weight: 600;
}

/* 最近记录 */
.history-section {
  margin-top: 20px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}

.history-title {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.history-item {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 6px;
}

.history-item-title {
  font-size: 13px;
  font-weight: 500;
}

.history-item-meta {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.hidden { display: none !important; }
```

- [ ] **步骤 3：创建 sidepanel/main.ts — 空闲状态**

创建 `travel-assistant/entrypoints/sidepanel/main.ts`：
```typescript
import { MSG } from '../../lib/messages';
import type { ExtractConfig, PipelineState, HistoryEntry } from '../../lib/types';

const app = document.getElementById('app')!;
let isExtracting = false;

// ========== 渲染函数 ==========

function renderIdleState(history: HistoryEntry[]): string {
  return `
    <div class="brand">
      <div class="brand-icon">🗺️</div>
      <div class="brand-title">旅游攻略助手</div>
      <div class="brand-subtitle">在视频或图文页面点击下方按钮开始</div>
    </div>

    <div id="toast-container"></div>

    <button id="btn-start" class="btn btn-primary">🎬 一键提取当前页面</button>

    ${history.length ? `
    <div class="history-section">
      <div class="history-title">最近记录</div>
      ${history.slice(0, 5).map(h => `
        <div class="history-item">
          <div class="history-item-title">${escapeHtml(h.title)}</div>
          <div class="history-item-meta">${h.platform} - ${new Date(h.timestamp).toLocaleString('zh-CN')}</div>
        </div>
      `).join('')}
    </div>
    ` : ''}

    <div id="config-modal" class="hidden">
      <div class="modal-overlay">
        <div class="modal">
          <div class="modal-title">提取配置</div>
          <div class="form-group">
            <label class="form-label">评论数量</label>
            <select id="cfg-comments" class="form-select">
              <option value="20">热门前 20 条</option>
              <option value="50" selected>热门前 50 条</option>
              <option value="100">热门前 100 条</option>
              <option value="0">全部评论</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">评论排序</label>
            <select id="cfg-sort" class="form-select">
              <option value="hot" selected>按热度</option>
              <option value="time">按时间</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">视频处理</label>
            <div class="form-radio-group">
              <label><input type="radio" name="download" value="false" checked> 仅转录</label>
              <label><input type="radio" name="download" value="true"> 下载+转录</label>
            </div>
          </div>
          <div class="modal-actions">
            <button id="btn-cancel-config" class="btn btn-outline">取消</button>
            <button id="btn-confirm-config" class="btn btn-primary">开始提取</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderProcessingState(title: string, state: PipelineState): string {
  const stepsHtml = state.steps.map(s => {
    let icon = '○';
    let cls = '';
    if (s.status === 'done') { icon = '✓'; cls = 'done'; }
    else if (s.status === 'running') { icon = '⟳'; cls = 'active'; }
    else if (s.status === 'error') { icon = '✗'; cls = 'error'; }
    return `
      <li class="progress-item ${cls}">
        <span class="progress-icon">${icon}</span>
        <span class="progress-label">${s.label}</span>
        ${s.detail ? `<span class="progress-detail">${s.detail}</span>` : ''}
      </li>
    `;
  }).join('');

  return `
    <div class="progress-section">
      <div class="progress-header">${escapeHtml(title)}</div>
      <ul class="progress-list">${stepsHtml}</ul>
      <button id="btn-cancel" class="btn btn-outline" style="margin-top:16px">取消</button>
    </div>
  `;
}

function renderCompleteState(title: string, platform: string, charCount: number, commentCount: number, markdown: string): string {
  return `
    <div class="preview-section">
      <div class="preview-info">
        <span>${escapeHtml(platform)}</span>
        <span>·</span>
        <span>${charCount}字</span>
        <span>·</span>
        <span>${commentCount}条评论</span>
      </div>
      <div class="preview-content">${escapeHtml(markdown).slice(0, 2000)}${markdown.length > 2000 ? '\n\n... (预览截断，完整内容请下载)' : ''}</div>
      <div class="action-bar">
        <button id="btn-download" class="btn btn-primary">⬇ 下载 Markdown</button>
      </div>
      <button id="btn-copy" class="btn btn-outline" style="margin-top:8px; width:100%">📋 复制到剪贴板</button>
    </div>
  `;
}

function escapeHtml(s: string): string {
  const el = document.createElement('div');
  el.textContent = s;
  return el.innerHTML;
}

// ========== 事件处理 ==========

function bindIdleEvents() {
  document.getElementById('btn-start')?.addEventListener('click', () => {
    document.getElementById('config-modal')!.classList.remove('hidden');
  });

  document.getElementById('btn-cancel-config')?.addEventListener('click', () => {
    document.getElementById('config-modal')!.classList.add('hidden');
  });

  document.getElementById('btn-confirm-config')?.addEventListener('click', () => {
    document.getElementById('config-modal')!.classList.add('hidden');
    startExtraction();
  });
}

function getConfig(): ExtractConfig {
  const commentCount = parseInt((document.getElementById('cfg-comments') as HTMLSelectElement).value) as ExtractConfig['commentCount'];
  const commentSort = (document.getElementById('cfg-sort') as HTMLSelectElement).value as ExtractConfig['commentSort'];
  const downloadVideo = (document.querySelector('input[name="download"]:checked') as HTMLInputElement)?.value === 'true';
  return { commentCount, commentSort, downloadVideo };
}

async function startExtraction() {
  if (isExtracting) return;
  isExtracting = true;

  const config = getConfig();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    // 请求内容脚本提取数据
    const response = await chrome.tabs.sendMessage(tab.id, { type: MSG.EXTRACT_PAGE_DATA });
    if (!response?.data) throw new Error('无法提取页面数据');

    // 请求 background 执行流水线
    chrome.runtime.sendMessage({
      type: MSG.START_EXTRACTION,
      tabId: tab.id,
      config,
    });
  } catch (e) {
    isExtracting = false;
    showToast(`提取失败: ${(e as Error).message}`, true);
  }
}

function showToast(message: string, isError = false) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  container.innerHTML = `<div class="toast" style="background:${isError ? 'var(--error)' : 'var(--warning)'}">${message}</div>`;
  setTimeout(() => { container.innerHTML = ''; }, 4000);
}

// ========== 消息监听 ==========

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.PROGRESS_UPDATE) {
    const state = msg.state as PipelineState;
    app.innerHTML = renderProcessingState('处理中...', state);
    bindProcessingEvents();
  }
  if (msg.type === MSG.EXTRACTION_COMPLETE) {
    isExtracting = false;
    const { markdown, metadata } = msg;
    app.innerHTML = renderCompleteState(metadata?.title || '', metadata?.platform || '', markdown.length, metadata?.commentCount || 0, markdown);
    bindCompleteEvents(markdown, msg.filename);
    // 保存历史
    saveHistory(metadata);
  }
});

function bindProcessingEvents() {
  document.getElementById('btn-cancel')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: MSG.CANCEL_EXTRACTION });
    isExtracting = false;
    loadIdleState();
  });
}

let _lastMarkdown = '';
let _lastFilename = '';

function bindCompleteEvents(markdown: string, filename: string) {
  _lastMarkdown = markdown;
  _lastFilename = filename;

  document.getElementById('btn-download')?.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    chrome.downloads.download({ url, filename, saveAs: true });
  });

  document.getElementById('btn-copy')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(markdown);
    showToast('已复制到剪贴板');
  });
}

async function saveHistory(metadata: any) {
  const { history = [] } = await chrome.storage.local.get('history');
  const entry: HistoryEntry = {
    id: Date.now().toString(),
    platform: metadata?.platform || 'unknown',
    title: metadata?.title || 'Untitled',
    url: metadata?.url || '',
    timestamp: Date.now(),
    charCount: metadata?.charCount || 0,
  };
  history.unshift(entry);
  await chrome.storage.local.set({ history: history.slice(0, 50) });
}

async function loadIdleState() {
  const { history = [] } = await chrome.storage.local.get('history');
  app.innerHTML = renderIdleState(history);
  bindIdleEvents();

  // 检查 API Key
  const { siliflowApiKey, deepseekApiKey } = await chrome.storage.local.get(['siliflowApiKey', 'deepseekApiKey']);
  if (!deepseekApiKey) {
    showToast('⚠️ 请先配置 API Key（<a href="#" id="go-options">前往设置</a>）');
    document.getElementById('go-options')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

// ========== 初始化 ==========
loadIdleState();
```

- [ ] **步骤 4：构建验证**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx tsc --noEmit
```
预期：类型检查通过。

- [ ] **步骤 5：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add entrypoints/sidepanel/ && git commit -m "feat: add side panel UI with idle, processing, and complete states"
```

---

### 任务 10：YouTube 内容脚本适配器

**目标：** 实现 YouTube 视频页面的 DOM 提取。

**文件：**
- 创建：`travel-assistant/entrypoints/youtube.content.ts`

- [ ] **步骤 1：创建 youtube.content.ts**

创建 `travel-assistant/entrypoints/youtube.content.ts`：
```typescript
import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.youtube.com/watch*'],
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === MSG.EXTRACT_PAGE_DATA) {
        extractYoutubeData()
          .then((data) => sendResponse({ data }))
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }
    });
  },
});

async function extractYoutubeData(): Promise<AdapterOutput> {
  const url = window.location.href;

  // 从页面 ytInitialData 提取
  const ytInitialData = (window as any).ytInitialData || (window as any).ytplayer?.config?.args?.player_response;
  let title = document.title.replace(' - YouTube', '').trim();
  let author = '';
  let publishDate: string | undefined;
  let description = '';
  let viewCount = 0;
  let likeCount = 0;

  // 从 ytInitialPlayerResponse 获取
  const playerResponse = (window as any).ytInitialPlayerResponse;
  if (playerResponse?.videoDetails) {
    const vd = playerResponse.videoDetails;
    title = vd.title || title;
    author = vd.author || '';
    viewCount = parseInt(vd.viewCount) || 0;
    description = vd.shortDescription || '';
  }

  // 从页面 meta 获取日期
  const dateEl = document.querySelector('meta[itemprop="datePublished"]');
  if (dateEl) {
    publishDate = dateEl.getAttribute('content')?.split('T')[0];
  }

  // 获取视频 URL — 自适应格式
  const mediaUrls: string[] = [];
  try {
    const formats = playerResponse?.streamingData?.adaptiveFormats || [];
    const audioFormat = formats.find((f: any) => f.mimeType?.startsWith('audio/'));
    if (audioFormat?.url) {
      mediaUrls.push(audioFormat.url);
    }
    const videoFormat = formats.find((f: any) => f.mimeType?.startsWith('video/'));
    if (videoFormat?.url) {
      mediaUrls.push(videoFormat.url);
    }
  } catch {}

  // 提取评论 — 从 DOM
  const comments: Comment[] = [];
  const commentEls = document.querySelectorAll('ytd-comment-thread-renderer');
  commentEls.forEach((el, i) => {
    if (i >= 100) return;
    const authorEl = el.querySelector('#author-text span');
    const contentEl = el.querySelector('#content-text');
    const likesEl = el.querySelector('#vote-count-middle');
    if (authorEl?.textContent && contentEl?.textContent) {
      comments.push({
        author: authorEl.textContent.trim(),
        content: contentEl.textContent.trim(),
        likes: parseInt(likesEl?.textContent?.trim() || '0') || 0,
        time: '',
      });
    }
  });

  return {
    platform: 'youtube',
    type: 'video',
    url,
    title,
    author,
    publishDate,
    description,
    mediaUrls,
    comments,
    metadata: { views: viewCount, likes: likeCount },
  };
}
```

- [ ] **步骤 2：构建验证**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx tsc --noEmit
```
预期：类型检查通过。

- [ ] **步骤 3：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add entrypoints/youtube.content.ts && git commit -m "feat: add YouTube content script adapter"
```

---

### 任务 11：抖音内容脚本适配器

**目标：** 实现抖音视频页面的 DOM 提取，处理分享链接和无水印视频 URL。

**文件：**
- 创建：`travel-assistant/entrypoints/douyin.content.ts`

- [ ] **步骤 1：创建 douyin.content.ts**

创建 `travel-assistant/entrypoints/douyin.content.ts`：
```typescript
import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.douyin.com/*', '*://*.iesdouyin.com/*'],
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === MSG.EXTRACT_PAGE_DATA) {
        extractDouyinData()
          .then((data) => sendResponse({ data }))
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }
    });
  },
});

async function extractDouyinData(): Promise<AdapterOutput> {
  const url = window.location.href;
  let title = '抖音视频';
  let author = '未知';
  let description = '';
  const mediaUrls: string[] = [];
  const comments: Comment[] = [];

  // 从页面全局变量提取（抖音页面结构多变，尝试多种路径）
  try {
    const routerData = (window as any)._ROUTER_DATA || (window as any).__NEXT_DATA__;
    const pageData = routerData?.loaderData || routerData?.props?.pageProps;
    const videoData = pageData?.['video_(id)'] || pageData?.videoInfo || pageData?.itemList?.[0];

    if (videoData) {
      const video = videoData.video || videoData;
      title = video.desc || video.title || title;
      author = video.author?.nickname || video.authorName || author;
      description = video.desc || '';

      // 获取无水印视频 URL
      if (video.playAddr || video.video?.playAddr) {
        const addr = (video.playAddr || video.video.playAddr);
        const urls = Array.isArray(addr) ? addr : [addr];
        for (const u of urls) {
          let videoUrl = u.url_list?.[0] || u.urlList?.[0] || u;
          // 替换水印域名
          videoUrl = videoUrl.replace('playwm', 'play');
          mediaUrls.push(videoUrl);
        }
      }
    }

    // 提取评论
    const commentList = pageData?.commentList || pageData?.comments || [];
    for (const c of (Array.isArray(commentList) ? commentList : []).slice(0, 100)) {
      comments.push({
        author: c.user?.nickname || c.userName || '',
        content: c.text || c.content || '',
        likes: c.digg_count || c.likeCount || 0,
        time: new Date((c.create_time || c.createTime || 0) * 1000).toISOString().split('T')[0],
      });
    }
  } catch (e) {
    // DOM 提取降级
    const videoEl = document.querySelector('video');
    if (videoEl?.src) mediaUrls.push(videoEl.src);
  }

  // 从页面元素提取
  if (!title || title === '抖音视频') {
    const titleEl = document.querySelector('[data-e2e="video-desc"], .video-title, h1');
    if (titleEl) title = titleEl.textContent?.trim() || title;
  }

  const likeCount = parseInt(document.querySelector('[data-e2e="like-count"]')?.textContent || '0') || 0;
  const commentCount = parseInt(document.querySelector('[data-e2e="comment-count"]')?.textContent || '0') || 0;

  return {
    platform: 'douyin',
    type: 'video',
    url,
    title,
    author,
    description,
    mediaUrls,
    comments,
    metadata: { likes: likeCount, commentCount },
  };
}
```

- [ ] **步骤 2：构建验证**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx tsc --noEmit
```
预期：类型检查通过。

- [ ] **步骤 3：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add entrypoints/douyin.content.ts && git commit -m "feat: add Douyin content script adapter"
```

---

### 任务 12：小红书内容脚本适配器

**目标：** 实现小红书笔记页面的 DOM 提取，获取图片、文本和评论。

**文件：**
- 创建：`travel-assistant/entrypoints/xiaohongshu.content.ts`

- [ ] **步骤 1：创建 xiaohongshu.content.ts**

创建 `travel-assistant/entrypoints/xiaohongshu.content.ts`：
```typescript
import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.xiaohongshu.com/explore/*', '*://*.xiaohongshu.com/discovery/item/*'],
  main() {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === MSG.EXTRACT_PAGE_DATA) {
        extractXhsData()
          .then((data) => sendResponse({ data }))
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }
    });
  },
});

async function extractXhsData(): Promise<AdapterOutput> {
  const url = window.location.href;
  let title = '小红书笔记';
  let author = '未知';
  let rawText = '';
  let publishDate: string | undefined;
  let likeCount = 0;
  let favoriteCount = 0;
  const mediaUrls: string[] = [];
  const comments: Comment[] = [];

  // 从页面初始状态提取（参考视频脚本的解析模式）
  try {
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const text = script.textContent || '';
      if (text.includes('window.__INITIAL_STATE__')) {
        const match = text.match(/window\.__INITIAL_STATE__\s*=\s*({.+?})\s*</s);
        if (match) {
          const state = JSON.parse(match[1].replace(/undefined/g, 'null'));
          const noteId = url.match(/explore\/([a-zA-Z0-9]+)/)?.[1];
          const note = noteId ? state?.note?.noteDetailMap?.[noteId]?.note : null;

          if (note) {
            title = note.title || title;
            author = note.user?.nickname || author;
            rawText = note.desc || '';
            publishDate = note.time ? new Date(note.time).toISOString().split('T')[0] : undefined;
            likeCount = note.interactInfo?.likedCount || 0;
            favoriteCount = note.interactInfo?.collectedCount || 0;

            // 图片 URL
            if (note.imageList) {
              for (const img of note.imageList) {
                const imgUrl = img.urlDefault || img.url || img.infoList?.[0]?.url;
                if (imgUrl) mediaUrls.push(imgUrl);
              }
            }

            // 评论
            const commentList = state?.note?.noteCommentMap?.[noteId]?.comments || [];
            for (const c of commentList.slice(0, 100)) {
              comments.push({
                author: c.userInfo?.nickname || '',
                content: c.content || '',
                likes: c.likeCount || 0,
                time: new Date(c.createTime || 0).toISOString().split('T')[0],
                replies: (c.subComments || []).map((r: any) => ({
                  author: r.userInfo?.nickname || '',
                  content: r.content || '',
                  likes: r.likeCount || 0,
                  time: '',
                })),
              });
            }
          }
          break;
        }
      }
    }
  } catch (e) {
    // 降级到 DOM 提取
  }

  // DOM 降级提取图片
  if (!mediaUrls.length) {
    const imgEls = document.querySelectorAll('.swiper-slide img, .note-image img, .image-container img');
    imgEls.forEach((img) => {
      const src = (img as HTMLImageElement).src;
      if (src && !src.includes('avatar')) mediaUrls.push(src);
    });
  }

  // DOM 降级提取文本
  if (!rawText) {
    const textEl = document.querySelector('.note-text, .desc, .content, [data-v-article]');
    if (textEl) rawText = textEl.textContent?.trim() || '';
  }

  // DOM 降级提取标题和作者
  if (!title || title === '小红书笔记') {
    title = document.querySelector('.title, h1, .note-title')?.textContent?.trim() || document.title.split(' - ')[0] || title;
    const authorEl = document.querySelector('.username, .author-name, .nickname');
    if (authorEl) author = authorEl.textContent?.trim() || author;
  }

  return {
    platform: 'xiaohongshu',
    type: 'note',
    url,
    title,
    author,
    publishDate,
    mediaUrls,
    rawText,
    comments,
    metadata: { likes: likeCount, favorites: favoriteCount },
  };
}
```

- [ ] **步骤 2：构建验证**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx tsc --noEmit
```
预期：类型检查通过。

- [ ] **步骤 3：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add entrypoints/xiaohongshu.content.ts && git commit -m "feat: add Xiaohongshu content script adapter"
```

---

### 任务 13：Background 完整集成

**目标：** 将 pipeline 调用、offscreen 音频处理、侧边栏通信在 background.ts 中完整集成。

**文件：**
- 修改：`travel-assistant/entrypoints/background.ts`

- [ ] **步骤 1：重写 background.ts 完整实现**

修改 `travel-assistant/entrypoints/background.ts`：
```typescript
import { MSG } from '../lib/messages';
import { runVideoPipeline, runNotePipeline } from '../lib/pipeline';
import type { ExtractConfig, PipelineState } from '../lib/types';

let currentTabId: number | null = null;
let cancelled = false;

// ==================== Offscreen 管理 ====================

let offscreenReady = false;

async function ensureOffscreen(): Promise<void> {
  if (offscreenReady) return;
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });
    if (contexts.length > 0) {
      offscreenReady = true;
      return;
    }
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Audio processing for video transcription',
    });
    offscreenReady = true;
  } catch (e) {
    // 可能已经存在
    offscreenReady = true;
  }
}

// ==================== 消息处理 ====================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 侧边栏 → Background
  if (msg.type === MSG.START_EXTRACTION) {
    handleStartExtraction(msg.tabId, msg.config)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  // 取消
  if (msg.type === MSG.CANCEL_EXTRACTION) {
    cancelled = true;
    return false;
  }
});

// ==================== 开屏设置页 ====================

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// ==================== 提取流程 ====================

async function handleStartExtraction(tabId: number, config: ExtractConfig) {
  cancelled = false;
  currentTabId = tabId;

  // 向内容脚本请求页面数据
  const response: any = await chrome.tabs.sendMessage(tabId, { type: MSG.EXTRACT_PAGE_DATA });

  if (!response?.data) {
    throw new Error(response?.error || '无法提取页面数据');
  }

  const data = response.data;

  // 进度回调 — 转发到侧边栏
  const onProgress = (state: PipelineState) => {
    chrome.runtime.sendMessage({
      type: MSG.PROGRESS_UPDATE,
      state,
    }).catch(() => {}); // 忽略 sidepanel 未连接的情况
  };

  let result: { markdown: string; filename: string };

  if (data.type === 'video') {
    result = await runVideoPipeline(data, config, onProgress);
  } else {
    result = await runNotePipeline(data, config, onProgress);
  }

  // 发送完成结果到侧边栏
  chrome.runtime.sendMessage({
    type: MSG.EXTRACTION_COMPLETE,
    markdown: result.markdown,
    filename: result.filename,
    metadata: {
      platform: data.platform,
      title: data.title,
      url: data.url,
      charCount: result.markdown.length,
      commentCount: data.comments?.length || 0,
    },
  }).catch(() => {});

  return { success: true };
}
```

- [ ] **步骤 2：构建验证**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx wxt build
```
预期：构建成功，无错误。

- [ ] **步骤 3：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add entrypoints/background.ts && git commit -m "feat: complete background integration with pipeline and sidepanel communication"
```

---

### 任务 14：设置页面

**目标：** 创建设置页面，支持 API Key 配置、默认设置和 API Key 有效性测试。

**文件：**
- 创建：`travel-assistant/entrypoints/options/index.html`
- 创建：`travel-assistant/entrypoints/options/main.ts`
- 创建：`travel-assistant/entrypoints/options/style.css`

- [ ] **步骤 1：创建 options/index.html**

创建 `travel-assistant/entrypoints/options/index.html`：
```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><link rel="stylesheet" href="./style.css"></head>
<body>
  <div class="settings-container">
    <h1>⚙️ 旅游攻略助手 — 设置</h1>

    <section class="settings-section">
      <h2>API Key 配置</h2>
      <div class="form-group">
        <label>硅基流动 API Key（语音转文字）</label>
        <input type="password" id="siliflow-key" placeholder="sk-..." class="input-full">
        <button id="btn-test-siliflow" class="btn btn-sm btn-outline">测试连接</button>
        <span id="siliflow-status" class="status-text"></span>
      </div>
      <div class="form-group">
        <label>DeepSeek API Key（图片理解 + 内容总结）</label>
        <input type="password" id="deepseek-key" placeholder="sk-..." class="input-full">
        <button id="btn-test-deepseek" class="btn btn-sm btn-outline">测试连接</button>
        <span id="deepseek-status" class="status-text"></span>
      </div>
    </section>

    <section class="settings-section">
      <h2>默认设置</h2>
      <div class="form-group">
        <label>默认评论数量</label>
        <select id="default-comment-count">
          <option value="20">热门前 20 条</option>
          <option value="50" selected>热门前 50 条</option>
          <option value="100">热门前 100 条</option>
          <option value="0">全部评论</option>
        </select>
      </div>
      <div class="form-group">
        <label>默认评论排序</label>
        <select id="default-comment-sort">
          <option value="hot" selected>按热度</option>
          <option value="time">按时间</option>
        </select>
      </div>
      <div class="form-group">
        <label>转录语言偏好</label>
        <select id="language">
          <option value="zh" selected>中文</option>
          <option value="en">英文</option>
          <option value="auto">自动检测</option>
        </select>
      </div>
    </section>

    <section class="settings-section">
      <h2>历史记录</h2>
      <div id="history-list"></div>
      <button id="btn-clear-history" class="btn btn-danger">清空历史记录</button>
    </section>

    <div class="save-bar">
      <span id="save-status" class="status-text"></span>
      <button id="btn-save" class="btn btn-primary">保存设置</button>
    </div>
  </div>
  <script src="./main.ts" type="module"></script>
</body>
</html>
```

- [ ] **步骤 2：创建 options/style.css**

创建 `travel-assistant/entrypoints/options/style.css`：
```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  color: #333;
  background: #f5f5f5;
}

.settings-container {
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 24px;
}

h1 { font-size: 22px; margin-bottom: 24px; }

.settings-section {
  background: white;
  border-radius: 10px;
  padding: 20px;
  margin-bottom: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.settings-section h2 {
  font-size: 16px;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #555;
  margin-bottom: 6px;
}

.input-full, select {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}

.input-full:focus, select:focus {
  border-color: #7c4dff;
  outline: none;
  box-shadow: 0 0 0 2px rgba(124,77,255,0.15);
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}

.btn:hover { opacity: 0.9; }

.btn-primary { background: #7c4dff; color: white; }
.btn-outline { background: white; color: #7c4dff; border: 1px solid #7c4dff; }
.btn-danger { background: #e53935; color: white; }
.btn-sm { padding: 6px 12px; font-size: 12px; }

.status-text {
  font-size: 12px;
  margin-left: 8px;
}

.status-text.success { color: #4caf50; }
.status-text.error { color: #e53935; }
.status-text.info { color: #2196f3; }

.save-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 13px;
}

.history-item:last-child { border-bottom: none; }
```

- [ ] **步骤 3：创建 options/main.ts**

创建 `travel-assistant/entrypoints/options/main.ts`：
```typescript
import { loadSettings, saveSettings, setApiKey, getApiKey } from '../../lib/config-manager';
import type { UserSettings } from '../../lib/types';

let settings: UserSettings;

async function load() {
  settings = await loadSettings();

  (document.getElementById('siliflow-key') as HTMLInputElement).value = settings.siliflowApiKey;
  (document.getElementById('deepseek-key') as HTMLInputElement).value = settings.deepseekApiKey;
  (document.getElementById('default-comment-count') as HTMLSelectElement).value = String(settings.defaultCommentCount);
  (document.getElementById('default-comment-sort') as HTMLSelectElement).value = settings.defaultCommentSort;
  (document.getElementById('language') as HTMLSelectElement).value = settings.language;

  await loadHistory();
}

async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get('history');
  const container = document.getElementById('history-list')!;
  if (!history.length) {
    container.innerHTML = '<p style="color:#999;font-size:13px">暂无历史记录</p>';
    return;
  }
  container.innerHTML = history.slice(0, 20).map((h: any) => `
    <div class="history-item">
      <span>${escapeHtml(h.title).slice(0, 40)}</span>
      <span style="color:#999;font-size:11px">${new Date(h.timestamp).toLocaleDateString('zh-CN')}</span>
    </div>
  `).join('');
}

document.getElementById('btn-save')?.addEventListener('click', async () => {
  const siliflowApiKey = (document.getElementById('siliflow-key') as HTMLInputElement).value.trim();
  const deepseekApiKey = (document.getElementById('deepseek-key') as HTMLInputElement).value.trim();
  const defaultCommentCount = parseInt((document.getElementById('default-comment-count') as HTMLSelectElement).value) as UserSettings['defaultCommentCount'];
  const defaultCommentSort = (document.getElementById('default-comment-sort') as HTMLSelectElement).value as UserSettings['defaultCommentSort'];
  const language = (document.getElementById('language') as HTMLSelectElement).value as UserSettings['language'];

  await saveSettings({ siliflowApiKey, deepseekApiKey, defaultCommentCount, defaultCommentSort, language });
  await setApiKey('siliflow', siliflowApiKey);
  await setApiKey('deepseek', deepseekApiKey);

  const status = document.getElementById('save-status')!;
  status.textContent = '设置已保存 ✓';
  status.className = 'status-text success';
  setTimeout(() => { status.textContent = ''; }, 2000);
});

document.getElementById('btn-test-siliflow')?.addEventListener('click', async () => {
  const key = (document.getElementById('siliflow-key') as HTMLInputElement).value.trim();
  const status = document.getElementById('siliflow-status')!;
  if (!key) { status.textContent = '请先输入 API Key'; status.className = 'status-text error'; return; }

  status.textContent = '测试中...';
  status.className = 'status-text info';
  try {
    const res = await fetch('https://api.siliconflow.cn/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      status.textContent = '连接成功 ✓';
      status.className = 'status-text success';
    } else {
      status.textContent = `错误: ${res.status}`;
      status.className = 'status-text error';
    }
  } catch {
    status.textContent = '网络错误';
    status.className = 'status-text error';
  }
});

document.getElementById('btn-test-deepseek')?.addEventListener('click', async () => {
  const key = (document.getElementById('deepseek-key') as HTMLInputElement).value.trim();
  const status = document.getElementById('deepseek-status')!;
  if (!key) { status.textContent = '请先输入 API Key'; status.className = 'status-text error'; return; }

  status.textContent = '测试中...';
  status.className = 'status-text info';
  try {
    const res = await fetch('https://api.deepseek.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      status.textContent = '连接成功 ✓';
      status.className = 'status-text success';
    } else {
      status.textContent = `错误: ${res.status}`;
      status.className = 'status-text error';
    }
  } catch {
    status.textContent = '网络错误';
    status.className = 'status-text error';
  }
});

document.getElementById('btn-clear-history')?.addEventListener('click', async () => {
  await chrome.storage.local.set({ history: [] });
  await loadHistory();
});

function escapeHtml(s: string): string {
  const el = document.createElement('div');
  el.textContent = s;
  return el.innerHTML;
}

load();
```

- [ ] **步骤 4：构建验证**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx wxt build
```
预期：构建成功，`dist/` 包含所有文件。

- [ ] **步骤 5：运行全部测试**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx vitest run
```
预期：全部 PASS。

- [ ] **步骤 6：Commit**

```bash
cd D:/home/chrome/travel-assistant && git add entrypoints/options/ && git commit -m "feat: add options page with API key management and settings"
```

---

### 任务 15：集成验证与清理

**目标：** 运行完整构建和测试，修复任何集成问题。

- [ ] **步骤 1：运行完整测试套件**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx vitest run
```
预期：全部测试通过。

- [ ] **步骤 2：运行生产构建**

运行：
```bash
cd D:/home/chrome/travel-assistant && npx wxt build
```
预期：无错误，`dist/` 目录正确生成。

- [ ] **步骤 3：检查构建产物**

运行：
```bash
cd D:/home/chrome/travel-assistant && ls dist/
```
预期：`manifest.json` + `sidepanel.html` + `options.html` + `offscreen.html` + `background.js` + content script JS 文件 + icons。

- [ ] **步骤 4：验证 manifest.json 权限**

运行：
```bash
cd D:/home/chrome/travel-assistant && cat dist/manifest.json | grep -E "permissions|host_permissions|side_panel"
```
预期：包含 `sidePanel`、`storage`、`downloads`、`activeTab`、`offscreen`，host_permissions 包含所有目标平台域名。

- [ ] **步骤 5：最终 Commit**

```bash
cd D:/home/chrome/travel-assistant && git add -A && git commit -m "feat: complete integration, all tests pass, production build verified"
```
