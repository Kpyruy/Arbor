import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import type { ArborView } from "../src/view/ArborView";

type RequiredCommandApi = {
  selectBlock(id: string | null, options?: { focus?: boolean; reveal?: boolean }): void;
  handleFileModified: ArborView["handleFileModified"];
  refreshView(): Promise<void>;
  refreshLayoutDirection(): Promise<void>;
  exportCleanCopy(): Promise<void>;
  exportTreeOverview(): Promise<void>;
  openTreeOverview(): void; closeTreeOverview(): void;
  openOutputPreview(): void; closeOutputPreview(): void;
  createRootBlock(): Promise<void>; createSiblingAbove(): Promise<void>; createSiblingBelow(): Promise<void>;
  createChild(): Promise<void>; createParentLevelBlock(): Promise<void>;
  moveSelectedUp(): Promise<void>; moveSelectedDown(): Promise<void>;
  moveSelectedLeft(): Promise<void>; moveSelectedRight(): Promise<void>;
  deleteSelectedBlock(): Promise<void>; deleteSelectedSubtree(): Promise<void>;
  duplicateSelectedBlock(): Promise<void>; duplicateSelectedSubtree(): Promise<void>;
  selectParentBlock(): void; selectPreviousSiblingBlock(): void; selectNextSiblingBlock(): void;
  selectFirstChildBlock(): void; selectPreferredChildBlock(): void;
  selectFirstSiblingBlock(): void; selectLastSiblingBlock(): void;
  openActiveBlockMenu(): void; toggleEditMode(): void;
  revealCurrentBlockInMarkdown(): Promise<void>;
  rebuildLinearMarkdownFromTree(): Promise<void>; rebuildTreeFromMetadata(): Promise<void>;
  undo(): Promise<void>; redo(): Promise<void>;
};

export function checkCommandApi(view: ArborView): RequiredCommandApi {
  return view;
}

type ModuleReference = { specifier: string; typeOnly: boolean };

const root = resolve(process.cwd(), "src");
const viewRoot = resolve(root, "view");
const documentIoMethods = new Set(["process", "modify", "write"]);

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []
  );
}

function sourceFile(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2020, true);
}

function namedSpecifiersAreTypeOnly(named: ts.NamedImports | ts.NamedExports): boolean {
  return named.elements.length > 0 && named.elements.every((specifier) => specifier.isTypeOnly);
}

function hasTypeOnlyDeclarationFlag(node: ts.ImportClause | ts.ExportDeclaration): boolean {
  return "phaseModifier" in node
    ? node.phaseModifier === ts.SyntaxKind.TypeKeyword
    : (node as { isTypeOnly: boolean }).isTypeOnly;
}

function isTypeOnlyImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (!clause || hasTypeOnlyDeclarationFlag(clause) || clause.name || !clause.namedBindings) {
    return Boolean(clause && hasTypeOnlyDeclarationFlag(clause));
  }
  return ts.isNamedImports(clause.namedBindings) && namedSpecifiersAreTypeOnly(clause.namedBindings);
}

function isTypeOnlyExport(statement: ts.ExportDeclaration): boolean {
  if (hasTypeOnlyDeclarationFlag(statement) || !statement.exportClause) {
    return hasTypeOnlyDeclarationFlag(statement);
  }
  return ts.isNamedExports(statement.exportClause) && namedSpecifiersAreTypeOnly(statement.exportClause);
}

function moduleReferences(source: ts.SourceFile): ModuleReference[] {
  return source.statements.flatMap((statement) => {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      return [{ specifier: statement.moduleSpecifier.text, typeOnly: isTypeOnlyImport(statement) }];
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      return [{ specifier: statement.moduleSpecifier.text, typeOnly: isTypeOnlyExport(statement) }];
    }
    return [];
  });
}

function resolveLocalModule(file: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const unresolved = resolve(dirname(file), specifier);
  return [unresolved, `${unresolved}.ts`, join(unresolved, "index.ts")]
    .find((candidate) => candidate.endsWith(".ts") && sourceFilesByPath.has(candidate)) ?? null;
}

function memberCallNames(source: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      names.push(node.expression.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function adapterKeys(source: ts.SourceFile, className: string): string[] {
  const keys: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === className
      && node.arguments?.[0]
      && ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties) {
        if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
          keys.push(property.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return keys;
}

const sourceFiles = files(root);
const sourceFilesByPath = new Map(sourceFiles.map((file) => [file, file]));
const controllerFiles = files(viewRoot).filter((file) => !["ArborView.ts", "ArborLoadingView.ts"].includes(relative(viewRoot, file)));

describe("Arbor view module boundaries", () => {
  it("keeps every extracted view submodule independent of the facade and main, including type imports and reexports", () => {
    const forbiddenTargets = new Set([resolve(viewRoot, "ArborView.ts"), resolve(root, "main.ts")]);

    expect(controllerFiles.length).toBeGreaterThan(20);
    for (const controller of controllerFiles) {
      const forbiddenReferences = moduleReferences(sourceFile(controller))
        .map(({ specifier }) => resolveLocalModule(controller, specifier))
        .filter((target): target is string => target !== null && forbiddenTargets.has(target));
      expect(forbiddenReferences, relative(root, controller)).toEqual([]);
    }
  });

  it("classifies declaration-wide and named type-only imports and reexports from the TypeScript AST", () => {
    const source = ts.createSourceFile(
      "type-only.ts",
      'import type { Declaration } from "./declaration"; import { type Named } from "./named"; export type { Reexport } from "./reexport"; export { type NamedReexport } from "./named-reexport"; import { Runtime } from "./runtime";',
      ts.ScriptTarget.ES2020,
      true
    );

    expect(moduleReferences(source)).toEqual([
      { specifier: "./declaration", typeOnly: true },
      { specifier: "./named", typeOnly: true },
      { specifier: "./reexport", typeOnly: true },
      { specifier: "./named-reexport", typeOnly: true },
      { specifier: "./runtime", typeOnly: false }
    ]);
  });

  it("keeps model and storage outside the view layer and has an acyclic runtime import graph", () => {
    for (const file of sourceFiles.filter((entry) => /\/(model|storage)\//.test(entry))) {
      const viewReferences = moduleReferences(sourceFile(file))
        .map(({ specifier }) => resolveLocalModule(file, specifier))
        .filter((target): target is string => target !== null && target.startsWith(`${viewRoot}/`));
      expect(viewReferences, relative(root, file)).toEqual([]);
    }

    const graph = new Map(sourceFiles.map((file) => [
      relative(root, file).replace(/\.ts$/, ""),
      moduleReferences(sourceFile(file))
        .filter((reference) => !reference.typeOnly)
        .map((reference) => resolveLocalModule(file, reference.specifier))
        .filter((target): target is string => target !== null)
        .map((target) => relative(root, target).replace(/\.ts$/, ""))
    ]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (node: string): boolean => {
      if (visiting.has(node)) return false;
      if (visited.has(node)) return true;
      visiting.add(node);
      const acyclic = (graph.get(node) ?? []).every(visit);
      visiting.delete(node);
      visited.add(node);
      return acyclic;
    };

    expect([...graph.keys()].every(visit)).toBe(true);
  });

  it("routes document persistence through DocumentController while the facade supplies explicit IO adapters", () => {
    const documentController = sourceFile(resolve(viewRoot, "state/DocumentController.ts"));
    const facade = sourceFile(resolve(viewRoot, "ArborView.ts"));

    expect(new Set(memberCallNames(documentController).filter((name) => documentIoMethods.has(name)))).toEqual(new Set(["process"]));
    expect(memberCallNames(facade).filter((name) => documentIoMethods.has(name))).toEqual(["process"]);
    for (const file of controllerFiles.filter((file) => !file.endsWith("state/DocumentController.ts"))) {
      expect(
        memberCallNames(sourceFile(file)).filter((name) => documentIoMethods.has(name)),
        relative(root, file)
      ).toEqual([]);
    }

    expect(adapterKeys(facade, "DocumentController")).toContain("process");
    expect(adapterKeys(facade, "EditorAttachments")).toContain("createBinary");
    expect(adapterKeys(facade, "ExportController")).toEqual(expect.arrayContaining(["createCleanCopy", "createTreeExport"]));
  });
});
