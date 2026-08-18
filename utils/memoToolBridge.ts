/**
 * memoToolBridge — 把备忘录的增删改查暴露为 OpenAI function-calling 工具，
 * 让角色在私聊中直接管理备忘（"帮我记一下下周二送礼物"→ LLM 调 create_memo）。
 *
 * 工具定义注入 useChatAI 的 tools 数组；执行器在工具循环里分发。
 *
 * 防打转：create/update/delete/toggle 都是 mutating 工具，同一轮里同名同参第二次
 * 直接打回（复用 agenticToolFeedback 的指纹机制）。list 不拦——排完再查清单
 * 本来就该变，拦掉的话角色拿到的是过时数据。
 *
 * 上限保护：create 时检查 MEMO_MAX=10，超了返回错误让角色先删一条再建。
 *
 * 副 API 润色：create/update 时调 polishMemo 整理 content（副 API 没配就回退原始）。
 *
 * 用户提示：mutating 工具跑成功后通过 deps.addToast 给用户弹 toast（"角色建了一条备忘"）。
 */
import { CharacterProfile, Memo, MemoApiConfig, MemoType } from '../types';
import { DB } from './db';
import { MEMO_CONTENT_MAX, MEMO_MAX } from './memoInjection';
import { polishMemo } from './memoPolish';
import { buildDuplicateToolMessage, toolCallFingerprint, type ToolCallRecord } from './agenticToolFeedback';

// ─── OpenAI tools schema ───

interface OpenAITool {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, any> };
}

export const MEMO_TOOLS: OpenAITool[] = [
    {
        type: 'function',
        function: {
            name: 'list_memos',
            description: '查看你当前的备忘录列表（日常备忘 + 待办）。返回每条的序号、内容、类型、标签、完成状态、最后修改时间。超过 10 条上限时也用它看清单决定删哪条。',
            parameters: { type: 'object', properties: {} },
        },
    },
    {
        type: 'function',
        function: {
            name: 'create_memo',
            description: `新建一条备忘。说出想记的事，系统会自动整理成≤${MEMO_CONTENT_MAX}字规范内容并推断类型和标签。上限 ${MEMO_MAX} 条，超了必须先删一条。类型：daily=日常备忘（默认）/ todo=待办。`,
            parameters: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: '想记的事，口语化也行，系统会润色。' },
                    type: { type: 'string', enum: ['daily', 'todo'], description: '类型。daily=日常备忘，todo=待办。不传由系统推断。' },
                    tags: { type: 'array', items: { type: 'string' }, description: '标签（可选，最多 3 个）。不传由系统推断。' },
                },
                required: ['content'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'update_memo',
            description: `修改第 idx 条备忘（idx 从 1 开始，对应 list_memos 返回的序号）。可改内容/类型/标签，未传的字段保持不变。内容会被润色成≤${MEMO_CONTENT_MAX}字。`,
            parameters: {
                type: 'object',
                properties: {
                    idx: { type: 'integer', description: '要修改的备忘序号（从 1 开始）' },
                    content: { type: 'string', description: '新内容（可选，不传则不改）' },
                    type: { type: 'string', enum: ['daily', 'todo'], description: '新类型（可选）' },
                    tags: { type: 'array', items: { type: 'string' }, description: '新标签（可选，传了会整体覆盖旧标签）' },
                },
                required: ['idx'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'delete_memo',
            description: '删除第 idx 条备忘（idx 从 1 开始）。移入回收站，18 天内可恢复。',
            parameters: {
                type: 'object',
                properties: {
                    idx: { type: 'integer', description: '要删除的备忘序号（从 1 开始）' },
                },
                required: ['idx'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'toggle_todo',
            description: '切换第 idx 条待办的完成状态（已完成 ↔ 未完成）。仅对 todo 类型有效。',
            parameters: {
                type: 'object',
                properties: {
                    idx: { type: 'integer', description: '要切换的待办序号（从 1 开始）' },
                },
                required: ['idx'],
            },
        },
    },
];

export const MEMO_TOOL_NAMES = new Set(MEMO_TOOLS.map((t) => t.function.name));

// 改动任务清单的工具：跑一次就真改了 DB，所以要防打转。
// list 不在里面——同一轮里排完再查，清单本来就该变。
const MUTATING_TOOLS = new Set(['create_memo', 'update_memo', 'delete_memo', 'toggle_todo']);

// 每次工具跑完都补的收尾话（软的那层，硬的那层是下面的指纹拦截）。
// 跟 amsg2ToolBridge 同一套口径，见 utils/agenticToolFeedback.ts。
const TOOL_FOLLOW_UP = [
    '[系统: 这一次调用已经处理完了，结果就在上面。同样的调用不要再来一遍——',
    '现在把要对用户说的话写出来。前面已经说出去的内容不要重写，接着往下写就行。]',
].join('\n');

// ─── 执行器依赖 ───

export interface MemoToolDeps {
    char: CharacterProfile;
    memoApiConfig: MemoApiConfig;   // 副 API（润色用，没配就回退原始）
    /** 本轮已经真跑过的调用（同名同参）。executeMemoTool 自己维护，调用方只管传下去。 */
    seenCalls: ToolCallRecord[];
    /** 用户侧 toast 提示（mutating 工具跑成功后弹一下，让用户知道角色动了备忘） */
    addToast?: (msg: string, kind?: 'info' | 'success' | 'error') => void;
}

export const executeMemoTool = async (
    toolName: string,
    args: Record<string, any>,
    deps: MemoToolDeps,
): Promise<string> => {
    const mutating = MUTATING_TOOLS.has(toolName);
    const fingerprint = mutating ? toolCallFingerprint(toolName, args) : '';
    if (mutating && deps.seenCalls.some((r) => r.fingerprint === fingerprint)) {
        return buildDuplicateToolMessage(toolName);
    }
    try {
        const result = await (() => {
            switch (toolName) {
                case 'list_memos': return handleList(deps);
                case 'create_memo': return handleCreate(args, deps);
                case 'update_memo': return handleUpdate(args, deps);
                case 'delete_memo': return handleDelete(args, deps);
                case 'toggle_todo': return handleToggle(args, deps);
                default: return Promise.resolve(`未知工具 ${toolName}。`);
            }
        })();
        if (mutating) deps.seenCalls.push({ name: toolName, fingerprint });
        return mutating ? `${result}\n${TOOL_FOLLOW_UP}` : result;
    } catch (e: any) {
        return `操作失败：${e?.message || String(e)}`;
    }
};

// ─── handlers ───

const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const formatMemoLine = (m: Memo, i: number): string => {
    const typeLabel = m.type === 'todo' ? '待办' : '备忘';
    const doneLabel = m.type === 'todo' ? (m.done ? '✓已完成' : '□未完成') : '';
    const tagsLabel = m.tags.length > 0 ? ` #${m.tags.join(' #')}` : '';
    return `${i + 1}. [${typeLabel}]${doneLabel ? ` ${doneLabel}` : ''}${tagsLabel} ${m.content}（修改于 ${formatTime(m.updatedAt)}）`;
};

async function handleList(deps: MemoToolDeps): Promise<string> {
    const memos = await DB.getMemosByCharId(deps.char.id);
    if (memos.length === 0) return `你的备忘录是空的（${0}/${MEMO_MAX}）。`;
    const lines = memos.map(formatMemoLine);
    return `你有 ${memos.length}/${MEMO_MAX} 条备忘：\n${lines.join('\n')}`;
}

async function handleCreate(args: Record<string, any>, deps: MemoToolDeps): Promise<string> {
    const raw = String(args.content || '').trim();
    if (!raw) return '创建失败：content 不能为空。';

    const existing = await DB.getMemosByCharId(deps.char.id);
    if (existing.length >= MEMO_MAX) {
        return `创建失败：备忘已满（${existing.length}/${MEMO_MAX}）。请先用 delete_memo 删掉一条再建。当前清单：\n${existing.map(formatMemoLine).join('\n')}`;
    }

    // 副 API 润色（没配就回退原始截断）
    const polished = await polishMemo(deps.memoApiConfig, {
        raw,
        type: args.type as MemoType | undefined,
        tags: Array.isArray(args.tags) ? args.tags.map(String) : undefined,
    });

    const now = Date.now();
    const memo: Memo = {
        id: `memo_${now}_${Math.random().toString(36).slice(2, 8)}`,
        charId: deps.char.id,
        type: polished.type,
        content: polished.content,
        tags: polished.tags,
        done: false,
        createdAt: now,
        updatedAt: now,
    };
    await DB.saveMemo(memo);

    // 用户侧提示（图3变更动态：📝角色名 更新了备忘录 · [创建] 内容预览）
    const preview = memo.content.length > 24 ? `${memo.content.slice(0, 24)}…` : memo.content;
    deps.addToast?.(`📝 ${deps.char.name} 更新了备忘录 · [创建] ${preview}`, 'success');

    return `已创建：${formatMemoLine(memo, 0).replace(/^1\.\s/, '')}\n当前 ${existing.length + 1}/${MEMO_MAX} 条。`;
}

async function handleUpdate(args: Record<string, any>, deps: MemoToolDeps): Promise<string> {
    const idx = Number(args.idx);
    if (!Number.isInteger(idx) || idx < 1) return '修改失败：idx 必须是正整数。';

    const memos = await DB.getMemosByCharId(deps.char.id);
    if (idx > memos.length) return `修改失败：序号 ${idx} 不存在（当前共 ${memos.length} 条）。`;

    const target = memos[idx - 1];
    const hasNewContent = typeof args.content === 'string' && args.content.trim().length > 0;
    const hasNewType = args.type === 'daily' || args.type === 'todo';
    const hasNewTags = Array.isArray(args.tags);

    if (!hasNewContent && !hasNewType && !hasNewTags) {
        return '修改失败：至少要传 content / type / tags 中的一个。';
    }

    // 副 API 仅在改 content 时润色
    let newContent = target.content;
    let newTags = target.tags;
    if (hasNewContent) {
        const polished = await polishMemo(deps.memoApiConfig, {
            raw: String(args.content),
            type: hasNewType ? args.type : target.type,
            tags: hasNewTags ? args.tags.map(String) : target.tags,
        });
        newContent = polished.content;
        if (!hasNewTags) newTags = polished.tags; // 副 API 推断的标签
    }
    if (hasNewTags) newTags = args.tags.map(String).slice(0, 3);

    const updated: Memo = {
        ...target,
        content: newContent,
        type: hasNewType ? args.type : target.type,
        tags: newTags,
        updatedAt: Date.now(),
    };
    await DB.saveMemo(updated);

    // 用户侧提示（图3变更动态：[修改] 内容预览，引用样式）
    const preview = updated.content.length > 24 ? `${updated.content.slice(0, 24)}…` : updated.content;
    deps.addToast?.(`📝 ${deps.char.name} 更新了备忘录 · [修改] ${preview}`, 'info');

    return `已修改：${formatMemoLine(updated, idx - 1).replace(/^\d+\.\s/, '')}`;
}

async function handleDelete(args: Record<string, any>, deps: MemoToolDeps): Promise<string> {
    const idx = Number(args.idx);
    if (!Number.isInteger(idx) || idx < 1) return '删除失败：idx 必须是正整数。';

    const memos = await DB.getMemosByCharId(deps.char.id);
    if (idx > memos.length) return `删除失败：序号 ${idx} 不存在（当前共 ${memos.length} 条）。`;

    const target = memos[idx - 1];
    await DB.softDeleteMemo(target.id);

    // 用户侧提示（图3变更动态：[删除] 内容预览）
    const preview = target.content.length > 24 ? `${target.content.slice(0, 24)}…` : target.content;
    deps.addToast?.(`📝 ${deps.char.name} 更新了备忘录 · [删除] ${preview}（已进回收站，18 天内可恢复）`, 'info');

    return `已删除第 ${idx} 条「${target.content}」（移入回收站，18 天内可恢复）。`;
}

async function handleToggle(args: Record<string, any>, deps: MemoToolDeps): Promise<string> {
    const idx = Number(args.idx);
    if (!Number.isInteger(idx) || idx < 1) return '切换失败：idx 必须是正整数。';

    const memos = await DB.getMemosByCharId(deps.char.id);
    if (idx > memos.length) return `切换失败：序号 ${idx} 不存在（当前共 ${memos.length} 条）。`;

    const target = memos[idx - 1];
    if (target.type !== 'todo') return `第 ${idx} 条不是待办，无法切换完成状态（它是「日常备忘」）。`;

    const updated: Memo = { ...target, done: !target.done, updatedAt: Date.now() };
    await DB.saveMemo(updated);

    // 用户侧提示（图3变更动态：[完成]/[重置] 待办预览）
    const preview = updated.content.length > 24 ? `${updated.content.slice(0, 24)}…` : updated.content;
    deps.addToast?.(`📝 ${deps.char.name} 更新了备忘录 · [${updated.done ? '完成' : '重置'}] ${preview}`, 'info');

    return `已标记第 ${idx} 条「${target.content}」为${updated.done ? '已完成 ✓' : '未完成 □'}。`;
}
