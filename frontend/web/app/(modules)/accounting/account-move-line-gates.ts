type Row = Record<string, unknown>;

function stateTag(value: unknown): string {
  if (value != null && typeof value === 'object' && 'tag' in value) return String((value as { tag: unknown }).tag);
  return String(value ?? '');
}

/**
 * `delete_account_move_line` refuses lines of a posted move. A line whose move is not among the loaded
 * moves stays applicable, so the server still has the last word.
 */
export function accountMoveLineCanBeDeleted(line: Row, moves: readonly Row[]): boolean {
  const moveId = line.moveId ?? line.move_id;
  if (moveId == null) return true;
  const move = moves.find((candidate) => String(candidate.id) === String(moveId));
  return move == null || stateTag(move.state) === 'Draft';
}
