import { createKalmHighlighter, resolveLanguage, themes } from '@kalm-lang/syntax-highlighting';

// Tokenize a complete block before layout, so comments/strings retain cross-line state.
export async function highlightCodeBlocks(tokens, normalize, themeName) {
  const highlighter = await createKalmHighlighter();
  try {
    function visit(list) {
      for (const token of list ?? []) {
        if (token.type === 'code') {
          const source = normalize(token.text).replace(/\r\n?/g, '\n').replaceAll('\t', '    ').replace(/\n$/, '');
          token.highlightedLines = highlighter.codeToTokens(source, {
            lang: resolveLanguage(token.lang ?? 'text'),
            theme: themes[themeName === 'dark' ? 'dark' : 'light'],
          }).tokens;
        }
        if (token.tokens) visit(token.tokens);
        for (const item of token.items ?? []) visit(item.tokens);
      }
    }
    visit(tokens);
  } finally { highlighter.dispose(); }
}

// Intersect absolute UTF-16 token offsets with a visual row. Hanging indentation
// is synthetic and must not consume source or advance its grammar state.
export function codeRuns(row, tokens) {
  const result = row.prefix ? [{ text: row.prefix }] : [];
  let cursor = row.sourceStart;
  for (const token of tokens ?? []) {
    const start = Math.max(row.sourceStart, token.offset);
    const end = Math.min(row.sourceEnd, token.offset + token.content.length);
    if (end <= start) continue;
    if (start > cursor) result.push({ text: row.sourceText.slice(cursor - row.sourceStart, start - row.sourceStart) });
    result.push({ text: token.content.slice(start - token.offset, end - token.offset), color: token.color });
    cursor = end;
  }
  if (cursor < row.sourceEnd) result.push({ text: row.sourceText.slice(cursor - row.sourceStart) });
  return result;
}
