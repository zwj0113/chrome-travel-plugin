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
  enableImageRecognition: boolean; // 小红书图片识别（下载+base64）
}

/** 用户设置 */
export interface UserSettings {
  siliflowApiKey: string;
  deepseekApiKey: string;
  kimiApiKey: string;
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
