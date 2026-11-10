import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileWarning,
  Loader2,
  Save,
} from "lucide-react";
import { getConflictFile, markConflictResolved, resolveConflict } from "../api/tauri";

/** 一个冲突块（一对 <<<<<<< / ======= / >>>>>>> 之间的内容） */
interface ConflictBlock {
  kind: "conflict";
  id: number;
  ours: string[];
  theirs: string[];
  base?: string[];
  oursLabel: string;
  theirsLabel: string;
}

interface TextPiece {
  kind: "text";
  lines: string[];
}

type Piece = TextPiece | ConflictBlock;

export type ConflictChoice = "ours" | "theirs" | "both" | "none";

/** 解析文件内容中的冲突标记，普通文本与冲突块按原顺序保存 */
function parseConflicts(content: string): { pieces: Piece[]; count: number } {
  const lines = content.split(/\r?\n/);
  const pieces: Piece[] = [];
  let textBuffer: string[] = [];
  let id = 0;
  let i = 0;

  const flushText = () => {
    if (textBuffer.length > 0) {
      pieces.push({ kind: "text", lines: textBuffer });
      textBuffer = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.startsWith("<<<<<<<")) {
      textBuffer.push(line);
      i += 1;
      continue;
    }

    // 当前分支内容（ours）
    const ours: string[] = [];
    let j = i + 1;
    while (
      j < lines.length &&
      !lines[j].startsWith("=======") &&
      !lines[j].startsWith("|||||||")
    ) {
      ours.push(lines[j]);
      j += 1;
    }

    if (j >= lines.length) {
      // 标记不完整：按普通文本处理，避免误删内容
      textBuffer.push(line);
      i += 1;
      continue;
    }

    // diff3 风格会多出一段共同祖先内容（base）
    let base: string[] | undefined;
    if (lines[j].startsWith("|||||||")) {
      base = [];
      j += 1;
      while (j < lines.length && !lines[j].startsWith("=======")) {
        base.push(lines[j]);
        j += 1;
      }
    }

    if (j >= lines.length) {
      textBuffer.push(line);
      i += 1;
      continue;
    }

    // 跳过 =======
    j += 1;

    // 传入分支内容（theirs）
    const theirs: string[] = [];
    while (j < lines.length && !lines[j].startsWith(">>>>>>>")) {
      theirs.push(lines[j]);
      j += 1;
    }

    if (j >= lines.length) {
      textBuffer.push(line);
      i += 1;
      continue;
    }

    // 跳过 >>>>>>>
    const theirsMarker = lines[j];
    j += 1;

    flushText();
    pieces.push({
      kind: "conflict",
      id,
      ours,
      theirs,
      base,
      oursLabel: line.slice(7).trim() || "当前分支",
      theirsLabel: theirsMarker.slice(7).trim() || "传入分支",
    });
    id += 1;
    i = j;
  }

  flushText();
  return { pieces, count: id };
}

function blockResult(block: ConflictBlock, choice: ConflictChoice): string[] {
  switch (choice) {
    case "ours":
      return block.ours;
    case "theirs":
      return block.theirs;
    case "both":
      return [...block.ours, ...block.theirs];
    case "none":
    default:
      return [];
  }
}

interface Props {
  /** 冲突文件在仓库中的相对路径 */
  filePath: string;
  /** 保存或标记成功后通知父组件刷新状态 */
  onResolved: () => void;
}

/** 合并冲突可视化解决：逐块选择保留当前 / 传入 / 两者，最后写回并 git add */
export default function ConflictResolver({ filePath, onResolved }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<number, ConflictChoice>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setActionError(null);
    setContent(null);
    setChoices({});
    setExpanded({});

    getConflictFile(filePath)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        const { pieces, count } = parseConflicts(text);
        const initial: Record<number, ConflictChoice> = {};
        for (const piece of pieces) {
          if (piece.kind === "conflict") initial[piece.id] = "ours";
        }
        // 没有冲突标记时也保持空白映射
        setChoices(count > 0 ? initial : {});
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const parsed = useMemo(
    () => (content !== null ? parseConflicts(content) : { pieces: [], count: 0 }),
    [content],
  );

  const resolvedContent = useMemo(() => {
    if (content === null) return "";
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const out: string[] = [];
    for (const piece of parsed.pieces) {
      if (piece.kind === "text") {
        out.push(...piece.lines);
      } else {
        out.push(...blockResult(piece, choices[piece.id] ?? "ours"));
      }
    }
    return out.join(eol);
  }, [content, parsed, choices]);

  const setAll = useCallback(
    (choice: ConflictChoice) => {
      const next: Record<number, ConflictChoice> = {};
      for (const piece of parsed.pieces) {
        if (piece.kind === "conflict") next[piece.id] = choice;
      }
      setChoices(next);
    },
    [parsed],
  );

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const handleSave = useCallback(async () => {
    if (saving || content === null) return;
    setSaving(true);
    setActionError(null);
    try {
      await resolveConflict(filePath, resolvedContent);
      onResolved();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [saving, content, filePath, resolvedContent, onResolved]);

  const handleMarkResolved = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setActionError(null);
    try {
      await markConflictResolved(filePath);
      onResolved();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [saving, filePath, onResolved]);

  return (
    <div className="conflict-resolver">
      <div className="conflict-header">
        <div className="conflict-header-main">
          <FileWarning size={16} className="conflict-header-icon" />
          <div className="conflict-header-text">
            <div className="conflict-title">解决合并冲突</div>
            <div className="conflict-path" title={filePath}>
              {filePath}
            </div>
          </div>
          {!loading && !loadError && (
            <span
              className={`conflict-count ${
                parsed.count > 0 ? "has-conflicts" : "no-conflicts"
              }`}
            >
              {parsed.count > 0 ? `${parsed.count} 处冲突` : "无冲突标记"}
            </span>
          )}
        </div>

        <div className="conflict-actions">
          {parsed.count > 0 && (
            <>
              <button
                type="button"
                className="conflict-quick-btn"
                onClick={() => setAll("ours")}
                disabled={saving}
                title="所有冲突块都保留当前分支内容"
              >
                全部保留当前
              </button>
              <button
                type="button"
                className="conflict-quick-btn"
                onClick={() => setAll("theirs")}
                disabled={saving}
                title="所有冲突块都保留传入分支内容"
              >
                全部保留传入
              </button>
            </>
          )}
          <button
            type="button"
            className="conflict-save-btn"
            onClick={handleSave}
            disabled={saving || loading || loadError !== null || content === null}
            title="写入解决后的内容并标记为已解决 (git add)"
          >
            {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
            <span>{saving ? "处理中..." : "保存并标记已解决"}</span>
          </button>
          <button
            type="button"
            className="conflict-mark-btn"
            onClick={handleMarkResolved}
            disabled={saving}
            title="不修改文件内容，直接标记为已解决 (git add)"
          >
            <CheckCircle2 size={13} />
            <span>仅标记已解决</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="conflict-loading">
          <Loader2 size={18} className="spin" />
          <span>正在读取冲突文件…</span>
        </div>
      )}

      {!loading && loadError && (
        <div className="conflict-load-error">
          <AlertTriangle size={16} />
          <span>无法读取冲突文件：{loadError}</span>
        </div>
      )}

      {!loading && !loadError && parsed.count === 0 && (
        <div className="conflict-no-markers">
          <CheckCircle2 size={18} />
          <div>
            <div>未检测到冲突标记。</div>
            <div className="conflict-no-markers-sub">
              如果已在外部编辑器解决冲突，可以直接点击「仅标记已解决」。
            </div>
          </div>
        </div>
      )}

      {!loading && !loadError && parsed.count > 0 && (
        <div className="conflict-list">
          {parsed.pieces.map((piece, index) => {
            if (piece.kind === "text") return null;
            const choice = choices[piece.id] ?? "ours";
            const open = expanded[piece.id] ?? false;
            const result = blockResult(piece, choice);
            return (
              <section className="conflict-block" key={piece.id}>
                <div className="conflict-block-header">
                  <span className="conflict-block-index">
                    冲突 {index + 1} / {parsed.count}
                  </span>
                  <span className="conflict-block-labels">
                    <span className="conflict-label ours" title={piece.oursLabel}>
                      当前 · {piece.oursLabel}
                    </span>
                    <span className="conflict-label theirs" title={piece.theirsLabel}>
                      传入 · {piece.theirsLabel}
                    </span>
                  </span>
                </div>

                <div className="conflict-sides">
                  <div className="conflict-side ours">
                    <div className="conflict-side-header">当前分支 (ours)</div>
                    <pre className="conflict-side-content">
                      {piece.ours.length > 0 ? piece.ours.join("\n") : "（无内容）"}
                    </pre>
                  </div>
                  <div className="conflict-side theirs">
                    <div className="conflict-side-header">传入分支 (theirs)</div>
                    <pre className="conflict-side-content">
                      {piece.theirs.length > 0 ? piece.theirs.join("\n") : "（无内容）"}
                    </pre>
                  </div>
                </div>

                <div className="conflict-choice-row">
                  {(
                    [
                      ["ours", "保留当前"],
                      ["theirs", "保留传入"],
                      ["both", "两者都保留"],
                      ["none", "全部删除"],
                    ] as [ConflictChoice, string][]
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={`conflict-choice-btn ${choice === value ? "active" : ""}`}
                      onClick={() =>
                        setChoices((prev) => ({ ...prev, [piece.id]: value }))
                      }
                    >
                      {choice === value && <Check size={11} />}
                      {label}
                    </button>
                  ))}

                  <button
                    type="button"
                    className="conflict-preview-toggle"
                    onClick={() => toggleExpanded(piece.id)}
                  >
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {open ? "收起结果" : "预览结果"}
                  </button>
                </div>

                {open && (
                  <pre className="conflict-result-preview">
                    {result.length > 0
                      ? result.join("\n")
                      : "（该冲突块将不保留任何内容）"}
                  </pre>
                )}
              </section>
            );
          })}
        </div>
      )}

      {actionError && (
        <div className="conflict-action-error">
          <AlertTriangle size={14} />
          <span>{actionError}</span>
        </div>
      )}
    </div>
  );
}
