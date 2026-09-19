import type { ChangeOp } from "@tcw/shared";
import type { Fingerprint } from "./selector.js";

/**
 * Pure helpers for editing a variant's change-op list, plus an undo/redo store.
 * One op per (kind, selector[, attribute]) so a field edited twice replaces
 * its earlier value instead of stacking.
 */

function keyOf(o: ChangeOp): string {
  if (o.op === "attr") return `attr|${o.selector}|${o.name}`;
  if (o.op === "text" || o.op === "html") return `content|${o.selector}`; // text and html are mutually exclusive
  return `${o.op}|${o.selector}`;
}

export function upsertOp(ops: ChangeOp[], op: ChangeOp): ChangeOp[] {
  const k = keyOf(op);
  const i = ops.findIndex((o) => keyOf(o) === k);
  if (i === -1) return [...ops, op];
  const next = ops.slice();
  next[i] = op;
  return next;
}

export function removeOps(ops: ChangeOp[], pred: (o: ChangeOp) => boolean): ChangeOp[] {
  return ops.filter((o) => !pred(o));
}

type Target = { selector: string; fp?: Fingerprint };

/** Sets or clears (value null/"") one CSS property on the element, merging into its style op. */
export function setStyle(ops: ChangeOp[], t: Target, prop: string, value: string | null): ChangeOp[] {
  const existing = ops.find((o) => o.op === "style" && o.selector === t.selector);
  const styles: Record<string, string> = { ...(existing && existing.op === "style" ? existing.styles : {}) };
  if (value) styles[prop] = value;
  else delete styles[prop];
  if (Object.keys(styles).length === 0) return removeOps(ops, (o) => o.op === "style" && o.selector === t.selector);
  return upsertOp(ops, { op: "style", selector: t.selector, fp: t.fp, styles });
}

export function setText(ops: ChangeOp[], t: Target, value: string | null): ChangeOp[] {
  if (value === null) return removeOps(ops, (o) => (o.op === "text" || o.op === "html") && o.selector === t.selector);
  return upsertOp(ops, { op: "text", selector: t.selector, fp: t.fp, value });
}

export function setAttr(ops: ChangeOp[], t: Target, name: string, value: string | null): ChangeOp[] {
  if (value === null) return removeOps(ops, (o) => o.op === "attr" && o.selector === t.selector && o.name === name);
  return upsertOp(ops, { op: "attr", selector: t.selector, fp: t.fp, name, value });
}

export function setHidden(ops: ChangeOp[], t: Target, hidden: boolean): ChangeOp[] {
  if (!hidden) return removeOps(ops, (o) => o.op === "hide" && o.selector === t.selector);
  return upsertOp(ops, { op: "hide", selector: t.selector, fp: t.fp });
}

export function setGoal(ops: ChangeOp[], t: Target, name: string | null): ChangeOp[] {
  if (!name) return removeOps(ops, (o) => o.op === "goal" && o.selector === t.selector);
  return upsertOp(ops, { op: "goal", selector: t.selector, fp: t.fp, name });
}

/** What the sidebar shows for one element. */
export function readFields(ops: ChangeOp[], selector: string) {
  const mine = ops.filter((o) => o.selector === selector);
  const style = mine.find((o) => o.op === "style");
  const text = mine.find((o) => o.op === "text");
  const href = mine.find((o) => o.op === "attr" && o.name === "href");
  const goal = mine.find((o) => o.op === "goal");
  return {
    styles: style && style.op === "style" ? style.styles : {},
    text: text && text.op === "text" ? text.value : null,
    href: href && href.op === "attr" ? href.value : null,
    hidden: mine.some((o) => o.op === "hide"),
    goal: goal && goal.op === "goal" ? goal.name : null,
  };
}

const HISTORY_LIMIT = 100;

/** The variant's ops with undo/redo. Every mutation goes through commit(). */
export class OpStore {
  private past: ChangeOp[][] = [];
  private future: ChangeOp[][] = [];
  private listeners = new Set<() => void>();
  ops: ChangeOp[];
  /** Ops as last saved; used to know whether there is anything to save. */
  private saved: string;

  constructor(initial: ChangeOp[] = []) {
    this.ops = initial;
    this.saved = JSON.stringify(initial);
  }

  commit(next: ChangeOp[]): void {
    if (JSON.stringify(next) === JSON.stringify(this.ops)) return;
    this.past.push(this.ops);
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.ops = next;
    this.emit();
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.ops);
    this.ops = prev;
    this.emit();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.ops);
    this.ops = next;
    this.emit();
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get dirty(): boolean {
    return JSON.stringify(this.ops) !== this.saved;
  }
  markSaved(): void {
    this.saved = JSON.stringify(this.ops);
    this.emit();
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    this.listeners.forEach((fn) => fn());
  }
}
