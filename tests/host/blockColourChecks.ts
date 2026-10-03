import { syncCardColour } from "../../src/view/appearance/cardColours";
import { createOverviewSnapshot } from "../../src/view/export/overviewSnapshot";
import type { MarkdownPort } from "../../src/view/state/viewTypes";
import { resolveBlockColors } from "../../src/model/blockAppearance";
import type { BranchTreeMetadata } from "../../src/types";

export async function checkBlockColoursHost(input: {
  document: Document;
  markdown: MarkdownPort;
  waitForNextPaint(): Promise<void>;
}): Promise<{ checks: number }> {
  const doc = input.document;
  const win = doc.defaultView;
  if (!win) throw Error("Browser required");
  let checks = 0;
  const check = (ok: boolean, label: string) => { checks += 1; if (!ok) throw Error(label); };
  const fixture = doc.body.createDiv({ cls: "arbor-view arbor-colour-host-fixture" });
  fixture.setCssStyles({ position: "fixed", left: "-10000px", opacity: "0", pointerEvents: "none" });
  let snapshot: Awaited<ReturnType<typeof createOverviewSnapshot>> | null = null;
  try {
    for (const palette of [
      { background: "#22242d", text: "#f2f2f7" },
      { background: "#fffdf6", text: "#2a2520" },
      { background: "#192a23", text: "#eef7f2" }
    ]) {
      fixture.setCssProps({ "--background-secondary": palette.background, "--text-normal": palette.text });
      for (const cls of ["arbor-card", "arbor-overview-card"]) {
      const card = fixture.createDiv({ cls });
      card.setCssStyles({ transition: "none" });
      const content = card.createDiv({ cls: cls === "arbor-card" ? "arbor-card-content markdown-rendered" : "arbor-overview-card-content markdown-rendered" });
      await input.markdown.render("Text with `code`", content, "");
      const paragraph = content.querySelector("p")!;
      const code = content.querySelector("code")!;
      const before = win.getComputedStyle(card).backgroundColor;
      const text = win.getComputedStyle(paragraph).color;
      const mono = win.getComputedStyle(code).fontFamily;
      syncCardColour(card, {color:"#44aa88",source:"inherited",ruleBlockId:"root"});
      check(card.classList.contains("has-block-colour"), `${cls} receives colour class`);
      check(card.style.getPropertyValue("--arbor-block-color") === "#44aa88", `${cls} receives effective colour`);
      check(win.getComputedStyle(card).backgroundColor !== before, `${cls} receives tint`);
      check(win.getComputedStyle(paragraph).color === text, `${cls} keeps text colour`);
      check(win.getComputedStyle(code).fontFamily === mono, `${cls} keeps code font`);
      card.addClass("is-output-excluded-direct");
      check(win.getComputedStyle(card).borderTopStyle === "dashed", `${cls} preserves excluded dashes`);
      card.addClass("is-active");
      check(win.getComputedStyle(card).boxShadow !== "none", `${cls} preserves selection indicator`);
      card.removeClass("is-active", "is-output-excluded-direct");
      syncCardColour(card, null);
      check(!card.classList.contains("has-block-colour") && !card.style.getPropertyValue("--arbor-block-color"), `${cls} removes stale colour`);
      check(win.getComputedStyle(card).backgroundColor === before, `${cls} resets to theme`);
      card.remove();
      }
    }
    snapshot = await createOverviewSnapshot({
      document: doc,
      metadata: {version:1,prefix:"",blocks:[
        {id:"root",parentId:null,order:0,content:"Root",after:"",appearance:{branchColor:"#44aa88"}},
        {id:"child",parentId:"root",order:0,content:"Child",after:"",appearance:{cardColor:"#9966dd"}},
        {id:"leaf",parentId:"child",order:0,content:"Leaf",after:""}
      ]},
      selectedBlockId:null,sourcePath:"",cardWidth:200,direction:"ltr",snippetLength:100,
      themeVariables:{},textMuted:"#888888",markdown:input.markdown,
      waitForNextPaint:()=>input.waitForNextPaint()
    });
    for (const [id, colour] of [["root", "#44aa88"], ["child", "#9966dd"], ["leaf", "#44aa88"]]) {
      const card = snapshot.frame.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      check(card?.style.getPropertyValue("--arbor-block-color") === colour, `Export preserves ${id} effective colour`);
    }
    return {checks};
  } finally {
    snapshot?.dispose();
    fixture.remove();
  }
}

/** Supplied ports must drive the real installed view and native dialog on a QA note. */
export async function checkBlockColourDialogHost(input: {
  document: Document;
  blockId: string;
  readMetadata(): BranchTreeMetadata;
  openColour(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
}): Promise<{ checks: number }> {
  let checks = 0;
  const check = (ok: boolean, label: string) => { checks += 1; if (!ok) throw Error(label); };
  const own = () => input.readMetadata().blocks.find(b => b.id === input.blockId)?.appearance?.cardColor;
  const original = own();
  const button = (label: string) => {
    const found = Array.from(input.document.querySelectorAll<HTMLButtonElement>(".arbor-block-colour-modal button")).find(b => b.textContent === label);
    if (!found) throw Error(`Missing native button ${label}`);
    return found;
  };
  const hex = () => {
    const found = input.document.querySelector<HTMLInputElement>(".arbor-block-colour-modal input[type=text]");
    if (!found) throw Error("Missing native HEX input");
    return found;
  };
  const enter = (value: string) => { const field = hex(); field.value = value; field.dispatchEvent(new Event("input", {bubbles:true})); };
  const before = JSON.stringify(input.readMetadata());
  try {
  let pending = input.openColour();
  enter("url(bad)");
  check(button("Apply").disabled, "Invalid HEX disables native Apply");
  check(JSON.stringify(input.readMetadata()) === before, "Draft leaves actual note metadata unchanged");
  button("Cancel").click();
  await pending;
  check(JSON.stringify(input.readMetadata()) === before, "Cancel leaves actual note metadata unchanged");
  pending = input.openColour();
  enter("#559BDD");
  check(!button("Apply").disabled, "Valid HEX enables Apply");
  button("Apply").click();
  await pending;
  check(own() === "#559bdd", "Actual dialog persists canonical colour");
  await input.undo();
  check(own() === original, "Actual document undo restores colour");
  await input.redo();
  check(own() === "#559bdd", "Actual document redo restores applied colour");
  pending = input.openColour();
  button("Use inherited / theme color").click();
  button("Apply").click();
  await pending;
  check(own() === undefined, "Actual reset removes card override");
  check(resolveBlockColors(input.readMetadata()).get(input.blockId)?.color === "#44aa88", "Actual reset restores ancestor green");
  return {checks};
  } finally {
    const modal = input.document.querySelector(".arbor-block-colour-modal");
    if (modal) button("Cancel").click();
    if (input.readMetadata().blocks.some(b => b.id === input.blockId) && own() !== original) {
      const restore = input.openColour();
      if (original) enter(original);
      else button("Use inherited / theme color").click();
      button("Apply").click();
      await restore;
    }
  }
}
