function mask(text: string): string {
  return text.replace(/[^\r\n]/g, " ");
}

export function maskCodeExamples(text: string, maskUnclosedFences = true): string {
  let fence: { character: string; length: number; quoteDepth: number; listIndent: number } | null = null;
  let fenceStart = 0;
  let listIndent = 0;
  let paragraphOpen = false;
  const visible: string[] = [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  for (const line of lines) {
    const quotePrefix = line.match(/^(?: {0,3}> ?)+/)?.[0] ?? "";
    const quoteDepth = (quotePrefix.match(/>/g) ?? []).length;
    const unquoted = line.slice(quotePrefix.length);
    const indentation = unquoted.match(/^ */)![0].length;
    if (!unquoted.trim()) {
      paragraphOpen = false;
      visible.push(line);
      continue;
    }
    if (fence && (quoteDepth < fence.quoteDepth || indentation < fence.listIndent)) fence = null;
    const listPrefix = unquoted.match(/^ {0,3}(?:[-+*]|\d{1,9}[.)]) +/)?.[0];
    if (!fence) {
      if (listPrefix) listIndent = listPrefix.length;
      else if (indentation < listIndent) listIndent = 0;
    }
    const codeLine = listPrefix ? unquoted.slice(listPrefix.length) : unquoted.slice(listIndent);
    const delimiter = codeLine.replace(/\r?\n$/, "").match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.character && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null;
      paragraphOpen = false;
      visible.push(mask(line));
    } else if (delimiter && (delimiter[1][0] !== "`" || !delimiter[2].includes("`"))) {
      fence = { character: delimiter[1][0], length: delimiter[1].length, quoteDepth, listIndent };
      fenceStart = visible.length;
      paragraphOpen = false;
      visible.push(mask(line));
    } else if (!paragraphOpen && /^(?: {4}|\t)/.test(codeLine)) {
      visible.push(mask(line));
    } else {
      paragraphOpen = !/^ {0,3}#{1,6}(?:[ \t]|$)/.test(codeLine);
      visible.push(line);
    }
  }
  if (fence && !maskUnclosedFences) {
    for (let lineIndex = fenceStart; lineIndex < lines.length; lineIndex++) visible[lineIndex] = lines[lineIndex];
  }
  return visible.join("").split(/(\r?\n[ \t]*\r?\n)/)
    .map(block => block.replace(/(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, mask)).join("");
}
