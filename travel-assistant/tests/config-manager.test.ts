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
