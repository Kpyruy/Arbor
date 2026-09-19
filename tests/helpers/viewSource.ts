import { readFileSync } from "node:fs";
import * as ts from "typescript";

export function readSource(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readSource(path), ts.ScriptTarget.Latest, true);
}

export function sourceClass(path: string, className: string): string {
  const file = sourceFile(path);
  const owner = file.statements.find((statement): statement is ts.ClassDeclaration =>
    ts.isClassDeclaration(statement) && statement.name?.text === className);
  if (!owner) throw new Error(`Missing class ${className} in ${path}`);
  return owner.getText(file);
}

export function sourceMethod(path: string, className: string, methodName: string): string {
  const file = sourceFile(path);
  const owner = file.statements.find((statement): statement is ts.ClassDeclaration =>
    ts.isClassDeclaration(statement) && statement.name?.text === className);
  const method = owner?.members.find((member): member is ts.MethodDeclaration =>
    ts.isMethodDeclaration(member) && member.name.getText(file) === methodName);
  if (!method) throw new Error(`Missing method ${className}.${methodName} in ${path}`);
  return method.getText(file);
}

export function sourceFunction(path: string, functionName: string): string {
  const file = sourceFile(path);
  const declaration = file.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === functionName);
  if (!declaration) throw new Error(`Missing function ${functionName} in ${path}`);
  return declaration.getText(file);
}
