import type { UserSettings } from './types';

export const DEFAULT_SETTINGS: UserSettings = {
  siliflowApiKey: '',
  deepseekApiKey: '',
  kimiApiKey: '',
  defaultCommentCount: 50,
  defaultCommentSort: 'hot',
  language: 'zh',
};

const STORAGE_KEY = 'settings';

export function loadSettings(): Promise<UserSettings> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const stored = result[STORAGE_KEY] as Partial<UserSettings> | undefined;
      resolve({ ...DEFAULT_SETTINGS, ...stored });
    });
  });
}

export function saveSettings(partial: Partial<UserSettings>): Promise<void> {
  return new Promise((resolve, reject) => {
    loadSettings().then((current) => {
      const updated = { ...current, ...partial };
      chrome.storage.local.set({ [STORAGE_KEY]: updated }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    }).catch(reject);
  });
}

const API_KEY_MAP: Record<'siliflow' | 'deepseek' | 'kimi', keyof Pick<UserSettings, 'siliflowApiKey' | 'deepseekApiKey' | 'kimiApiKey'>> = {
  siliflow: 'siliflowApiKey',
  deepseek: 'deepseekApiKey',
  kimi: 'kimiApiKey',
};

export function getApiKey(service: 'siliflow' | 'deepseek' | 'kimi'): Promise<string> {
  return loadSettings().then(settings => settings[API_KEY_MAP[service]]);
}

export function setApiKey(service: 'siliflow' | 'deepseek' | 'kimi', value: string): Promise<void> {
  return saveSettings({ [API_KEY_MAP[service]]: value } as Partial<UserSettings>);
}
