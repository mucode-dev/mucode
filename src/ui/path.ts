import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import type { PickerOption } from "../types.ts";

export function pathOptions(input: string, baseDirectory: string, completionInput = input): PickerOption[] {
  const query = pathQuery(input);
  const completionQuery = pathQuery(completionInput);
  const effectiveQuery = query || "~/";
  const options: PickerOption[] = [
    {
      label: "use path",
      value: "__use__",
      description: effectiveQuery,
    },
  ];

  for (const completion of pathCompletions(completionQuery || "~/", baseDirectory)) {
    options.push({
      label: completion.label,
      value: completion.value,
      description: completion.description,
    });
  }

  return options;
}

export function pathInputForOption(value: string): string {
  const normalized = value.endsWith("/") && value.length > 1 ? value.slice(0, -1) : value;
  return `/path ${normalized}`;
}

function pathQuery(input: string): string {
  const match = /^\/path(?:\s+(.*))?$/u.exec(input.trimStart());
  return match ? (match[1] ?? "") : "";
}

function pathCompletions(query: string, baseDirectory: string): PickerOption[] {
  const home = Bun.env.HOME ?? "";
  const expanded = query === "~" || query.startsWith("~/") ? `${home}${query.slice(1)}` : query;
  const absoluteQuery = isAbsolute(expanded) ? expanded : resolve(baseDirectory, expanded || ".");
  const queryEndsWithSeparator = query.endsWith("/");
  const directoryToRead = queryEndsWithSeparator ? absoluteQuery : dirname(absoluteQuery);
  const namePrefix = queryEndsWithSeparator ? "" : basename(absoluteQuery);
  const queryBase = queryEndsWithSeparator
    ? query
    : query.slice(0, Math.max(0, query.length - namePrefix.length));

  try {
    return readdirSync(directoryToRead, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith(namePrefix) &&
          (namePrefix.startsWith(".") || !entry.name.startsWith(".")),
      )
      .sort((first, second) => first.name.localeCompare(second.name))
      .slice(0, 8)
      .map((entry) => {
        const value = `${queryBase}${entry.name}/`;
        return {
          label: `${entry.name}/`,
          value,
          description: "",
        };
      });
  } catch {
    return [];
  }
}

export function commonPrefixLength(first: string, second: string): number {
  const length = Math.min(first.length, second.length);
  let index = 0;
  while (index < length && first[index] === second[index]) {
    index += 1;
  }
  return index;
}

export function parsePathCommand(input: string): string | null {
  const match = /^\/path(?:\s+(.+))?$/u.exec(input.trim());
  return match ? (match[1]?.trim() ?? "") : null;
}

export function resolveWorkingDirectory(input: string, baseDirectory: string): string {
  const expanded =
    input === "~" || input.startsWith("~/") ? `${Bun.env.HOME ?? ""}${input.slice(1)}` : input;
  const candidate = isAbsolute(expanded) ? expanded : resolve(baseDirectory, expanded);
  const resolved = realpathSync(candidate);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`Not a directory: ${input}`);
  }
  return resolved;
}
