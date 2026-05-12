import type { AdapterOutput, ExtractConfig, PipelineState, PipelineStep } from './types';
import { transcribeAudio, formatTranscript, describeImage } from './ai-service';
import { generateVideoMarkdown, generateNoteMarkdown } from './markdown-generator';
import { loadSettings } from './config-manager';
import { createLogger } from './logger';
import type { PipelineLogger } from './logger';

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
    { id: 'images', label: '图片文字提取', status: 'pending' },
    { id: 'comments', label: '抓取评论', status: 'pending' },
    { id: 'generate', label: '生成 Markdown', status: 'pending' },
  ];
}

function buildState(steps: PipelineStep[], cancelled = false): PipelineState {
  return { steps: [...steps], cancelled };
}

export interface PipelineResult {
  markdown: string;
  filename: string;
  log: string;
}

export async function runVideoPipeline(
  data: AdapterOutput,
  config: ExtractConfig,
  onProgress: (state: PipelineState) => void,
): Promise<PipelineResult> {
  const log = createLogger();
  const steps = makeSteps(data);
  const update = (id: string, status: PipelineStep['status'], detail?: string) => {
    const step = steps.find((s) => s.id === id);
    if (step) {
      step.status = status;
      if (detail) step.detail = detail;
    }
    onProgress(buildState(steps));
  };

  log.info('pipeline', `开始视频流水线: title="${data.title}", platform=${data.platform}, type=${data.type}, mediaUrls=${data.mediaUrls.length}个, comments=${data.comments.length}条`);

  // 步骤 1: 提取
  const csDiag = (data.metadata._diag as string) || '';
  log.info('extract', `适配器提取完成, title="${data.title}", author="${data.author}", 诊断="${csDiag.slice(0, 150)}"`);
  update('extract', 'done', csDiag.slice(0, 200));

  // 步骤 2: 下载音频
  log.info('download', `开始下载音频, mediaUrls数量=${data.mediaUrls.length}`);
  update('download', 'running');
  let audioBlob: Blob | null = null;
  const diag: string[] = [];
  for (let i = data.mediaUrls.length - 1; i >= 0; i--) {
    const url = data.mediaUrls[i];
    if (!url) { diag.push(`[${i}] skip: empty`); continue; }
    const shortUrl = url.slice(0, 80) + (url.length > 80 ? '...' : '');
    log.info('download', `尝试 URL [${i}]: ${shortUrl}`);
    try {
      const response = await fetch(url);
      const ct = response.headers.get('content-type') || '?';
      diag.push(`[${i}] ${response.status} ${ct} ${shortUrl}`);
      log.info('download', `URL [${i}] 响应: status=${response.status}, content-type=${ct}`);
      if (response.ok) {
        audioBlob = await response.blob();
        const sizeMB = audioBlob ? (audioBlob.size / 1024 / 1024).toFixed(1) : '0';
        diag.push(`[${i}] blob size=${audioBlob?.size || 0}`);
        log.info('download', `URL [${i}] 下载成功: ${sizeMB}MB`);
        if (audioBlob && audioBlob.size > 0) break;
      }
    } catch (e) {
      diag.push(`[${i}] ERR: ${(e as Error).message} ${shortUrl}`);
      log.warn('download', `URL [${i}] 下载异常: ${(e as Error).message}`);
    }
  }
  if (audioBlob && audioBlob.size > 0) {
    log.info('download', `音频下载完成: ${(audioBlob.size / 1024 / 1024).toFixed(1)}MB`);
    update('download', 'done', `${(audioBlob.size / 1024 / 1024).toFixed(1)}MB`);
  } else {
    log.error('download', `所有音频 URL 不可用: ${diag.join(' | ')}`);
    update('download', 'error', diag.join(' | ') || '所有音频 URL 都不可用');
  }

  // 步骤 3: 转录
  log.info('transcribe', `开始语音转录, 音频大小=${audioBlob ? (audioBlob.size / 1024 / 1024).toFixed(1) + 'MB' : '无音频'}`);
  update('transcribe', 'running', '硅基流动');
  let transcript = '';
  try {
    if (audioBlob) {
      const result = await transcribeAudio(audioBlob);
      transcript = result.text;
      log.info('transcribe', `转录成功: ${transcript.length}字`);
    } else {
      log.warn('transcribe', '跳过转录: 无音频数据');
    }
    update('transcribe', 'done', `${transcript.length}字`);
  } catch (e) {
    log.error('transcribe', `转录失败: ${(e as Error).message}`);
    update('transcribe', 'error', (e as Error).message);
    transcript = '*音频转录失败*';
  }

  // 步骤 4: 智能纠错与格式化
  log.info('format', `开始智能纠错与格式化, 转录字数=${transcript.length}, 模型=deepseek-v4-pro`);
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
      log.info('format', `纠错格式化成功: ${formattedTranscript.length}字`);
      update('format', 'done', `${formattedTranscript.length}字`);
    } catch (e) {
      log.error('format', `纠错格式化失败: ${(e as Error).message}, 使用原始转录`);
      update('format', 'error', (e as Error).message);
    }
  } else {
    log.info('format', '跳过纠错格式化: 无转录内容');
    update('format', 'done', '跳过（无转录内容）');
  }

  // 步骤 5: 评论
  log.info('comments', `评论数据: ${data.comments.length}条`);
  update('comments', 'done', `${data.comments.length}条`);

  // 步骤 6: 生成 Markdown
  log.info('generate', '开始生成 Markdown');
  update('generate', 'running');
  const settings = await loadSettings();
  const markdown = generateVideoMarkdown(
    data,
    formattedTranscript,
    config.commentSort || settings.defaultCommentSort,
    config.commentCount || settings.defaultCommentCount
  );
  log.info('generate', `Markdown 生成完成: ${markdown.length}字`);
  update('generate', 'done', `${markdown.length}字`);

  const filename = `${data.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
  log.info('pipeline', `视频流水线完成: ${filename}, markdown=${markdown.length}字`);

  return { markdown, filename, log: log.toString() };
}

export async function runNotePipeline(
  data: AdapterOutput,
  config: ExtractConfig,
  onProgress: (state: PipelineState) => void
): Promise<PipelineResult> {
  const log = createLogger();
  const steps = makeSteps(data);
  const update = (id: string, status: PipelineStep['status'], detail?: string) => {
    const step = steps.find((s) => s.id === id);
    if (step) {
      step.status = status;
      if (detail) step.detail = detail;
    }
    onProgress(buildState(steps));
  };

  log.info('pipeline', `开始笔记流水线: title="${data.title}", platform=${data.platform}, type=${data.type}, mediaUrls=${data.mediaUrls.length}个, comments=${data.comments.length}条`);

  // 步骤 1: 提取
  log.info('extract', `适配器提取完成: title="${data.title}", author="${data.author}", mediaUrls=${data.mediaUrls.length}个, rawText=${(data.rawText || '').length}字`);
  update('extract', 'done');

  // 步骤 2: 图片文字提取
  log.info('images', `开始图片文字提取, 共 ${data.mediaUrls.length} 张, 模型=kimi-k2.6`);
  update('images', 'running', `0/${data.mediaUrls.length}`);
  const imageDescs: string[] = [];
  let skipCount = 0;
  for (let i = 0; i < data.mediaUrls.length; i++) {
    const imgUrl = data.mediaUrls[i];
    const imgLabel = imgUrl.startsWith('data:')
      ? `data:...;base64,${imgUrl.slice(imgUrl.indexOf(';base64,') + 8, imgUrl.indexOf(';base64,') + 28)}... (${(imgUrl.length / 1024).toFixed(0)}KB)`
      : imgUrl.slice(0, 60);
    log.info('images', `[${i + 1}/${data.mediaUrls.length}] 提取图片文字: ${imgLabel}`);
    update('images', 'running', `${i + 1}/${data.mediaUrls.length} 识别中...`);
    try {
      const text = await describeImage(imgUrl);
      if (text === '无文字' || text.trim() === '无文字') {
        skipCount++;
        log.info('images', `[${i + 1}/${data.mediaUrls.length}] 无文字，跳过`);
        update('images', 'running', `${i + 1}/${data.mediaUrls.length} 无文字跳过`);
      } else {
        imageDescs.push(text);
        log.info('images', `[${i + 1}/${data.mediaUrls.length}] 文字提取成功: ${text.length}字 → "${text.slice(0, 40)}..."`);
        update('images', 'running', `${i + 1}/${data.mediaUrls.length} 成功`);
      }
    } catch (e) {
      const errMsg = (e as Error).message || String(e);
      log.error('images', `[${i + 1}/${data.mediaUrls.length}] 识别失败: ${errMsg}`);
      imageDescs.push(`*图片无法识别（${errMsg.slice(0, 60)}）*`);
      update('images', 'running', `${i + 1}/${data.mediaUrls.length} 失败`);
    }
  }
  const successCount = imageDescs.filter(d => !d.startsWith('*图片无法识别')).length;
  log.info('images', `图片文字提取完成: ${successCount}张有文字, ${skipCount}张无文字跳过, ${data.mediaUrls.length - successCount - skipCount}张失败`);
  update('images', 'done', `${successCount}有文字 ${skipCount}跳过`);

  // 步骤 3: 评论
  log.info('comments', `评论数据: ${data.comments.length}条`);
  update('comments', 'done', `${data.comments.length}条`);

  // 步骤 4: 生成 Markdown
  log.info('generate', '开始生成 Markdown');
  update('generate', 'running');
  const settings = await loadSettings();
  const markdown = generateNoteMarkdown(
    data,
    imageDescs,
    config.commentSort || settings.defaultCommentSort,
    config.commentCount || settings.defaultCommentCount
  );
  log.info('generate', `Markdown 生成完成: ${markdown.length}字`);
  update('generate', 'done', `${markdown.length}字`);

  const filename = `${data.title.replace(/[\\/:*?"<>|]/g, '_')}.md`;
  log.info('pipeline', `笔记流水线完成: ${filename}, markdown=${markdown.length}字, 有文字图片=${successCount}, 跳过=${skipCount}`);

  return { markdown, filename, log: log.toString() };
}
