import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { Memo, DeletedMemo, MemoType, MemoApiConfig, CharacterProfile } from '../types';
import { MEMO_MAX, MEMO_CONTENT_MAX } from '../utils/memoInjection';
import { polishMemo } from '../utils/memoPolish';
import Modal from '../components/os/Modal';
import { ArrowLeft, Plus, Trash, PencilSimple, Check, ArrowsClockwise, WarningCircle, Gear, NotePencil, Checks, CaretLeft, Circle, CheckCircle, X } from '@phosphor-icons/react';

type View = 'home' | 'list' | 'trash';

// ─── 时间格式化（按图1规范：MM/DD HH:MM + 相对时间）──
const formatMD = (ts: number): string => {
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const formatRelative = (ts: number): string => {
    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return `${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} 天前`;
    return formatMD(ts);
};

const MemoApp: React.FC = () => {
    const { closeApp, characters, addToast, memoGlobalEnabled, updateMemoGlobalEnabled, memoApiConfig, updateMemoApiConfig, updateCharacter } = useOS();

    const [view, setView] = useState<View>('home');
    const [activeCharId, setActiveCharId] = useState<string | null>(null);
    const [charMemos, setCharMemos] = useState<Memo[]>([]);
    const [deletedMemos, setDeletedMemos] = useState<DeletedMemo[]>([]);

    // 筛选标签（图2：全部 / 已启用 / 未启用 / 系统 … 按分组）
    const [filterTag, setFilterTag] = useState<'all' | 'enabled' | 'disabled'>('all');

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

    // ─── 筛选后的角色列表（图2: 全部 / 已启用 / 未启用）──
    const filteredChars = useMemo(() => {
        return characters.filter((c) => {
            const enabled = c.memoEnabled === true && memoGlobalEnabled;
            if (filterTag === 'enabled') return enabled;
            if (filterTag === 'disabled') return !enabled;
            return true;
        });
    }, [characters, filterTag, memoGlobalEnabled]);

    // 筛选标签角标数（图2: 全部 N / 已启用 N / 未启用 N）
    const tagCounts = useMemo(() => ({
        all: characters.length,
        enabled: characters.filter((c) => c.memoEnabled === true && memoGlobalEnabled).length,
        disabled: characters.filter((c) => !(c.memoEnabled === true && memoGlobalEnabled)).length,
    }), [characters, memoGlobalEnabled]);

    const showBack = view !== 'home';

    const handleBack = () => {
        if (view === 'trash') setView('list');
        else if (view === 'list') { setView('home'); setActiveCharId(null); }
    };

    const title = view === 'home' ? '备忘录'
        : view === 'list' ? `${activeChar?.name || '备忘'} · 备忘录`
            : '回收站';

    return (
        <div className="absolute inset-0 flex flex-col overflow-hidden bg-slate-50">
            {/* ─── 顶部导航栏（图1/图2：标题居中，左侧返回箭头，右侧操作按钮）── */}
            <div
                className="flex items-center justify-between px-4 h-9 shrink-0 bg-white/80 backdrop-blur border-b border-slate-200/60"
                style={{ paddingTop: 'max(0px, var(--safe-top))' }}
            >
                <div className="flex items-center min-w-[56px]">
                    {showBack ? (
                        <button
                            onClick={handleBack}
                            className="flex items-center gap-0.5 text-cyan-600 active:opacity-60"
                        >
                            <CaretLeft className="w-5 h-5" weight="bold" />
                            <span className="text-[15px]">返回</span>
                        </button>
                    ) : (
                        <button
                            onClick={() => setShowApiModal(true)}
                            className="p-1 -ml-1 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                            title="副 API 设置"
                        >
                            <Gear className="w-5 h-5 text-slate-500" weight="regular" />
                        </button>
                    )}
                </div>
                <h1 className="text-[17px] font-semibold text-slate-800 truncate max-w-[60%]">{title}</h1>
                <div className="flex items-center gap-1 min-w-[56px] justify-end">
                    {view === 'list' && activeChar && (
                        <>
                            <button
                                onClick={() => setView('trash')}
                                className="p-1.5 rounded-full hover:bg-black/5 active:scale-90 transition-transform"
                                title="回收站"
                            >
                                <Trash className="w-5 h-5 text-slate-500" weight="regular" />
                            </button>
                            <button
                                onClick={() => setCreating(true)}
                                disabled={charMemos.length >= MEMO_MAX}
                                className="p-1.5 rounded-full hover:bg-black/5 active:scale-90 transition-transform disabled:opacity-30"
                                title={charMemos.length >= MEMO_MAX ? `已达上限 ${MEMO_MAX} 条` : '新建'}
                            >
                                <Plus className="w-5 h-5 text-cyan-600" weight="bold" />
                            </button>
                        </>
                    )}
                    {view === 'home' && (
                        <div className="w-9" />
                    )}
                    <button
                        onClick={() => closeApp()}
                        className="p-1.5 -mr-1 rounded-full hover:bg-red-50 hover:text-red-500 active:scale-90 transition-transform text-slate-500"
                        title="退出"
                    >
                        <X className="w-5 h-5" weight="bold" />
                    </button>
                </div>
            </div>

            {/* ─── 主页（图2：角色总览列表）── */}
            {view === 'home' && (
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    {/* 全局开关 */}
                    <div className="mx-4 mt-3 bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-[15px] font-medium text-slate-800">全局启用备忘录</div>
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

                    {/* 筛选标签栏（图2：横向滚动 文字+数字角标 选中下划线） */}
                    <div className="flex items-center gap-1 px-4 mt-4 mb-2 overflow-x-auto no-scrollbar">
                        {([
                            { key: 'all', label: '全部' },
                            { key: 'enabled', label: '已启用' },
                            { key: 'disabled', label: '未启用' },
                        ] as const).map((tag) => {
                            const active = filterTag === tag.key;
                            const count = tagCounts[tag.key];
                            return (
                                <button
                                    key={tag.key}
                                    onClick={() => setFilterTag(tag.key)}
                                    className={`flex items-center gap-1 px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors ${
                                        active ? 'text-cyan-600 font-semibold' : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    <span>{tag.label}</span>
                                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                                        active ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-500'
                                    }`}>{count}</span>
                                    {active && (
                                        <span className="absolute -bottom-px left-0 right-0 h-0.5 bg-cyan-500" />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* 角色条目列表（图2：左大字加粗名 + 右X/10 + 下方状态摘要） */}
                    <div className="px-4 pb-8 space-y-2">
                        {filteredChars.length === 0 ? (
                            <div className="text-center text-sm text-slate-400 py-16">
                                <NotePencil className="w-10 h-10 mx-auto mb-3 opacity-30" weight="regular" />
                                <div>还没有角色</div>
                                <div className="text-xs mt-1">请先去「神经链接」创建</div>
                            </div>
                        ) : (
                            filteredChars.map((char) => (
                                <CharRow
                                    key={char.id}
                                    char={char}
                                    globalEnabled={memoGlobalEnabled}
                                    onEnter={() => handleEnterChar(char.id)}
                                    onToggleEnabled={(en) => handleToggleCharEnabled(char.id, en)}
                                />
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* ─── 单角色详情页（图1：副标题 + 卡片列表）── */}
            {view === 'list' && activeChar && (
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    {/* 统计副标题（图1：有栖川雪的备忘录 + X/10条 数字高亮） */}
                    <div className="px-4 py-3 text-xs text-slate-500">
                        <span>{activeChar.name}的备忘录 · </span>
                        <span className="text-cyan-600 font-semibold">{charMemos.length}</span>
                        <span className="text-slate-400">/{MEMO_MAX} 条</span>
                        <span className="ml-2 text-slate-400">· 按修改时间倒序</span>
                        {charMemos.length >= MEMO_MAX && (
                            <span className="ml-1 text-amber-600">（已满，需删旧才能新建）</span>
                        )}
                    </div>

                    <div className="px-4 pb-8 space-y-2">
                        {charMemos.length === 0 ? (
                            <div className="text-center text-sm text-slate-400 py-16">
                                <NotePencil className="w-10 h-10 mx-auto mb-3 opacity-30" weight="regular" />
                                <div>还没有备忘</div>
                                <div className="text-xs mt-1">点右上角 + 新建，或在私聊里让 {activeChar.name} 帮你记</div>
                            </div>
                        ) : (
                            charMemos.map((memo, idx) => (
                                <MemoCard
                                    key={memo.id}
                                    memo={memo}
                                    index={idx}
                                    onToggleTodo={() => handleToggleTodo(memo)}
                                    onEdit={() => setEditingMemo(memo)}
                                    onDelete={() => setDeleteTarget(memo)}
                                />
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* ─── 回收站 ── */}
            {view === 'trash' && (
                <div className="flex-1 overflow-y-auto no-scrollbar">
                    <div className="px-4 py-3 text-xs text-slate-500">
                        回收站 · 18 天后彻底删除
                        {deletedMemos.length > 0 && <span className="ml-1">（共 {deletedMemos.length} 条）</span>}
                    </div>
                    <div className="px-4 pb-8 space-y-2">
                        {deletedMemos.length === 0 ? (
                            <div className="text-center text-sm text-slate-400 py-16">
                                <Trash className="w-10 h-10 mx-auto mb-3 opacity-30" weight="regular" />
                                <div>回收站是空的</div>
                            </div>
                        ) : (
                            deletedMemos.map((dm) => {
                                const daysLeft = Math.max(0, 18 - Math.floor((Date.now() - dm.deletedAt) / (24 * 60 * 60 * 1000)));
                                return (
                                    <div key={dm.id} className="bg-white/60 rounded-2xl p-3 border border-slate-100">
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
                </div>
            )}

            {/* 新建 / 编辑备忘 Sheet */}
            {(creating || editingMemo) && activeChar && (
                <MemoEditSheet
                    memo={editingMemo}
                    charId={activeCharId || ''}
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

/** 角色行（图2：左侧大字加粗名 + 右侧 X/10 + 下方状态摘要） */
const CharRow: React.FC<{
    char: CharacterProfile;
    globalEnabled: boolean;
    onEnter: () => void;
    onToggleEnabled: (en: boolean) => void;
}> = ({ char, globalEnabled, onEnter, onToggleEnabled }) => {
    const [info, setInfo] = useState<{ count: number; lastUpdate: number | null; pendingTodos: number } | null>(null);

    useEffect(() => {
        DB.getMemosByCharId(char.id).then((memos) => {
            const pendingTodos = memos.filter((m) => m.type === 'todo' && !m.done).length;
            setInfo({
                count: memos.length,
                lastUpdate: memos.length > 0 ? memos[0].updatedAt : null,
                pendingTodos,
            });
        }).catch(() => setInfo({ count: 0, lastUpdate: null, pendingTodos: 0 }));
    }, [char.id]);

    const enabled = char.memoEnabled === true && globalEnabled;

    const summary = (() => {
        if (!info) return '加载中…';
        if (info.count === 0) return '还没有备忘录';
        const parts: string[] = [];
        if (info.pendingTodos > 0) parts.push(`${info.pendingTodos} 个待办未完成`);
        if (info.lastUpdate) parts.push(`最后修改 ${formatRelative(info.lastUpdate)}`);
        return parts.join(' · ') || '暂无待办';
    })();

    return (
        <div className="bg-white rounded-2xl px-4 py-3 shadow-sm border border-slate-100">
            <div className="flex items-center gap-3">
                <button onClick={onEnter} className="flex-1 flex items-center gap-3 text-left min-w-0">
                    {char.avatar ? (
                        <img src={char.avatar} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                    ) : (
                        <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center text-cyan-600 font-bold shrink-0">
                            {char.name.charAt(0)}
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-[15px] font-semibold text-slate-800 truncate">{char.name}</div>
                            <div className="text-xs text-slate-400 shrink-0">
                                {info ? `${info.count}/${MEMO_MAX}` : '…/10'}
                            </div>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 truncate">{summary}</div>
                    </div>
                </button>
                <button
                    onClick={() => onToggleEnabled(!enabled)}
                    className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${enabled ? 'bg-cyan-500' : 'bg-slate-300'}`}
                    title={enabled ? '已启用' : '未启用'}
                >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-4' : ''}`} />
                </button>
            </div>
        </div>
    );
};

/** 单条备忘卡片（图1：#1 备忘标题 + 正文 + 方形复选框标签 + 时间戳 + 修改/删除） */
const MemoCard: React.FC<{
    memo: Memo;
    index: number;
    onToggleTodo: () => void;
    onEdit: () => void;
    onDelete: () => void;
}> = ({ memo, index, onToggleTodo, onEdit, onDelete }) => {
    return (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            {/* 标题行：#1 备忘/待办（深色加粗） */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-slate-800">#{index + 1}</span>
                    <span className={`text-[12px] px-2 py-0.5 rounded-md font-medium ${
                        memo.type === 'todo'
                            ? (memo.done ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')
                            : 'bg-cyan-100 text-cyan-700'
                    }`}>
                        {memo.type === 'todo' ? '待办' : '备忘'}
                    </span>
                </div>
                {memo.type === 'todo' && (
                    <button
                        onClick={onToggleTodo}
                        className={`p-0.5 rounded-full ${memo.done ? 'text-emerald-500' : 'text-slate-300'} hover:bg-black/5 active:scale-90 transition-transform`}
                        title={memo.done ? '标记为未完成' : '标记为已完成'}
                    >
                        {memo.done
                            ? <CheckCircle className="w-5 h-5" weight="fill" />
                            : <Circle className="w-5 h-5" weight="regular" />}
                    </button>
                )}
            </div>

            {/* 正文（普通字重，多行展示） */}
            <div className={`text-[14px] leading-relaxed text-slate-700 mb-3 ${
                memo.type === 'todo' && memo.done ? 'line-through opacity-50' : ''
            }`}>
                {memo.content}
            </div>

            {/* 标签区域（方形复选框 + 文字标签） */}
            {memo.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    {memo.tags.map((t, i) => (
                        <span
                            key={i}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[11px]"
                        >
                            <span className="w-2.5 h-2.5 border border-slate-400 rounded-sm inline-block" />
                            {t}
                        </span>
                    ))}
                </div>
            )}

            {/* 底部：时间戳（左：创建XX · 修改XX） + 操作（右：修改/删除） */}
            <div className="flex items-end justify-between pt-1 border-t border-slate-50">
                <div className="text-[10px] text-slate-400 leading-relaxed pt-2">
                    <div>创建 {formatMD(memo.createdAt)}</div>
                    <div>修改 {formatRelative(memo.updatedAt)}</div>
                </div>
                <div className="flex items-center gap-1 pt-2">
                    <button
                        onClick={onEdit}
                        className="p-1.5 rounded-full text-slate-400 hover:bg-cyan-50 hover:text-cyan-600 active:scale-90 transition-transform"
                        title="修改"
                    >
                        <PencilSimple className="w-4 h-4" weight="regular" />
                    </button>
                    <button
                        onClick={onDelete}
                        className="p-1.5 rounded-full text-slate-400 hover:bg-red-50 hover:text-red-500 active:scale-90 transition-transform"
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
    charId: string;
    onClose: () => void;
    onSave: (memo: Memo) => void;
    memoApiConfig: MemoApiConfig;
    addToast: (msg: string, kind?: 'info' | 'success' | 'error') => void;
}> = ({ memo, charId, onClose, onSave, memoApiConfig, addToast }) => {
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
            charId: memo?.charId || charId,
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
            <div className="flex items-center justify-between px-4 pb-2 shrink-0 h-11">
                <button onClick={onClose} className="text-sm text-slate-500">取消</button>
                <h2 className="text-base font-medium text-slate-800">{memo ? '修改备忘' : '新建备忘'}</h2>
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
                        未配置副 API，将直接使用原始内容（截断到 {MEMO_CONTENT_MAX} 字）。可在备忘录主页左上角设置。
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
