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
