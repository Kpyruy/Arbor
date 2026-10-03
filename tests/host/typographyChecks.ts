import { createOverviewSnapshot } from "../../src/view/export/overviewSnapshot";
import type { MarkdownPort } from "../../src/view/state/viewTypes";

interface TypographyHostInput {
  document: Document;
  stylesheet: string;
  markdown: MarkdownPort;
}

/** Real CSS cascade checks; run in Obsidian, not a Node DOM mock. */
export async function checkArborTypographyHost(input: TypographyHostInput): Promise<{ checks: number }> {
  const doc = input.document;
  const view = doc.defaultView;
  if (!view) throw new Error("Typography checks need a browser document");
  const failures: string[] = [];
  let checks = 0;
  const assertFont = (element: Element, expected: string, label: string) => {
    checks += 1;
    const actual = view.getComputedStyle(element).fontFamily;
    if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
  };
  const style = new CSSStyleSheet();
  style.replaceSync(input.stylesheet);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, style];
  const fixture = doc.body.createDiv({ cls: "arbor-typography-host-fixture arbor-view" });
  fixture.setCssStyles({ position: "fixed", left: "-10000px", width: "1024px", opacity: "0", pointerEvents: "none", fontFamily: "var(--font-interface)" });
  const variables = {
    "--font-text": "Georgia, serif",
    "--font-interface": "Arial, sans-serif",
    "--font-monospace": "monospace",
    "--h2-font": '"Courier New", monospace',
    "--bw-content-zoom": "1"
  };
  fixture.setCssProps(variables);
  let override: CSSStyleSheet | null = null;
  let snapshot: Awaited<ReturnType<typeof createOverviewSnapshot>> | null = null;
  const markdown = "## Heading\n\nText with **emphasis**, [a link](https://example.org) and `code`.\n\n- List item\n\n> Quote";
  try {
    const button = fixture.createEl("button", { cls: "arbor-theme-button", text: "Theme" });
    const contents: HTMLElement[] = [];
    for (const cls of ["arbor-card-content", "arbor-overview-card-content", "arbor-preview-block-body", "arbor-output-preview-block"]) {
      const content = fixture.createDiv({ cls: `${cls} markdown-rendered` });
      await input.markdown.render(markdown, content, "");
      contents.push(content);
      for (const selector of ["p", "li", "blockquote p", "strong", "a"]) {
        const element = content.querySelector(selector);
        if (!element) throw new Error(`Markdown fixture is missing ${selector}`);
        assertFont(element, "Georgia, serif", `${cls} ${selector}`);
      }
      const code = content.querySelector("code");
      const heading = content.querySelector("h2");
      if (!code || !heading) throw new Error("Markdown fixture is missing code or heading");
      assertFont(code, "monospace", `${cls} code`);
      assertFont(heading, '"Courier New", monospace', `${cls} heading override`);
    }
    const linear = fixture.createDiv({ cls: "arbor-preview-content markdown-rendered" });
    await input.markdown.render("Linear text", linear, "");
    assertFont(linear.querySelector("p")!, "Georgia, serif", "Linear preview");
    const output = fixture.createDiv({ cls: "arbor-output-preview-content" });
    const prefix = output.createDiv({ cls: "arbor-output-preview-prefix markdown-rendered" });
    await input.markdown.render("Output prefix", prefix, "");
    assertFont(prefix.querySelector("p")!, "Georgia, serif", "Output prefix");
    const editor = fixture.createEl("textarea", { cls: "arbor-editor" });
    const overviewEditor = fixture.createEl("textarea", { cls: "arbor-editor arbor-overview-editor-input" });
    assertFont(editor, "Georgia, serif", "Branch editor");
    assertFont(overviewEditor, "Georgia, serif", "Overview editor");
    assertFont(button, "Arial, sans-serif", "Toolbar font remains unchanged");

    // Settings changes must propagate without rerendering the Markdown.
    fixture.setCssProps({ "--font-text": '"Times New Roman", serif' });
    assertFont(contents[0].querySelector("p")!, '"Times New Roman", serif', "Updated text font");
    assertFont(editor, '"Times New Roman", serif', "Updated editor font");
    fixture.setCssProps({ "--font-text": "Georgia, serif" });
    fixture.toggleClass("is-compact", true);
    fixture.toggleClass("has-touch-controls", true);
    fixture.toggleClass("is-rtl", true);
    assertFont(contents[0].querySelector("p")!, "Georgia, serif", "Compact RTL branch");
    assertFont(contents[1].querySelector("p")!, "Georgia, serif", "Compact RTL overview");

    override = new CSSStyleSheet();
    override.replaceSync('.arbor-typography-host-fixture .arbor-card-content { font-family: "Times New Roman", serif; }');
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, override];
    assertFont(contents[0].querySelector("p")!, '"Times New Roman", serif', "User snippet override");
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((sheet) => sheet !== override);
    override = null;

    snapshot = await createOverviewSnapshot({
      document: doc,
      metadata: { version: 1, prefix: "", blocks: [{ id: "font-root", parentId: null, order: 0, content: markdown, after: "" }] },
      selectedBlockId: "font-root", sourcePath: "", cardWidth: 300, direction: "ltr", snippetLength: 200,
      themeVariables: variables, textMuted: "#888888", markdown: input.markdown,
      waitForNextPaint: async () => { await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve())); }
    });
    const exported = snapshot.frame.querySelector(".arbor-overview-card-content p");
    if (!exported) throw new Error("Export snapshot did not render Markdown");
    assertFont(exported, "Georgia, serif", "Export snapshot");
    if (failures.length) throw new Error(`${failures.length}/${checks} typography checks failed:\n${failures.join("\n")}`);
    return { checks };
  } finally {
    snapshot?.dispose();
    fixture.remove();
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((sheet) => sheet !== style && sheet !== override);
  }
}
