/**
 * memoInjection — 把角色的备忘录注入 system prompt。
 *
 * 三种场景，注入内容不同：
 *
 * | 场景              | 入参标记         | 注入内容                                  |
 * |-------------------|------------------|------------------------------------------|
 * | 私聊（前台聊天）   | 默认              | 备忘列表 + 工具说明（Char 能增删改）       |
 * | fire_pack 主动消息 | forFirePack=true | 仅列表（后台不该操作备忘）                  |
 * | 角色未勾选启用     | memoEnabled≠true | 空串（不注入）                              |
 *
 * 门控规则（两者都为 true 才注入）：
 * 1. OSContext.memoGlobalEnabled（全局开关，默认 false）
 * 2. char.memoEnabled === true（per-char 勾选）
 *
 * 第 1 条由调用方（useChatAI）在注入工具前先判断，buildMemoInjection 这里只看第 2 条。
 * 因为 fire_pack 路径不走 useChatAI，它直接调 chatPrompts，所以门控要内化进来：
 * 否则 fire_pack 会在全局开关没开时也注入列表（污染后台 prompt）。
 */
import { CharacterProfile, Memo } from '../types';
import { DB } from './db';

export const MEMO_MAX = 10;
export const MEMO_CONTENT_MAX = 60;

export const buildMemoInjection = async (
    char: CharacterProfile,
    opts: { forFirePack?: boolean } = {},
): Promise<string> => {
    // 门控：角色没勾选启用 → 不注入（全局开关由调用方在外层把关）
    if (char.memoEnabled !== true) return '';

    const memos = await DB.getMemosByCharId(char.id);
    if (memos.length === 0) return ''; // 空列表不污染 prompt

    const lines = memos.map((m: Memo, i: number) => {
        const typeLabel = m.type === 'todo' ? '待办' : '备忘';
        const doneLabel = m.type === 'todo' ? (m.done ? '✓已完成' : '□未完成') : '';
        const tagsLabel = m.tags.length > 0 ? ` #${m.tags.join(' #')}` : '';
        return `${i + 1}. [${typeLabel}]${doneLabel ? ` ${doneLabel}` : ''}${tagsLabel} ${m.content}`;
    });

    const listBlock = `### 你的备忘录\n你当前有 ${memos.length}/${MEMO_MAX} 条备忘：\n${lines.join('\n')}`;

    // fire_pack 路径不注入工具说明：后台生成不该操作备忘（没用户交互、容易空转打转）
    if (opts.forFirePack) {
        return `\n${listBlock}\n`;
    }

    return `\n${listBlock}\n\n你可以通过以下工具管理备忘录（用户主动让你记/改/删时调用）：\n- create_memo(content, type?, tags?)：新建备忘（说出想记的事，系统自动整理成≤${MEMO_CONTENT_MAX}字规范内容+推断类型标签）\n- list_memos()：查看完整列表（超${MEMO_MAX}条上限时用它决定删哪条）\n- update_memo(idx, content?/type?/tags?)：修改第 idx 条\n- delete_memo(idx)：删除第 idx 条（移入回收站，18天内可恢复）\n- toggle_todo(idx)：标记待办完成/未完成\n\n注意：备忘是你的私人记事本，只记你自己的事，不要替用户记事。不需要每轮都提备忘，自然地融入对话即可。\n`;
};
