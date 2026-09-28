// Compares two versions of a text file line by line and keeps only the changed
// lines plus a little surrounding context, so a review shows what publishing
// changes instead of two complete files.
const MAX_COMPARED_CELLS = 1_000_000;
const hasCrlf = text => text.includes('\r\n');

export function lineChanges(before, after, context = 2) {
  // Windows line endings would otherwise make every line look changed, so they are reported once instead.
  const endings = hasCrlf(before) === hasCrlf(after) ? '' : hasCrlf(after) ? 'CRLF' : 'LF';
  const a = before.replace(/\r\n/g, '\n').split('\n'), b = after.replace(/\r\n/g, '\n').split('\n');
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  // `line` is the position in the new file, which is what the reviewer edits.
  const rows = [];
  const push = (kind, text, line) => rows.push({ kind, text, line });
  for (let index = 0; index < start; index++) push('same', a[index], index + 1);
  const n = endA - start, m = endB - start;
  if (n && m && n * m <= MAX_COMPARED_CELLS) {
    // A longest common subsequence keeps unchanged lines between separate edits out of the change list.
    const width = m + 1, table = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = a[start + i] === b[start + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) { push('same', b[start + j], start + j + 1); i++; j++; }
      else if (j === m || (i < n && table[(i + 1) * width + j] >= table[i * width + j + 1])) { push('removed', a[start + i], start + j + 1); i++; }
      else { push('added', b[start + j], start + j + 1); j++; }
    }
  } else {
    // Very large rewrites are listed as one replaced block rather than compared line by line.
    for (let i = start; i < endA; i++) push('removed', a[i], start + 1);
    for (let j = start; j < endB; j++) push('added', b[j], j + 1);
  }
  for (let j = endB; j < b.length; j++) push('same', b[j], j + 1);

  const keep = new Uint8Array(rows.length);
  let added = 0, removed = 0;
  rows.forEach((row, index) => {
    if (row.kind === 'same') return;
    if (row.kind === 'added') added++; else removed++;
    for (let k = Math.max(0, index - context); k <= Math.min(rows.length - 1, index + context); k++) keep[k] = 1;
  });
  const hunks = [];
  let hunk = null;
  rows.forEach((row, index) => {
    if (!keep[index]) { hunk = null; return; }
    if (!hunk) hunks.push(hunk = { line: row.line, rows: [] });
    hunk.rows.push(row);
  });
  return { hunks, added, removed, endings };
}
