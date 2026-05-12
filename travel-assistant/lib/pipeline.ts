import type { AdapterOutput, ExtractConfig, PipelineState, PipelineStep } from './types';
import { transcribeAudio, formatTranscript, describeImage } from './ai-service';
import { generateVideoMarkdown, generateNoteMarkdown } from './markdown-generator';
import { loadSettings } from './config-manager';

function makeSteps(data: AdapterOutput): PipelineStep[] {
  if (data.type === 'video') {
    return [
      { id: 'extract', label: '提取视频信息', status: 'pending' },
      { id: 'download', label: '下载与处理音频', status: 'pending' },
      { id: 'transcribe', label: '语音转录', status: 'pending' },
      { id: 'format', label: '智能纠错与格式化', status: 'pending' },
      { id: 'comments', label: '抓取评论', status: 'pending' },
      { id: 'generate', label: '生成 Markdown', status: 'pending' },
    ];
  }
  return [
    { id: 'extract', label: '提取笔记信息', status: 'pending' },
    { id: 'images', label: '图片理解', status: 'pending' },
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
  onProgress: (state: PipelineState) => void,
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
  const csDiag = (data.metadata._diag as string) || '';
  update('extract', 'done', csDiag.slice(0, 200));
  update('download', 'running');

  // 步骤 2: 下载音频 + 提取
  // mediaUrls 从后往前试（音频 URL 在末尾优先），declarativeNetRequest 自动注入 Referer
  let audioBlob: Blob | null = null;
  const diag: string[] = [];
  for (let i = data.mediaUrls.length - 1; i >= 0; i--) {
    const url = data.mediaUrls[i];
    if (!url) { diag.push(`[${i}] skip: empty`); continue; }
    // 截取 URL 前 80 字符用于诊断
    const shortUrl = url.slice(0, 80) + (url.length > 80 ? '...' : '');
    try {
      const response = await fetch(url);
      diag.push(`[${i}] ${response.status} ${response.headers.get('content-type') || '?'} ${shortUrl}`);
      if (response.ok) {
        audioBlob = await response.blob();
        diag.push(`[${i}] blob size=${audioBlob?.size || 0}`);
        if (audioBlob && audioBlob.size > 0) break;
      }
    } catch (e) {
      diag.push(`[${i}] ERR: ${(e as Error).message} ${shortUrl}`);
    }
  }
  if (audioBlob && audioBlob.size > 0) {
    update('download', 'done', `${(audioBlob.size / 1024 / 1024).toFixed(1)}MB`);
  } else {
    update('download', 'error', diag.join(' | ') || '所有音频 URL 都不可用');
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

  // 步骤 4: 智能纠错与格式化
  update('format', 'running', 'DeepSeek');
  let formattedTranscript = transcript;
  if (transcript && transcript !== '*音频转录失败*') {
    try {
      formattedTranscript = await formatTranscript(
        transcript,
        data.title,
        data.platform,
        data.url,
      );
      update('format', 'done', `${formattedTranscript.length}字`);
    } catch (e) {
      update('format', 'error', (e as Error).message);
      // 纠错失败时使用原始转录文本
    }
  } else {
    update('format', 'done', '跳过（无转录内容）');
  }

  // 步骤 5: 评论（适配器中已抓取）
  update('comments', 'done', `${data.comments.length}条`);

  // 步骤 6: 生成 Markdown
  update('generate', 'running');
  const settings = await loadSettings();
  const markdown = generateVideoMarkdown(
    data,
    formattedTranscript,
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
    } catch (e) {
      const errMsg = (e as Error).message || String(e);
      console.error(`[travel-assistant] describeImage failed: ${errMsg}`, imgUrl.slice(0, 80));
      imageDescs.push(`*图片无法识别（${errMsg.slice(0, 60)}）*`);
    }
  }
  update('images', 'done', `${imageDescs.length}张`);

  // 步骤 3: 评论
  update('comments', 'done', `${data.comments.length}条`);

  // 步骤 4: 生成
  update('generate', 'running');
  const settings = await loadSettings();
  const markdown = generateNoteMarkdown(
    data,
    imageDescs,
    config.commentSort || settings.defaultCommentSort,
    config.commentCount || settings.defaultCommentCount
  );
  update('generate', 'done', `${markdown.length}字`);

  const filename = `${data.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;

  return { markdown, filename };
}
