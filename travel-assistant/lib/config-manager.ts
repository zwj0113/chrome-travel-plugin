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
