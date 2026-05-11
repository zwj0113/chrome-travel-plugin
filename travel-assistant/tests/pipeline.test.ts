import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AdapterOutput, PipelineStep } from '../lib/types';

// Mock 外部依赖
const mockTranscribe = vi.fn();
const mockFormatTranscript = vi.fn();
const mockGenerateVideoMarkdown = vi.fn();

// Mock global fetch for audio download step
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../lib/ai-service', () => ({
  transcribeAudio: (...args: any[]) => mockTranscribe(...args),
  formatTranscript: (...args: any[]) => mockFormatTranscript(...args),
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
    mockFormatTranscript.mockResolvedValue('格式化后的转录文本');
    mockGenerateVideoMarkdown.mockReturnValue('# Test Video\n\n## Content');
    // 模拟音频下载成功
    mockFetch.mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['fake-audio'], { type: 'audio/mp4' })),
      headers: new Map([['content-type', 'audio/mp4']]),
    });
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
  });
});
