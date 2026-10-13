type Row = Record<string, unknown>;

function isSet(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'object' && 'some' in (value as object)) return isSet((value as { some?: unknown }).some);
  return true;
}

/**
 * Category assignments (add/replace/remove/clear) reject a contact that is deleted or has been
 * merged into another contact.
 */
export function canManageContactCategories(contact: Row): boolean {
  return !isSet(contact.deletedAt ?? contact.deleted_at) && !isSet(contact.mergeTargetId ?? contact.merge_target_id);
}

/** `archive_contact_category` rejects a category that is already archived. */
export function canArchiveCategory(category: Row): boolean {
  return (category.isActive ?? category.is_active) !== false;
}

/** `replace_contact_categories` only accepts active categories, so only those are offered. */
export function activeCategories(categories: readonly Row[]): Row[] {
  return categories.filter(canArchiveCategory);
}
