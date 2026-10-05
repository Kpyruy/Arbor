import { LocalHeadingLinks, readHeadingLinker } from "../../src/view/navigation/LocalHeadingLinks";
/* eslint-disable obsidianmd/ui/sentence-case -- Fixture strings intentionally test lowercase terms and uppercase aliases. */

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

/** Helper-created fragments must still belong to the rendered node's document. */
export function checkLocalHeadingOwnerDocumentHost(): number {
  const owner = document.implementation.createHTMLDocument("Heading links QA");
  const root = owner.adoptNode(window.createDiv({ text: "Before signal after." }));
  const text = root.textContent;
  const provider = {
    identity: {}, signature: "owner-document", targets: new Set(["Tree#Signal"]),
    findMatches: () => [{ start: 7, end: 13, linktext: "Tree#Signal" }]
  };
  const decorator = new LocalHeadingLinks(() => provider);
  decorator.decorate(root, "QA/Tree.md");
  const anchor = root.querySelector<HTMLAnchorElement>("a.arbor-local-heading-link");
  check(anchor?.ownerDocument === owner, "Helper created the link in the wrong owner document");
  check(anchor?.getAttribute("data-href") === "QA/Tree.md#Signal", "Helper changed the local link target");
  check(root.textContent === text && anchor?.textContent === "signal", "Helper changed visible wording");
  decorator.decorate(root, "QA/Tree.md");
  check(root.querySelector("a") === anchor, "Stable decoration replaced its link");
  decorator.decorate(root, "QA/Tree.md", null);
  check(!root.querySelector("a") && root.textContent === text, "Removing decoration changed the source text");
  return 5;
}

/** Runs in the actual Obsidian DOM using the loaded Heading Linker API. */
export function checkLocalHeadingDecorationHost(plugin: unknown, sourcePath: string): { generatedLinks: number; protectedContexts: number } {
  let provider = readHeadingLinker(plugin, sourcePath, {});
  check(provider, "Heading Linker provider is unavailable");
  const root = document.createDocumentFragment().createDiv({ cls: "arbor-card-content markdown-rendered" });
  const paragraph = root.createEl("p", { text: "A neural signal produces a synaptic response. NS is an alias." });
  const protectedNodes = [
    root.createEl("code", { text: "neural signal" }),
    root.createEl("pre").createEl("code", { text: "neural signal" }),
    root.createEl("h2", { text: "Neural signal" }),
    root.createEl("a", { href: "https://example.org", text: "neural signal" }),
    root.createDiv({ cls: "math", text: "neural signal" }),
    root.createDiv({ cls: "internal-embed", text: "neural signal" })
  ];
  const originalText = root.textContent;
  const decorator = new LocalHeadingLinks(() => provider);
  try {
    decorator.decorate(root, sourcePath);
    const links = Array.from(paragraph.querySelectorAll("a.arbor-local-heading-link"));
    check(links.length === 3, `Generated ${links.length} local links instead of 3`);
    check(links.map((a) => a.textContent).join("|") === "neural signal|synaptic response|NS", "Visible wording changed");
    check(links[0].getAttribute("data-href") === sourcePath + "#Neural signal", "Wrong first heading target");
    check(links[1].getAttribute("data-href") === sourcePath + "#Synaptic response", "Wrong second heading target");
    check(root.textContent === originalText, "Decoration changed the rendered text");
    for (const node of protectedNodes) check(!node.querySelector("a.arbor-local-heading-link"), "Protected content was linked");
    decorator.decorate(root, sourcePath);
    check(paragraph.querySelector("a.arbor-local-heading-link") === links[0], "Unchanged decoration replaced an anchor");
    check(paragraph.querySelectorAll("a").length === 3, "Decoration duplicated links");
    provider = null;
    decorator.decorate(root, sourcePath);
    check(!root.querySelector("a.arbor-local-heading-link"), "Disabled provider left generated anchors behind");
    check(root.textContent === originalText, "Removing decoration changed text");
    check(protectedNodes[3].getAttribute("href") === "https://example.org", "Existing anchor was changed");
    return { generatedLinks: links.length, protectedContexts: protectedNodes.length };
  } finally { root.remove(); }
}
