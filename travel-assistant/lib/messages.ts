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

  // Background → 内容脚本（下载媒体）
  DOWNLOAD_AUDIO: 'downloadAudio',
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
