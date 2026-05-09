import { MSG } from '../../lib/messages';

// 从视频 URL 下载音频并转码为 16kHz WAV
async function downloadAndExtractAudio(videoUrl: string): Promise<ArrayBuffer> {
  // 下载视频
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`下载视频失败: ${response.status}`);
  const videoBlob = await response.blob();

  // 使用 Web Audio API 提取音频
  const audioContext = new AudioContext({ sampleRate: 16000 });
  const arrayBuffer = await videoBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // 创建离线渲染上下文，转码为 16kHz 单声道 WAV
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * 16000, 16000);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();

  const renderedBuffer = await offlineCtx.startRendering();
  await audioContext.close();

  // 将 AudioBuffer 转为 WAV ArrayBuffer
  return audioBufferToWav(renderedBuffer);
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const dataLength = length * numChannels * 2;
  const headerLen = 44;
  const totalLength = headerLen + dataLength;
  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

// 监听来自 background 的消息
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === MSG.PROCESS_AUDIO) {
    downloadAndExtractAudio(msg.videoUrl)
      .then((audioBlob) => sendResponse({ audioBlob: new Uint8Array(audioBlob) }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});
