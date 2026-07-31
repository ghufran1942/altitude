import { uid } from "./util.js";

export const isHeading = (n) => n?.type === "heading";

/* A childless heading is a divider, not a unit of work, so it shouldn't drag a
   parent's bar down. Once it holds items it counts as one child like anything else. */
export function counts(n, kidsOf) {
  return !isHeading(n) || (kidsOf.get(n.id) || []).length > 0;
}

/* After any check or structural change: a parent is done iff every one of its
   counting children is done. Also returns the list in depth-first display order,
   so array position always mirrors the tree — drag and drop leans on that. */
export function rollUp(list) {
  const kidsOf = new Map();
  list.forEach((n) => {
    if (!kidsOf.has(n.parentId)) kidsOf.set(n.parentId, []);
    kidsOf.get(n.parentId).push(n);
  });
  const out = new Map(list.map((n) => [n.id, { ...n }]));
  const order = [];
  (function visit(id) {
    const kids = kidsOf.get(id) || [];
    kids.forEach((k) => { order.push(k.id); visit(k.id); });
    if (id === null) return;
    const counting = kids.filter((k) => counts(k, kidsOf));
    if (counting.length) out.get(id).done = counting.every((k) => out.get(k.id).done);
  })(null);
  const seen = new Set(order);
  list.forEach((n) => { if (!seen.has(n.id)) order.push(n.id); }); // keep orphans rather than lose them
  return order.map((id) => out.get(id));
}

/* Older saves carried `collapsed` (so, expanded by default) plus a now-dead
   `level` field. The tree is condensed by default now, so the flag is inverted. */
export function migrateNodes(list) {
  return list.map(({ collapsed, level, ...n }) => ({
    ...n,
    ...(collapsed === false ? { expanded: true } : {}),
  }));
}

/* Index just past the node at `i` and all of its descendants. Relies on the
   list being in depth-first order, which rollUp guarantees. */
export function endOfSubtree(list, i) {
  const own = new Set([list[i].id]);
  let at = i + 1;
  while (at < list.length && own.has(list[at].parentId)) { own.add(list[at].id); at++; }
  return at;
}

export function seedNodes() {
  return [{ id: uid(), parentId: null, title: "2026", done: false, deadline: null }];
}
