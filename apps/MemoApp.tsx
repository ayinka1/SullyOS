import React, { useEffect, useState, useCallback } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Memo, DeletedMemo, MemoType, MemoApiConfig, CharacterProfile } from '../types';
import { MEMO_MAX, MEMO_CONTENT_MAX } from '../utils/memoInjection';
import { polishMemo } from '../utils/memoPolish';
import Modal from '../components/os/Modal';
import { ArrowLeft, Plus, Trash, PencilSimple, Check, ArrowsClockwise, WarningCircle, Gear, NotePencil, Checks } from '@phosphor-icons/react';

type View = 'home' | 'list' | 'trash';

const MemoApp: React.FC = () => {
    const { closeApp, characters, addToast, memoGlobalEnabled, updateMemoGlobalEnabled, memoApiConfig, updateMemoApiConfig, updateCharacter } = useOS();

    const [view, setView] = useState<View>('home');
    const [activeCharId, setActiveCharId] = useState<string | null>(null);
    const [charMemos, setCharMemos] = useState<Memo[]>([]);
    const [deletedMemos, setDeletedMemos] = useState<DeletedMemo[]>([]);

    // 新建 / 编辑
    const [creating, setCreating] = useState(false);
    const [editingMemo, setEditingMemo] = useState<Memo | null>(null);

    // 副 API 设置 Modal
    const [showApiModal, setShowApiModal] = useState(false);

    // 删除确认 / 彻底删除确认
    const [deleteTarget, setDeleteTarget] = useState<Memo | null>(null);
    const [purgeTarget, setPurgeTarget] = useState<DeletedMemo | null>(null);

    // 启动时清一次过期回收站
    useEffect(() => {
        DB.purgeExpiredDeletedMemos().then((n) => {
            if (n > 0) addToast(`已自动清理 ${n} 条过期回收站备忘`, 'info');
        }).catch(() => { /* ignore */ });
    }, [addToast]);

    const loadCharMemos = useCallback(async (charId: string) => {
        const [memos, deleted] = await Promise.all([
            DB.getMemosByCharId(charId),
            DB.getDeletedMemosByCharId(charId),
        ]);
        setCharMemos(memos);
        setDeletedMemos(deleted);
    }, []);

    useEffect(() => {
        if (activeCharId) loadCharMemos(activeCharId);
    }, [activeCharId, loadCharMemos]);

    const activeChar = characters.find((c) => c.id === activeCharId) || null;

    const handleEnterChar = (charId: string) => {
        setActiveCharId(charId);
        setView('list');
    };

    const handleToggleCharEnabled = (charId: string, enabled: boolean) => {
        updateCharacter(charId, { memoEnabled: enabled });
        addToast(enabled ? '已为该角色启用备忘录' : '已为该角色关闭备忘录', 'success');
    };

    const handleSaveMemo = async (memo: Memo) => {
        await DB.saveMemo(memo);
        if (activeCharId) await loadCharMemos(activeCharId);
        addToast(editingMemo ? '备忘已修改' : '备忘已创建', 'success');
        setCreating(false);
        setEditingMemo(null);
    };

    const handleDeleteMemo = async () => {
        if (!deleteTarget) return;
        await DB.softDeleteMemo(deleteTarget.id);
        if (activeCharId) await loadCharMemos(activeCharId);
        addToast('已移入回收站（18 天内可恢复）', 'info');
        setDeleteTarget(null);
    };

    const handleRestore = async (id: string) => {
        // 恢复前检查上限
        if (activeCharId) {
            const current = await DB.getMemosByCharId(activeCharId);
            if (current.length >= MEMO_MAX) {
                addToast(`备忘已满（${MEMO_MAX} 条），无法恢复`, 'error');
                return;
            }
        }
        await DB.restoreMemo(id);
        if (activeCharId) await loadCharMemos(activeCharId);
        addToast('已恢复', 'success');
    };

    const handlePurge = async () => {
        if (!purgeTarget) return;
        await DB.purgeDeletedMemo(purgeTarget.id);
        if (activeCharId) await loadCharMemos(activeCharId);
        addToast('已彻底删除', 'info');
        setPurgeTarget(null);
    };

    const handleToggleTodo = async (memo: Memo) => {
        if (memo.type !== 'todo') return;
        const updated: Memo = { ...memo, done: !memo.done, updatedAt: Date.now() };
        await DB.saveMemo(updated);
        if (activeCharId) await loadCharMemos(activeCharId);
    };

    const formatDate = (ts: number) => {
        const d = new Date(ts);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden bg-gradient-to-b from-cyan-50 to-slate-50">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-2 shrink-0" style={{ paddingTop: 'max(2rem, var(--safe-top))' }}>
                <div className="flex items-center gap-2">
                    {view !== 'home' && (
                        <button
                            onClick={() => setView(view === 'trash' ? 'list' : 'home')}
                            className="p-2 -ml-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-600" weight="bold" />
                        </button>
                    )}
                    <h1 className="text-lg font-medium text-slate-700">
                        {view === 'home' ? '备忘录' : view === 'list' ? (activeChar?.name || '备忘') : '回收站'}
                    </h1>
                </div>
                <div className="flex items-center gap-1">
                    {view === 'list' && activeChar && (
                        <>
                            <button
                                onClick={() => setView('trash')}
                                className="p-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                                title="回收站"
                            >
                                <Trash className="w-5 h-5 text-slate-500" weight="regular" />
                            </button>
                            <button
                                onClick={() => setCreating(true)}
                                disabled={charMemos.length >= MEMO_MAX}
                                className="p-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform disabled:opacity-30"
                                title={charMemos.length >= MEMO_MAX ? `已达上限 ${MEMO_MAX} 条` : '新建'}
                            >
                                <Plus className="w-5 h-5 text-cyan-600" weight="bold" />
                            </button>
                        </>
                    )}
                    {view === 'home' && (
                        <button
                            onClick={() => setShowApiModal(true)}
                            className="p-2 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                            title="副 API 设置"
                        >
                            <Gear className="w-5 h-5 text-slate-500" weight="regular" />
                        </button>
                    )}
                </div>
            </div>

            {/* 主页 */}
            {view === 'home' && (
                <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-8 space-y-3">
                    {/* 全局开关 */}
                    <div className="bg-white/80 rounded-2xl p-4 shadow-sm border border-white/60">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-sm font-medium text-slate-700">全局启用备忘录</div>
                                <div className="text-xs text-slate-500 mt-0.5">关闭后所有角色的备忘录功能停止注入</div>
                            </div>
                            <button
                                onClick={() => updateMemoGlobalEnabled(!memoGlobalEnabled)}
                                className={`relative w-12 h-7 rounded-full transition-colors ${memoGlobalEnabled ? 'bg-cyan-500' : 'bg-slate-300'}`}
                            >
                                <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${memoGlobalEnabled ? 'translate-x-5' : ''}`} />
                            </button>
                        </div>
                        {!memoGlobalEnabled && (
                            <div className="mt-3 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                                全局开关已关闭。即使某角色单独勾选了启用，也不会生效。
                            </div>
                        )}
                    </div>

                    {/* 角色列表 */}
                    <div className="space-y-2">
                        <div className="text-xs text-slate-500 px-2">角色列表（点击进入查看 / 管理）</div>
                        {characters.length === 0 ? (
                            <div className="text-center text-sm text-slate-400 py-12">还没有角色，请先去「神经链接」创建</div>
                        ) : (
                            characters.map((char) => {
                                const enabled = char.memoEnabled === true;
                                return (
                                    <div key={char.id} className="bg-white/80 rounded-2xl p-3 shadow-sm border border-white/60">
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => handleEnterChar(char.id)}
                                                className="flex-1 flex items-center gap-3 text-left"
                                            >
                                                {char.avatar ? (
                                                    <img src={char.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-600 font-bold">
                                                        {char.name.charAt(0)}
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-sm font-medium text-slate-700 truncate">{char.name}</div>
                                                    <CharMemoCount charId={char.id} />
                                                </div>
                                            </button>
                                            <button
                                                onClick={() => handleToggleCharEnabled(char.id, !enabled)}
                                                className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${enabled && memoGlobalEnabled ? 'bg-cyan-500' : 'bg-slate-300'}`}
                                                title={enabled ? '已启用' : '未启用'}
                                            >
                                                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled && memoGlobalEnabled ? 'translate-x-4' : ''}`} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}

            {/* 备忘列表页 */}
            {view === 'list' && activeChar && (
                <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-8 space-y-2">
                    {charMemos.length === 0 ? (
                        <div className="text-center text-sm text-slate-400 py-16">
                            <NotePencil className="w-10 h-10 mx-auto mb-3 opacity-30" weight="regular" />
                            <div>还没有备忘</div>
                            <div className="text-xs mt-1">点右上角 + 新建，或在私聊里让 {activeChar.name} 帮你记</div>
                        </div>
                    ) : (
                        <>
                            <div className="text-xs text-slate-500 px-2 pb-1">
                                {charMemos.length}/{MEMO_MAX} 条 · 按修改时间倒序
                                {charMemos.length >= MEMO_MAX && <span className="text-amber-600 ml-1">（已满，需删旧才能新建）</span>}
                            </div>
                            {charMemos.map((memo, idx) => (
                                <MemoCard
                                    key={memo.id}
                                    memo={memo}
                                    index={idx}
                                    formatDate={formatDate}
                                    onToggleTodo={() => handleToggleTodo(memo)}
                                    onEdit={() => setEditingMemo(memo)}
                                    onDelete={() => setDeleteTarget(memo)}
                                />
                            ))}
                        </>
                    )}
                </div>
            )}

            {/* 回收站 */}
            {view === 'trash' && (
                <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-8 space-y-2">
                    <div className="text-xs text-slate-500 px-2 pb-1">
                        回收站 · 18 天后彻底删除
                        {deletedMemos.length > 0 && <span className="ml-1">（共 {deletedMemos.length} 条）</span>}
                    </div>
                    {deletedMemos.length === 0 ? (
                        <div className="text-center text-sm text-slate-400 py-16">
                            <Trash className="w-10 h-10 mx-auto mb-3 opacity-30" weight="regular" />
                            <div>回收站是空的</div>
                        </div>
                    ) : (
                        deletedMemos.map((dm) => {
                            const daysLeft = Math.max(0, 18 - Math.floor((Date.now() - dm.deletedAt) / (24 * 60 * 60 * 1000)));
                            return (
                                <div key={dm.id} className="bg-white/60 rounded-2xl p-3 border border-white/50">
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <div className="flex items-center gap-1.5 text-[10px]">
                                            <span className={`px-1.5 py-0.5 rounded font-medium ${dm.type === 'todo' ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'}`}>
                                                {dm.type === 'todo' ? '待办' : '备忘'}
                                            </span>
                                            {dm.tags.map((t, i) => (
                                                <span key={i} className="text-slate-400">#{t}</span>
                                            ))}
                                        </div>
                                        <span className="text-[10px] text-slate-400 shrink-0">剩 {daysLeft} 天</span>
                                    </div>
                                    <div className={`text-sm text-slate-600 mb-2 ${dm.type === 'todo' && dm.done ? 'line-through opacity-60' : ''}`}>
                                        {dm.content}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleRestore(dm.id)}
                                            className="flex-1 py-1.5 text-xs bg-cyan-50 text-cyan-700 rounded-lg font-medium hover:bg-cyan-100"
                                        >
                                            恢复
                                        </button>
                                        <button
                                            onClick={() => setPurgeTarget(dm)}
                                            className="flex-1 py-1.5 text-xs bg-red-50 text-red-600 rounded-lg font-medium hover:bg-red-100"
                                        >
                                            彻底删除
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {/* 新建 / 编辑备忘 Sheet */}
            {(creating || editingMemo) && (
                <MemoEditSheet
                    memo={editingMemo}
                    onClose={() => { setCreating(false); setEditingMemo(null); }}
                    onSave={handleSaveMemo}
                    memoApiConfig={memoApiConfig}
                    addToast={addToast}
                />
            )}

            {/* 副 API 设置 Modal */}
            {showApiModal && (
                <MemoApiModal
                    config={memoApiConfig}
                    onClose={() => setShowApiModal(false)}
                    onSave={(cfg) => { updateMemoApiConfig(cfg); addToast('副 API 已保存', 'success'); setShowApiModal(false); }}
                />
            )}

            {/* 删除确认 */}
            <Modal
                isOpen={!!deleteTarget}
                title="移入回收站"
                onClose={() => setDeleteTarget(null)}
                footer={
                    <div className="flex gap-2 w-full">
                        <button onClick={() => setDeleteTarget(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold">取消</button>
                        <button onClick={handleDeleteMemo} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold">移入</button>
                    </div>
                }
            >
                <p className="text-sm text-slate-600">确定把「{deleteTarget?.content}」移入回收站吗？18 天后彻底删除，期间可恢复。</p>
            </Modal>

            {/* 彻底删除确认 */}
            <Modal
                isOpen={!!purgeTarget}
                title="彻底删除"
                onClose={() => setPurgeTarget(null)}
                footer={
                    <div className="flex gap-2 w-full">
                        <button onClick={() => setPurgeTarget(null)} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold">取消</button>
                        <button onClick={handlePurge} className="flex-1 py-3 bg-red-500 text-white rounded-2xl font-bold">彻底删除</button>
                    </div>
                }
            >
                <div className="flex flex-col items-center gap-3 py-2">
                    <WarningCircle className="w-8 h-8 text-red-400" weight="bold" />
                    <p className="text-sm text-slate-600 text-center">彻底删除后不可恢复，确定吗？</p>
                </div>
            </Modal>
        </div>
    );
};

// ─── 子组件 ───

/** 角色行显示的备忘数 + 最后修改时间（懒查，不阻塞主页渲染） */
const CharMemoCount: React.FC<{ charId: string }> = ({ charId }) => {
    const [info, setInfo] = useState<{ count: number; lastUpdate: number | null } | null>(null);
    useEffect(() => {
        DB.getMemosByCharId(charId).then((memos) => {
            setInfo({
                count: memos.length,
                lastUpdate: memos.length > 0 ? memos[0].updatedAt : null,
            });
        }).catch(() => setInfo({ count: 0, lastUpdate: null }));
    }, [charId]);
    if (!info) return <div className="text-xs text-slate-400">加载中…</div>;
    return (
        <div className="text-xs text-slate-400">
            {info.count}/{MEMO_MAX} 条
            {info.lastUpdate && <span className="ml-2">最近 {formatTimeShort(info.lastUpdate)}</span>}
        </div>
    );
};

const formatTimeShort = (ts: number): string => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - ts;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24 && d.getDate() === now.getDate()) return `${diffHour} 小时前`;
    return `${d.getMonth() + 1}-${d.getDate()}`;
};

/** 单条备忘卡片 */
const MemoCard: React.FC<{
    memo: Memo;
    index: number;
    formatDate: (ts: number) => string;
    onToggleTodo: () => void;
    onEdit: () => void;
    onDelete: () => void;
}> = ({ memo, index, formatDate, onToggleTodo, onEdit, onDelete }) => {
    return (
        <div className="bg-white/90 rounded-2xl p-3 shadow-sm border border-white/60">
            {/* 顶部：序号 + 标签 */}
            <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-slate-400">#{index + 1}</span>
                    <span className={`px-1.5 py-0.5 rounded font-medium ${memo.type === 'todo' ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'}`}>
                        {memo.type === 'todo' ? '待办' : '备忘'}
                    </span>
                    {memo.tags.map((t, i) => (
                        <span key={i} className="text-slate-400">#{t}</span>
                    ))}
                </div>
                {memo.type === 'todo' && (
                    <button
                        onClick={onToggleTodo}
                        className={`p-1 rounded-full ${memo.done ? 'text-emerald-500' : 'text-slate-300'} hover:bg-black/5`}
                        title={memo.done ? '标记为未完成' : '标记为已完成'}
                    >
                        {memo.done ? <Checks className="w-4 h-4" weight="bold" /> : <Check className="w-4 h-4" weight="bold" />}
                    </button>
                )}
            </div>
            {/* 中间：内容 */}
            <div className={`text-sm text-slate-700 mb-2 ${memo.type === 'todo' && memo.done ? 'line-through opacity-50' : ''}`}>
                {memo.content}
            </div>
            {/* 底部：时间 + 操作 */}
            <div className="flex items-center justify-between">
                <div className="text-[10px] text-slate-400">
                    <div>创建：{formatDate(memo.createdAt)}</div>
                    <div>修改：{formatDate(memo.updatedAt)}</div>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={onEdit}
                        className="p-1.5 rounded-full text-slate-400 hover:bg-cyan-50 hover:text-cyan-600"
                        title="修改"
                    >
                        <PencilSimple className="w-4 h-4" weight="regular" />
                    </button>
                    <button
                        onClick={onDelete}
                        className="p-1.5 rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500"
                        title="删除"
                    >
                        <Trash className="w-4 h-4" weight="regular" />
                    </button>
                </div>
            </div>
        </div>
    );
};

/** 新建 / 编辑 Sheet（含副 API 润色） */
const MemoEditSheet: React.FC<{
    memo: Memo | null;
    onClose: () => void;
    onSave: (memo: Memo) => void;
    memoApiConfig: MemoApiConfig;
    addToast: (msg: string, kind?: 'info' | 'success' | 'error') => void;
}> = ({ memo, onClose, onSave, memoApiConfig, addToast }) => {
    const [content, setContent] = useState(memo?.content || '');
    const [type, setType] = useState<MemoType>(memo?.type || 'daily');
    const [tagsText, setTagsText] = useState(memo?.tags.join(' ') || '');
    const [polishing, setPolishing] = useState(false);

    const handleSave = async () => {
        const trimmed = content.trim();
        if (!trimmed) {
            addToast('内容不能为空', 'error');
            return;
        }
        // 副 API 润色（仅新建时自动润色；编辑时若用户没改 content 就不重复润色）
        const shouldPolish = !memo || content !== memo.content;
        let finalContent = trimmed;
        let finalTags = tagsText.split(/\s+/).filter(Boolean).slice(0, 3);
        let finalType = type;
        if (shouldPolish && memoApiConfig.baseUrl) {
            setPolishing(true);
            try {
                const polished = await polishMemo(memoApiConfig, {
                    raw: trimmed,
                    type,
                    tags: finalTags.length ? finalTags : undefined,
                });
                finalContent = polished.content;
                if (!finalTags.length) finalTags = polished.tags;
                finalType = polished.type;
                if (polished.polished) addToast('已用副 API 润色', 'success');
            } catch {
                addToast('润色失败，使用原始内容', 'info');
            } finally {
                setPolishing(false);
            }
        } else {
            finalContent = finalContent.slice(0, MEMO_CONTENT_MAX);
        }
        const now = Date.now();
        const result: Memo = {
            id: memo?.id || `memo_${now}_${Math.random().toString(36).slice(2, 8)}`,
            charId: memo?.charId || '',
            type: finalType,
            content: finalContent,
            tags: finalTags,
            done: memo?.done || false,
            createdAt: memo?.createdAt || now,
            updatedAt: now,
        };
        onSave(result);
    };

    return (
        <div className="absolute inset-0 z-50 flex flex-col bg-white" style={{ paddingTop: 'max(2rem, var(--safe-top))' }}>
            <div className="flex items-center justify-between px-4 pb-2 shrink-0">
                <button onClick={onClose} className="text-sm text-slate-500">取消</button>
                <h2 className="text-base font-medium text-slate-700">{memo ? '修改备忘' : '新建备忘'}</h2>
                <button
                    onClick={handleSave}
                    disabled={polishing || !content.trim()}
                    className="text-sm font-bold text-cyan-600 disabled:opacity-30"
                >
                    {polishing ? '润色中…' : '保存'}
                </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <div>
                    <div className="text-xs text-slate-500 mb-1">类型</div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setType('daily')}
                            className={`flex-1 py-2 text-sm rounded-xl font-medium ${type === 'daily' ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-500'}`}
                        >
                            日常备忘
                        </button>
                        <button
                            onClick={() => setType('todo')}
                            className={`flex-1 py-2 text-sm rounded-xl font-medium ${type === 'todo' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}
                        >
                            待办
                        </button>
                    </div>
                </div>
                <div>
                    <div className="text-xs text-slate-500 mb-1">内容（≤{MEMO_CONTENT_MAX} 字，副 API 会自动润色）</div>
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder="说出想记的事，口语化也行…"
                        maxLength={200}
                        rows={4}
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-cyan-300 resize-none"
                    />
                    <div className="text-right text-[10px] text-slate-400 mt-0.5">{content.length} 字（润色后 ≤{MEMO_CONTENT_MAX}）</div>
                </div>
                <div>
                    <div className="text-xs text-slate-500 mb-1">标签（空格分隔，最多 3 个，留空由系统推断）</div>
                    <input
                        type="text"
                        value={tagsText}
                        onChange={(e) => setTagsText(e.target.value)}
                        placeholder="如：生日 礼物"
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-cyan-300"
                    />
                </div>
                {memoApiConfig.baseUrl ? (
                    <div className="text-xs text-cyan-600 bg-cyan-50 rounded-lg px-3 py-2">
                        保存时将用副 API（{memoApiConfig.model}）润色内容
                    </div>
                ) : (
                    <div className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                        未配置副 API，将直接使用原始内容（截断到 {MEMO_CONTENT_MAX} 字）。可在备忘录主页右上角设置。
                    </div>
                )}
            </div>
        </div>
    );
};

/** 副 API 设置 Modal */
const MemoApiModal: React.FC<{
    config: MemoApiConfig;
    onClose: () => void;
    onSave: (cfg: MemoApiConfig) => void;
}> = ({ config, onClose, onSave }) => {
    const [baseUrl, setBaseUrl] = useState(config.baseUrl);
    const [apiKey, setApiKey] = useState(config.apiKey);
    const [model, setModel] = useState(config.model);

    return (
        <Modal
            isOpen={true}
            title="备忘录副 API"
            onClose={onClose}
            footer={
                <div className="flex gap-2 w-full">
                    <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-bold">取消</button>
                    <button
                        onClick={() => onSave({ baseUrl: baseUrl.trim().replace(/\/+$/, ''), apiKey: apiKey.trim(), model: model.trim() })}
                        className="flex-1 py-3 bg-cyan-500 text-white rounded-2xl font-bold"
                    >
                        保存
                    </button>
                </div>
            }
        >
            <div className="space-y-3 text-sm">
                <p className="text-xs text-slate-500">
                    此 API 仅用于角色生成 / 修改备忘内容时的「润色」调用，与主 API / 记忆宫殿副 API / 情绪副 API 完全独立。
                    留空则直接使用原始内容。
                </p>
                <label className="block">
                    <div className="text-xs text-slate-500 mb-1">Base URL</div>
                    <input
                        type="text"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-cyan-300"
                    />
                </label>
                <label className="block">
                    <div className="text-xs text-slate-500 mb-1">API Key</div>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-cyan-300"
                    />
                </label>
                <label className="block">
                    <div className="text-xs text-slate-500 mb-1">Model</div>
                    <input
                        type="text"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-cyan-300"
                    />
                </label>
            </div>
        </Modal>
    );
};

export default MemoApp;
