export interface HeadingProviderSnapshot {
  identity: object;
  signature: string;
  targets: ReadonlySet<string>;
  findMatches(text: string): unknown;
}

export interface LocalHeadingMatch { start: number; end: number; linktext: string }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

/** Observe a loaded provider independently of whether this note is currently eligible. */
export function readHeadingLinkerObserver(plugin: unknown): { identity: object; subscribe(callback: () => void): (() => void) | null } | null {
  try {
    const api = record(record(plugin)?.api);
    if (!api || typeof api.onChange !== "function") return null;
    return {
      identity: api,
      subscribe: (callback) => {
        try {
          const cleanup: unknown = (api.onChange as (callback: () => void) => unknown).call(api, callback);
          return typeof cleanup === "function" ? () => { try { (cleanup as () => void)(); } catch { /* Optional cleanup must not break view disposal. */ } } : null;
        } catch { return null; }
      }
    };
  } catch { return null; }
}

function covers(list: unknown, path: string): boolean {
  return typeof list === "string" && list.split(/\r?\n/).some((entry) => {
    const normalized = entry.split("/").map((part) => part.trim()).filter((part) => part && part !== "." && part !== "..").join("/");
    return normalized !== "" && (path === normalized || path.startsWith(normalized + "/"));
  });
}

export function readHeadingLinker(plugin: unknown, sourcePath: string, frontmatter: unknown): HeadingProviderSnapshot | null {
  try {
    const p = record(plugin);
    const settings = record(p?.settings);
    const api = record(p?.api);
    const optOut = record(frontmatter)?.["heading-linker"];
    if (!settings?.highlightInReading || !api || typeof api.getTerms !== "function" || typeof api.findMatches !== "function"
      || optOut === false || (typeof optOut === "string" && ["false", "off", "no", "ignore", "disabled"].includes(optOut.trim().toLowerCase()))
      || covers(settings.excludeFolders, sourcePath)
      || (settings.scopeMode === "folders" && !covers(settings.scopeFolders, sourcePath))) return null;
    const terms: unknown = (api.getTerms as () => unknown).call(api);
    if (!Array.isArray(terms)) return null;
    const local = terms.filter((term: unknown) => record(term)?.path === sourcePath);
    const targets = new Set(local.flatMap((term: unknown) => {
      const linktext = record(term)?.linktext;
      return typeof linktext === "string" && linktext.includes("#") ? [linktext] : [];
    }));
    return {
      identity: api, signature: JSON.stringify([settings, local]), targets,
      findMatches: (text) => (api.findMatches as (text: string) => unknown).call(api, text)
    };
  } catch { return null; }
}

export function collectLocalHeadingMatches(text: string, snapshot: HeadingProviderSnapshot): LocalHeadingMatch[] {
  try {
    const matches = snapshot.findMatches(text);
    if (!Array.isArray(matches)) return [];
    const result: LocalHeadingMatch[] = [];
    let lastEnd = 0;
    for (const match of matches) {
      const m = record(match);
      const start = m?.start;
      const end = m?.end;
      if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end)
        || start < lastEnd || end <= start || end > text.length
        || (typeof m?.display === "string" && m.display !== text.slice(start, end))) continue;
      const alternatives: unknown[] = Array.isArray(m?.alts) ? m.alts : [];
      const candidates = new Set([m?.linktext, ...alternatives]
        .filter((target): target is string => typeof target === "string" && snapshot.targets.has(target)));
      if (candidates.size !== 1) continue;
      result.push({ start, end, linktext: [...candidates][0] });
      lastEnd = end;
    }
    return result;
  } catch { return []; }
}

export class LocalHeadingLinks {
  private readonly decorated = new WeakMap<HTMLElement, { identity: object | null; signature: string; path: string; text: string }>();

  constructor(private readonly getProvider: (sourcePath: string) => HeadingProviderSnapshot | null) {}

  decorate(content: HTMLElement, sourcePath: string, snapshot = this.getProvider(sourcePath)): void {
    const text = content.textContent ?? "";
    const previous = this.decorated.get(content);
    if (previous?.identity === (snapshot?.identity ?? null) && previous.signature === (snapshot?.signature ?? "")
      && previous.path === sourcePath && previous.text === text) return;

    for (const anchor of Array.from(content.querySelectorAll("a.arbor-local-heading-link"))) {
      anchor.replaceWith(...Array.from(anchor.childNodes));
    }
    content.normalize();
    if (snapshot?.targets.size) {
      const nodes: Text[] = [];
      const visit = (node: Node): void => {
        if (node.nodeType === 3) { nodes.push(node as Text); return; }
        if (node.nodeType !== 1) return;
        const element = node as HTMLElement;
        if (/^(A|CODE|PRE|H[1-6]|SCRIPT|STYLE|TEXTAREA|INPUT|SVG|MATH|MJX-CONTAINER)$/.test(element.tagName)
          || element.matches(".internal-embed, .math, .MathJax, .math-inline, .math-block")) return;
        element.childNodes.forEach(visit);
      };
      visit(content);
      for (const node of nodes) {
        const original = node.textContent ?? "";
        const matches = collectLocalHeadingMatches(original, snapshot);
        if (!matches.length || !node.parentNode) continue;
        const document = node.ownerDocument;
        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const match of matches) {
          fragment.appendChild(document.createTextNode(original.slice(cursor, match.start)));
          const href = sourcePath + match.linktext.slice(match.linktext.indexOf("#"));
          fragment.createEl("a", {
            cls: "internal-link heading-link arbor-local-heading-link",
            text: original.slice(match.start, match.end), href, attr: { "data-href": href }
          });
          cursor = match.end;
        }
        fragment.appendChild(document.createTextNode(original.slice(cursor)));
        node.parentNode.replaceChild(fragment, node);
      }
    }
    this.decorated.set(content, { identity: snapshot?.identity ?? null, signature: snapshot?.signature ?? "", path: sourcePath, text });
  }
}
