// ProseMirror (used by the Tiptap rich text editor) measures selections when
// scrolling them into view; jsdom has no layout engine, so provide empty rects.
const emptyRects = (): DOMRectList =>
  Object.assign([] as DOMRect[], { item: () => null }) as unknown as DOMRectList
const emptyRect = (): DOMRect => new DOMRect(0, 0, 0, 0)

if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= emptyRects
  Range.prototype.getBoundingClientRect ??= emptyRect
}
if (typeof Element !== "undefined") {
  Element.prototype.getClientRects ??= emptyRects
}
if (typeof document !== "undefined") {
  document.elementFromPoint ??= () => null
}
