"use client";

import { useState, useTransition } from "react";
import {
  addLabelAction,
  deleteLabelAction,
  renameLabelAction,
  reorderLabelsAction,
  savePresetsAction,
} from "@/app/dashboard/settings/actions";
import { fill, t } from "@/lib/i18n";
import { smartSizeSort } from "@/lib/settings/size-order";
import type { CatalogLabel, OptionPreset, SaveResult, ShopSettings } from "@/lib/settings/types";
import { validateLabelName, validatePresets } from "@/lib/settings/validate";
import { dangerButton, inputClass, primaryButton, SectionCard, secondaryButton, useReadOnly, useSection } from "./kit";

const s = t.backoffice.settings;
const iconButton =
  "inline-flex h-11 w-11 items-center justify-center rounded-xl border border-bo-border bg-white text-bo-ink hover:bg-bo-page disabled:opacity-40";

function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const j = index + by;
  if (j < 0 || j >= list.length) return list;
  const copy = [...list];
  [copy[index], copy[j]] = [copy[j], copy[index]];
  return copy;
}

// ------------------------------------------------ collections + categories
/** These lists save right away (renames also update the products). */
export function CatalogListsSection({ settings }: { settings: ShopSettings }) {
  const l = s.lists;
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<SaveResult>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (res.ok) setMessage(res.message ?? s.saved);
        else setError(res.error ?? s.errors.generic);
      } catch {
        setError(s.errors.generic);
      }
    });
  }

  return (
    <SectionCard id="lists" title={l.title} intro={l.intro} error={error}>
      <p role="status" aria-live="polite" className="text-sm font-semibold text-status-paid-fg empty:hidden">{message ?? ""}</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <LabelList
          kind="collection"
          title={l.collections}
          hint={l.collectionsHint}
          labels={settings.labels.filter((x) => x.kind === "collection")}
          pending={pending}
          run={run}
        />
        <LabelList
          kind="category"
          title={l.categories}
          hint={l.categoriesHint}
          labels={settings.labels.filter((x) => x.kind === "category")}
          pending={pending}
          run={run}
        />
      </div>
    </SectionCard>
  );
}

function LabelList({
  kind,
  title,
  hint,
  labels,
  pending,
  run,
}: {
  kind: "collection" | "category";
  title: string;
  hint: string;
  labels: CatalogLabel[];
  pending: boolean;
  run: (action: () => Promise<SaveResult>) => void;
}) {
  const l = s.lists;
  const readOnly = useReadOnly();
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; error: string | null } | null>(null);

  function add() {
    const problem = validateLabelName(draft, labels.map((x) => x.name));
    if (problem) return setDraftError(problem);
    const name = draft.trim();
    setDraft("");
    setDraftError(null);
    run(() => addLabelAction(kind, name));
  }

  function rename(label: CatalogLabel) {
    if (!editing) return;
    const problem = validateLabelName(editing.name, labels.filter((x) => x.id !== label.id).map((x) => x.name));
    if (problem) return setEditing({ ...editing, error: problem });
    if (editing.name.trim() === label.name) return setEditing(null);
    const name = editing.name.trim();
    setEditing(null);
    run(() => renameLabelAction(label.id, name));
  }

  function remove(label: CatalogLabel) {
    const text =
      label.products === 0
        ? fill(l.confirmDelete, { name: label.name })
        : fill(label.products === 1 ? l.confirmDeleteUsedOne : l.confirmDeleteUsed, { name: label.name, count: label.products });
    if (window.confirm(text)) run(() => deleteLabelAction(label.id));
  }

  function reorder(index: number, by: -1 | 1) {
    const ids = move(labels, index, by).map((x) => x.id);
    run(() => reorderLabelsAction(kind, ids));
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="font-bo-heading text-lg font-semibold">{title}</h3>
        <p className="text-sm text-bo-muted">{hint}</p>
      </div>
      {labels.length === 0 ? (
        <p className="text-sm text-bo-muted">{l.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {labels.map((label, i) => (
            <li key={label.id} className="flex flex-col gap-2 rounded-xl border border-bo-border p-2 pl-4">
              {editing?.id === label.id ? (
                <div className="flex flex-col gap-2">
                  <input
                    aria-label={l.rename}
                    value={editing.name}
                    autoFocus
                    onChange={(e) => setEditing({ ...editing, name: e.target.value, error: null })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(label);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className={inputClass}
                    aria-invalid={!!editing.error}
                  />
                  {editing.error && <p className="text-sm font-medium text-status-refused-fg">{editing.error}</p>}
                  <div className="flex gap-2">
                    <button type="button" className={primaryButton} onClick={() => rename(label)} disabled={pending}>{l.renameSave}</button>
                    <button type="button" className={secondaryButton} onClick={() => setEditing(null)}>{l.cancel}</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{label.name}</p>
                    <p className="text-xs text-bo-muted">
                      {label.products === 0 ? l.unused : label.products === 1 ? l.usedOne : fill(l.used, { count: label.products })}
                    </p>
                  </div>
                  {!readOnly && (
                    <div className="flex gap-1.5">
                      <button type="button" className={iconButton} aria-label={fill(l.moveUp, { name: label.name })} disabled={pending || i === 0} onClick={() => reorder(i, -1)}>↑</button>
                      <button type="button" className={iconButton} aria-label={fill(l.moveDown, { name: label.name })} disabled={pending || i === labels.length - 1} onClick={() => reorder(i, 1)}>↓</button>
                      <button type="button" className={secondaryButton} disabled={pending} onClick={() => setEditing({ id: label.id, name: label.name, error: null })}>{l.rename}</button>
                      <button type="button" className={dangerButton} disabled={pending} onClick={() => remove(label)}>{l.delete}</button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <input
              aria-label={`${l.add}: ${title}`}
              placeholder={l.addPlaceholder}
              value={draft}
              maxLength={60}
              onChange={(e) => {
                setDraft(e.target.value);
                setDraftError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              className={`${inputClass} min-w-0 flex-1`}
              aria-invalid={!!draftError}
            />
            <button type="button" className={secondaryButton} onClick={add} disabled={pending}>{l.add}</button>
          </div>
          {draftError && <p className="text-sm font-medium text-status-refused-fg">{draftError}</p>}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------ favourite option types
export function PresetsSection({ settings }: { settings: ShopSettings }) {
  const pr = s.presets;
  const readOnly = useReadOnly();
  const sec = useSection<{ list: OptionPreset[] }>({ list: settings.presets });
  const list = sec.value.list;
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const setList = (next: OptionPreset[]) => sec.update("list", next);
  const patch = (i: number, p: Partial<OptionPreset>) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)));

  function addValue(i: number) {
    const value = (drafts[i] ?? "").trim();
    if (!value) return;
    const preset = list[i];
    if (preset.values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      sec.setErrors({ ...sec.errors, [`values:${i}`]: pr.errors.duplicateValue });
      return;
    }
    patch(i, { values: [...preset.values, value] });
    setDrafts({ ...drafts, [i]: "" });
    const { [`values:${i}`]: _gone, ...rest } = sec.errors;
    void _gone;
    sec.setErrors(rest);
  }

  return (
    <SectionCard
      id="option-types"
      title={pr.title}
      intro={pr.intro}
      dirty={sec.dirty}
      pending={sec.pending}
      error={sec.error}
      savedAt={sec.savedAt}
      onSave={() => sec.save((v) => savePresetsAction(v.list), (v) => validatePresets(v.list).errors)}
    >
      {list.length === 0 && <p className="text-sm text-bo-muted">{pr.empty}</p>}
      {list.map((preset, i) => (
        <div key={i} className="flex flex-col gap-3 rounded-xl border border-bo-border p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor={`preset-${i}`} className="text-sm font-semibold">{pr.name}</label>
              <input
                id={`preset-${i}`}
                value={preset.name}
                placeholder={pr.namePlaceholder}
                maxLength={60}
                onChange={(e) => patch(i, { name: e.target.value })}
                className={inputClass}
                aria-invalid={!!sec.errors[`name:${i}`]}
              />
            </div>
            {!readOnly && (
              <div className="flex gap-1.5">
                <button type="button" className={iconButton} aria-label={pr.moveUp} disabled={i === 0} onClick={() => setList(move(list, i, -1))}>↑</button>
                <button type="button" className={iconButton} aria-label={pr.moveDown} disabled={i === list.length - 1} onClick={() => setList(move(list, i, 1))}>↓</button>
                <button type="button" className={dangerButton} aria-label={pr.removePreset} onClick={() => setList(list.filter((_, j) => j !== i))}>✕</button>
              </div>
            )}
          </div>
          {sec.errors[`name:${i}`] && <p className="text-sm font-medium text-status-refused-fg">{sec.errors[`name:${i}`]}</p>}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">{pr.values}</span>
            <ul className="flex flex-wrap gap-2">
              {preset.values.map((value, k) => (
                <li key={`${value}-${k}`} className="flex items-center gap-1 rounded-full border border-bo-border bg-bo-page py-0.5 pl-3 pr-0.5">
                  <span className="text-sm">{value}</span>
                  {!readOnly && (
                    <>
                      <button type="button" aria-label={`${pr.moveUp}: ${value}`} disabled={k === 0} className="inline-flex h-9 w-7 items-center justify-center text-bo-muted disabled:opacity-30" onClick={() => patch(i, { values: move(preset.values, k, -1) })}>‹</button>
                      <button type="button" aria-label={`${pr.moveDown}: ${value}`} disabled={k === preset.values.length - 1} className="inline-flex h-9 w-7 items-center justify-center text-bo-muted disabled:opacity-30" onClick={() => patch(i, { values: move(preset.values, k, 1) })}>›</button>
                      <button type="button" aria-label={fill(pr.removeValue, { value })} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-status-refused-fg hover:bg-status-refused-bg" onClick={() => patch(i, { values: preset.values.filter((_, j) => j !== k) })}>✕</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {sec.errors[`values:${i}`] && <p className="text-sm font-medium text-status-refused-fg">{sec.errors[`values:${i}`]}</p>}
            {!readOnly && (
              <div className="flex flex-wrap gap-2">
                <input
                  aria-label={`${pr.addValue}: ${preset.name}`}
                  placeholder={pr.valuePlaceholder}
                  value={drafts[i] ?? ""}
                  maxLength={60}
                  onChange={(e) => setDrafts({ ...drafts, [i]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addValue(i);
                    }
                  }}
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <button type="button" className={secondaryButton} onClick={() => addValue(i)}>{pr.addValue}</button>
                <button type="button" className={secondaryButton} title={pr.smartSortHint} onClick={() => patch(i, { values: smartSizeSort(preset.values) })}>
                  {pr.smartSort}
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
      {!readOnly && (
        <div className="flex flex-col gap-1">
          <button type="button" className={`${secondaryButton} w-fit`} disabled={list.length >= 30} onClick={() => setList([...list, { name: "", values: [] }])}>
            + {pr.addPreset}
          </button>
          <p className="text-sm text-bo-muted">{pr.smartSortHint}</p>
        </div>
      )}
    </SectionCard>
  );
}
