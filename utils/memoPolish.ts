/**
 * memoPolish — 备忘录专用副 API 润色。
 *
 * 角色通过工具调用 create_memo / update_memo 时，原始 content 可能是口语化的、
 * 超长的、缺标签的（比如「下周二记得给小白送生日礼物」）。副 API 负责把它整理成：
 * - ≤60 字的规范内容
 * - 推断类型（daily / todo）
 * - 推断标签（如「生日」「礼物」）
 *
 * 副 API 配置独立于主 apiConfig / 记忆宫殿副 API / 情绪副 API：
 * - 不配（baseUrl 空）→ 直接用原始 content 截断，不报错
 * - 配了但请求失败 → 回退到原始 content，记 warn 日志
 *
 * 设计要点：
 * - 超时 8 秒：副 API 卡住不该阻塞主聊天流程
 * - 温度 0.3：润色要稳定，不要每次都不一样
 * - max_tokens 300：60 字内容 + 类型 + 标签足够
 */
import { MemoApiConfig, MemoType } from '../types';
import { MEMO_CONTENT_MAX } from './memoInjection';

const POLISH_TIMEOUT_MS = 8000;

export interface MemoPolishInput {
    raw: string;          // 原始内容（Char 说的或用户输入的）
    type?: MemoType;      // 指定类型（未指定时由副 API 推断）
    tags?: string[];      // 指定标签（未指定时由副 API 推断）
}

export interface MemoPolishResult {
    content: string;      // 润色后内容（≤60 字）
    type: MemoType;       // 类型
    tags: string[];       // 标签
    polished: boolean;    // 是否真的调了副 API（false=回退原始）
}

const POLISH_SYSTEM_PROMPT = `你是一个备忘录润色助手。用户会给你一段原始意图，你要整理成规范的备忘录内容。

输出严格的 JSON，不要任何额外文字：
{
  "content": "不超过${MEMO_CONTENT_MAX}字的精炼内容",
  "type": "daily 或 todo",
  "tags": ["标签1", "标签2"]
}

规则：
1. content 必须 ≤${MEMO_CONTENT_MAX}字，保留关键信息（时间/对象/动作），去掉口语化废话
2. type：有明确待办动作（记得/要做/买/送/还/打电话）→ todo；否则 → daily
3. tags：提取关键实体（人名/事件/物品），最多 3 个，不要造词
4. 用户指定了 type/tags 时，优先用用户指定的
5. 不要输出 JSON 以外的任何内容`;

/** 把原始内容截断 + 去空白，作为副 API 不可用时的回退 */
const sanitize = (raw: string, type: MemoType, tags: string[]): MemoPolishResult => {
    const content = (raw || '').trim().slice(0, MEMO_CONTENT_MAX);
    return { content, type, tags: tags.slice(0, 3), polished: false };
};

export const polishMemo = async (
    api: MemoApiConfig,
    input: MemoPolishInput,
): Promise<MemoPolishResult> => {
    const fallbackType: MemoType = input.type || 'daily';
    const fallback = sanitize(input.raw, fallbackType, input.tags || []);

    const baseUrl = String(api.baseUrl || '').trim().replace(/\/+$/, '');
    if (!baseUrl) return fallback; // 副 API 没配，直接用原始

    const userPrompt = `原始意图：${input.raw}${input.type ? `\n指定类型：${input.type}` : ''}${input.tags?.length ? `\n指定标签：${input.tags.join('、')}` : ''}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POLISH_TIMEOUT_MS);
    try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${api.apiKey || 'sk-none'}`,
            },
            body: JSON.stringify({
                model: api.model,
                messages: [
                    { role: 'system', content: POLISH_SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.3,
                max_tokens: 300,
                stream: false,
            }),
            signal: controller.signal,
        });
        if (!res.ok) {
            console.warn('[memo-polish] 副 API 返回非 2xx', res.status);
            return fallback;
        }
        const data = await res.json();
        const text: string = data?.choices?.[0]?.message?.content || '';
        // 提取 JSON（兼容 ```json 包裹和裸 JSON）
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
            console.warn('[memo-polish] 副 API 响应没找到 JSON', text.slice(0, 100));
            return fallback;
        }
        const parsed = JSON.parse(match[0]);
        const content = String(parsed.content || '').trim().slice(0, MEMO_CONTENT_MAX);
        if (!content) return fallback;
        const type: MemoType = parsed.type === 'todo' ? 'todo' : 'daily';
        const tags: string[] = Array.isArray(parsed.tags)
            ? parsed.tags.slice(0, 3).map((t: unknown) => String(t).trim()).filter(Boolean)
            : [];
        // 用户指定了 type/tags 时优先用用户的
        return {
            content,
            type: input.type || type,
            tags: input.tags?.length ? input.tags.slice(0, 3) : tags,
            polished: true,
        };
    } catch (err) {
        console.warn('[memo-polish] 润色失败，回退原始内容', err);
        return fallback;
    } finally {
        clearTimeout(timer);
    }
};
