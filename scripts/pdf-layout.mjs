// Pure layout decisions, shared by the PDF renderer and its boundary tests.
export function chooseLineCount(remaining, capacity, fullCapacity, { minLines = 2, keepTogether = 4 } = {}) {
  capacity = Math.max(0, Math.floor(capacity));
  fullCapacity = Math.max(1, Math.floor(fullCapacity));
  const minimum = Math.min(minLines, fullCapacity);
  if (remaining <= capacity) return remaining;
  if (capacity === 0) return 0;
  if (remaining <= keepTogether && remaining <= fullCapacity) return 0;
  if (capacity < minimum && capacity < fullCapacity) return 0;
  let count = Math.min(capacity, remaining);
  if (remaining - count < minimum) count = remaining - minimum;
  if (count < minimum && capacity < fullCapacity) return 0;
  return Math.max(1, count);
}

export function wrapCode(text, measure, width) {
  const rows = [];
  for (const [source, raw] of text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').entries()) {
    const line = raw.replaceAll('\t', '    ');
    const indent = /^ */.exec(line)[0];
    let rest = line;
    let continuation = false;
    do {
      // Keep source indentation on visual continuation lines, with a hanging indent.
      let prefix = continuation ? `${indent}    ` : '';
      while (prefix && measure(prefix) > width * 0.3) prefix = prefix.slice(1);
      const available = width - measure(prefix);
      let end = 0;
      let boundary = 0;
      let quote;
      let escaped = false;
      for (const char of rest) {
        if (measure(rest.slice(0, end) + char) > available && end > 0) break;
        end += char.length;
        if (escaped) { escaped = false; continue; }
        if (quote && char === '\\') { escaped = true; continue; }
        if (char === quote) quote = undefined;
        else if (!quote && ['"', "'", '`'].includes(char)) quote = char;
        if (!quote && /[\s,;=]/.test(char) && measure(rest.slice(0, end)) >= available * 0.45) boundary = end;
      }
      if (end < rest.length && boundary) end = boundary;
      const part = rest.slice(0, end);
      rows.push({ text: prefix + part, sourceText: part, source, continuation, breakAfter: false });
      rest = rest.slice(end);
      continuation = true;
    } while (rest.length);
    rows.at(-1).breakAfter = !line.trim() || /^[}\])]+[;,]?$/.test(line.trim());
  }
  return rows;
}

export function chooseCodeCount(rows, start, capacity, fullCapacity, { keepTogether = true } = {}) {
  let count = chooseLineCount(rows.length - start, capacity, fullCapacity, { minLines: 3, keepTogether: keepTogether ? fullCapacity : 0 });
  if (!count || start + count === rows.length) return count;
  const earliest = Math.max(3, Math.floor(count * 0.65));
  for (let offset = count; offset >= earliest; offset -= 1) {
    if (rows[start + offset - 1].breakAfter) { count = offset; break; }
  }
  // Never split a wrapped source line unless it is itself taller than a page.
  const source = rows[start + count - 1].source;
  if (rows[start + count]?.source === source) {
    let boundary = count;
    while (boundary > 0 && rows[start + boundary - 1].source === source) boundary -= 1;
    if (boundary > 0 && (boundary >= 3 || keepTogether)) count = boundary;
    else {
      const groupSize = rows.slice(start).findIndex((row) => row.source !== source);
      if (keepTogether && groupSize !== -1 && groupSize <= fullCapacity && capacity < fullCapacity) return 0;
    }
  }
  return count;
}

export function tableColumnWidths(preferred, total) {
  const minimum = Math.min(64, total / preferred.length * 0.7);
  const weights = preferred.map((width) => Math.max(1, Math.min(260, width) - minimum));
  const weight = weights.reduce((sum, value) => sum + value, 0);
  const remaining = total - minimum * preferred.length;
  const widths = weights.map((value) => minimum + remaining * value / weight);
  widths[widths.length - 1] += total - widths.reduce((sum, value) => sum + value, 0);
  return widths;
}
