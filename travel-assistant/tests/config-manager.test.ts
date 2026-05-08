import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserSettings } from '../lib/types';

// Mock chrome.storage with runtime.lastError support
const mockStorage: Record<string, unknown> = {};
const chromeError = { current: null as { message: string } | null };

const runtimeObj = {
  get lastError() { return chromeError.current; },
  set lastError(v: { message: string } | null) { chromeError.current = v; },
};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (keys: string[], cb: (result: Record<string, unknown>) => void) => {
        if (chromeError.current) {
          runtimeObj.lastError = chromeError.current;
          cb({});
          runtimeObj.lastError = null;
          return;
        }
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (key in mockStorage) result[key] = mockStorage[key];
        }
        cb(result);
      },
      set: (items: Record<string, unknown>, cb?: () => void) => {
        if (chromeError.current) {
          runtimeObj.lastError = chromeError.current;
          cb?.();
          runtimeObj.lastError = null;
          return;
        }
        Object.assign(mockStorage, items);
        cb?.();
      },
    },
  },
  runtime: runtimeObj,
});

import {
  loadSettings,
  saveSettings,
  getApiKey,
  setApiKey,
  DEFAULT_SETTINGS,
} from '../lib/config-manager';

describe('config-manager', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    chromeError.current = null;
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
      mockStorage.settings = { siliflowApiKey: 'sk-test123' };
      const key = await getApiKey('siliflow');
      expect(key).toBe('sk-test123');
    });

    it('returns empty string when no key stored', async () => {
      const key = await getApiKey('siliflow');
      expect(key).toBe('');
    });
  });

  describe('setApiKey', () => {
    it('stores API key in settings storage', async () => {
      await setApiKey('deepseek', 'sk-ds-456');
      const settings = mockStorage.settings as UserSettings;
      expect(settings.deepseekApiKey).toBe('sk-ds-456');
    });
  });

  describe('error handling', () => {
    it('loadSettings rejects on chrome.runtime.lastError', async () => {
      chromeError.current = { message: 'Storage read failed' };
      await expect(loadSettings()).rejects.toThrow('Storage read failed');
    });

    it('saveSettings rejects on chrome.runtime.lastError', async () => {
      chromeError.current = { message: 'Storage write failed' };
      await expect(saveSettings({ language: 'en' })).rejects.toThrow('Storage write failed');
    });
  });
});
