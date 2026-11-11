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
import { useI18n } from "../i18n";

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
function parseConflicts(content: string, defaultOurs: string, defaultTheirs: string): { pieces: Piece[]; count: number } {
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
      oursLabel: line.slice(7).trim() || defaultOurs,
      theirsLabel: theirsMarker.slice(7).trim() || defaultTheirs,
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
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<number, ConflictChoice>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const defaultOurs = t("conflict.currentBranchDefault");
  const defaultTheirs = t("conflict.incomingBranchDefault");

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
        const { pieces, count } = parseConflicts(text, defaultOurs, defaultTheirs);
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
  }, [filePath, defaultOurs, defaultTheirs]);

  const parsed = useMemo(
    () => (content !== null ? parseConflicts(content, defaultOurs, defaultTheirs) : { pieces: [], count: 0 }),
    [content, defaultOurs, defaultTheirs],
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
            <div className="conflict-title">{t("conflict.title")}</div>
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
              {parsed.count > 0 ? t("conflict.conflictsCount", { count: parsed.count }) : t("conflict.noMarkers")}
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
                title={t("conflict.keepAllOursTooltip")}
              >
                {t("conflict.keepAllOurs")}
              </button>
              <button
                type="button"
                className="conflict-quick-btn"
                onClick={() => setAll("theirs")}
                disabled={saving}
                title={t("conflict.keepAllTheirsTooltip")}
              >
                {t("conflict.keepAllTheirs")}
              </button>
            </>
          )}
          <button
            type="button"
            className="conflict-save-btn"
            onClick={handleSave}
            disabled={saving || loading || loadError !== null || content === null}
            title={t("conflict.saveAndMarkTooltip")}
          >
            {saving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
            <span>{saving ? t("common.processing") : t("conflict.saveAndMark")}</span>
          </button>
          <button
            type="button"
            className="conflict-mark-btn"
            onClick={handleMarkResolved}
            disabled={saving}
            title={t("conflict.markOnlyTooltip")}
          >
            <CheckCircle2 size={13} />
            <span>{t("conflict.markOnly")}</span>
          </button>
        </div>
      </div>

      {loading && (
        <div className="conflict-loading">
          <Loader2 size={18} className="spin" />
          <span>{t("conflict.readingConflictFile")}</span>
        </div>
      )}

      {!loading && loadError && (
        <div className="conflict-load-error">
          <AlertTriangle size={16} />
          <span>{t("conflict.readError")}{loadError}</span>
        </div>
      )}

      {!loading && !loadError && parsed.count === 0 && (
        <div className="conflict-no-markers">
          <CheckCircle2 size={18} />
          <div>
            <div>{t("conflict.noConflictFound")}</div>
            <div className="conflict-no-markers-sub">
              {t("conflict.noConflictFoundSub")}
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
                    {t("conflict.conflictBlockHeader", { index: index + 1, total: parsed.count })}
                  </span>
                  <span className="conflict-block-labels">
                    <span className="conflict-label ours" title={piece.oursLabel}>
                      {t("conflict.currentOurs", { label: piece.oursLabel })}
                    </span>
                    <span className="conflict-label theirs" title={piece.theirsLabel}>
                      {t("conflict.incomingTheirs", { label: piece.theirsLabel })}
                    </span>
                  </span>
                </div>

                <div className="conflict-sides">
                  <div className="conflict-side ours">
                    <div className="conflict-side-header">{t("conflict.currentBranchSide")}</div>
                    <pre className="conflict-side-content">
                      {piece.ours.length > 0 ? piece.ours.join("\n") : t("conflict.noContent")}
                    </pre>
                  </div>
                  <div className="conflict-side theirs">
                    <div className="conflict-side-header">{t("conflict.incomingBranchSide")}</div>
                    <pre className="conflict-side-content">
                      {piece.theirs.length > 0 ? piece.theirs.join("\n") : t("conflict.noContent")}
                    </pre>
                  </div>
                </div>

                <div className="conflict-choice-row">
                  {(
                    [
                      ["ours", t("conflict.keepOurs")],
                      ["theirs", t("conflict.keepTheirs")],
                      ["both", t("conflict.keepBoth")],
                      ["none", t("conflict.keepNone")],
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
                    {open ? t("conflict.collapseResult") : t("conflict.previewResult")}
                  </button>
                </div>

                {open && (
                  <pre className="conflict-result-preview">
                    {result.length > 0
                      ? result.join("\n")
                      : t("conflict.emptyResult")}
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
