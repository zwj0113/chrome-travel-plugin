import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock chrome.storage — compatible with how getApiKey uses loadSettings internally
// loadSettings reads from the composite "settings" key, so use mockStorage.settings = {...}
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
      mockStorage.settings = { siliflowApiKey: 'sk-test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: '这是转录文本' }),
      });

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
      mockStorage.settings = { deepseekApiKey: 'sk-ds' };
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
      mockStorage.settings = { deepseekApiKey: 'sk-ds' };
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
