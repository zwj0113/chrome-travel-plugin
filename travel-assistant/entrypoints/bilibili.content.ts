import type { AdapterOutput, Comment } from '../lib/types';
import { MSG } from '../lib/messages';
import type { PageDataExtractedPayload, StartExtractionPayload, ExtractionCompletePayload, ProgressUpdatePayload } from '../lib/messages';

export default defineContentScript({
  matches: ['*://*.bilibili.com/video/*'],
  main() {
    // 只在顶层 frame 响应，避免 iframe 中的内容脚本返回不完整数据
    if (window.self !== window.top) return;

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === MSG.EXTRACT_PAGE_DATA) {
        const cfg = msg.config || {};
        extractBilibiliData(cfg.commentSort, cfg.commentCount)
          .then((data) => sendResponse({ data }))
          .catch((err) => sendResponse({ error: err.message }));
        return true;
      }
    });
  },
});

async function extractBilibiliData(sort?: string, maxCount?: number): Promise<AdapterOutput> {
  const url = window.location.href;
  const bvid = url.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1] || '';

  // 从页面脚本变量提取视频信息
  const initialState = (window as any).__INITIAL_STATE__;
  const videoData = initialState?.videoData;

  const title = videoData?.title || document.title.replace('_哔哩哔哩_bilibili', '').trim();
  const author = videoData?.owner?.name || '未知';
  const publishDate = videoData?.pubdate
    ? new Date(videoData.pubdate * 1000).toISOString().split('T')[0]
    : undefined;
  const description = videoData?.desc || '';

  // 通过 B站 API 获取播放地址
  const mediaUrls: string[] = [];
  const diag: string[] = [];
  let viewApiData: any = null; // 缓存 view API 结果，评论也需要 aid
  if (bvid) {
    try {
      // 尝试从多个可能位置获取 cid
      let cid = videoData?.pages?.[0]?.cid || videoData?.cid;
      // 也尝试 __playinfo__（页面播放器已加载的视频信息）
      const playinfo = (window as any).__playinfo__;
      if (!cid && playinfo?.data?.cid) cid = playinfo.data.cid;
      // 尝试 episodeInfo
      const epInfo = initialState?.epInfo;
      if (!cid && epInfo?.cid) cid = epInfo.cid;
      // 尝试从 videoInfo 获取
      if (!cid && initialState?.videoInfo?.cid) cid = initialState.videoInfo.cid;

      diag.push(`bvid=${bvid} cid=${cid || 'NOT_FOUND'}`);

      // 如果页面状态中找不到 cid，通过 API 获取
      if (!cid) {
        diag.push('cid_not_in_page, trying view API');
        const viewResp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
          headers: { Referer: 'https://www.bilibili.com/' },
        });
        if (viewResp.ok) {
          viewApiData = await viewResp.json();
          cid = viewApiData?.data?.cid;
          diag.push(`view_api_cid=${cid || 'NOT_FOUND'}`);
        }
      }

      if (cid) {
        const apiUrl = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=80&fourk=1`;
        const resp = await fetch(apiUrl, {
          headers: { Referer: 'https://www.bilibili.com/' },
        });
        diag.push(`playurl_api_status=${resp.status}`);
        if (!resp.ok) throw new Error(`playurl API 返回 ${resp.status}`);
        const json = await resp.json();
        diag.push(`playurl_code=${json.code} dash_video=${json?.data?.dash?.video?.length || 0} dash_audio=${json?.data?.dash?.audio?.length || 0}`);
        if (json.code !== 0) throw new Error(`playurl API 错误: ${json.message || json.code}`);
        const dash = json?.data?.dash;
        if (dash?.video?.length) {
          const v = dash.video[0];
          const urls = [v.baseUrl, v.base_url, ...(v.backupUrl || []), ...(v.backup_url || [])];
          for (const u of urls) {
            if (u) {
              mediaUrls.push(u);
              diag.push(`video_url=${u.slice(0, 80)}`);
            }
          }
        }
        if (dash?.audio?.length) {
          const a = dash.audio[0];
          const urls = [a.baseUrl, a.base_url, ...(a.backupUrl || []), ...(a.backup_url || [])];
          for (const u of urls) {
            if (u) {
              mediaUrls.push(u);
              diag.push(`audio_url=${u.slice(0, 80)}`);
            }
          }
        }
      } else {
        diag.push('cid_not_found_all_sources');
      }
    } catch (e) {
      diag.push(`playurl_err=${(e as Error).message}`);
      const videoEl = document.querySelector('video');
      if (videoEl?.src) {
        mediaUrls.push(videoEl.src);
        diag.push(`fallback_video_src=${videoEl.src.slice(0, 80)}`);
      }
    }
  }
  console.log('[travel-assistant] bilibili extract diag:', diag.join(' | '));

  // 提取评论（从 API，支持跨 mode 分页）
  const comments: Comment[] = [];
  const targetCount = maxCount || 50;
  const isHot = sort !== 'time'; // 默认按热度
  const preferredMode = isHot ? 3 : 2;
  const alternateMode = isHot ? 2 : 3;
  try {
    // 尝试多个来源获取 aid
    let aid = videoData?.aid || initialState?.aid || initialState?.videoInfo?.aid;
    diag.push(`aid_page=${aid || 'NOT_FOUND'}`);

    // 页面找不到 aid 则通过 view API 获取
    if (!aid) {
      if (!viewApiData) {
        diag.push('aid_not_in_page, trying view API');
        const viewResp = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
          headers: { Referer: 'https://www.bilibili.com/' },
        });
        if (viewResp.ok) {
          viewApiData = await viewResp.json();
        }
      }
      aid = viewApiData?.data?.aid;
      diag.push(`view_api_aid=${aid || 'NOT_FOUND'}`);
    }

    if (aid) {
      const fetchedIds = new Set<string>();

      // 从单个 mode 分页获取评论
      const fetchMode = async (mode: number, maxPages = 10): Promise<number> => {
        let cursor: number | null = null;
        let fetched = 0;
        for (let page = 1; page <= maxPages; page++) {
          const baseUrl = `https://api.bilibili.com/x/v2/reply/main?oid=${aid}&type=1&mode=${mode}&ps=50`;
          const url = cursor != null ? `${baseUrl}&next=${cursor}` : baseUrl;
          diag.push(`comment_m${mode}_p${page}=${fetchedIds.size}total`);

          const resp = await fetch(url, {
            headers: { Referer: 'https://www.bilibili.com/' },
          });
          if (!resp.ok) {
            diag.push(`comment_m${mode}_p${page}_status=${resp.status}`);
            break;
          }
          const json = await resp.json();
          if (json.code !== 0) {
            diag.push(`comment_m${mode}_p${page}_code=${json.code}`);
            break;
          }

          const replies = json?.data?.replies || [];
          diag.push(`comment_m${mode}_p${page}_count=${replies.length}`);
          if (replies.length === 0) break; // 无更多数据，停止此 mode
          for (const r of replies) {
            const rpid = r.rpid_str || String(r.rpid);
            if (fetchedIds.has(rpid)) continue;
            fetchedIds.add(rpid);
            comments.push({
              author: r.member?.uname || '未知',
              content: r.content?.message || '',
              likes: r.like || 0,
              time: new Date((r.ctime || 0) * 1000).toISOString().split('T')[0],
              replies: (r.replies || []).map((rr: any) => ({
                author: rr.member?.uname || '',
                content: rr.content?.message || '',
                likes: rr.like || 0,
                time: '',
              })),
            });
            fetched++;
          }

          // 如果已收集足够或没有更多页，停止此 mode
          if (comments.length >= targetCount) break;

          const nextCursor = json?.data?.cursor?.next;
          if (nextCursor == null) break;
          cursor = nextCursor;
        }
        return fetched;
      };

      // 先抓首选 mode，不够再抓备选 mode
      await fetchMode(preferredMode);
      if (comments.length < targetCount) {
        await fetchMode(alternateMode);
      }

      diag.push(`comment_total=${comments.length}`);
    } else {
      diag.push('aid_not_found_all_sources');
    }
  } catch (e) {
    diag.push(`comment_err=${(e as Error).message}`);
  }

  const metadata: Record<string, unknown> = {};
  const stat = videoData?.stat;
  if (stat) {
    if (stat.view) metadata.views = stat.view;
    if (stat.like) metadata.likes = stat.like;
    if (stat.favorite) metadata.favorites = stat.favorite;
  }

  metadata._diag = diag.join(' | ');

  return {
    platform: 'bilibili',
    type: 'video',
    url,
    title,
    author,
    publishDate,
    description,
    mediaUrls,
    comments,
    metadata,
  };
}
