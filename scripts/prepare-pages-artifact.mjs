import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const buildRoot = path.join(repositoryRoot, "build");
const defaultArtifactRoot = path.join(buildRoot, "pages-site");
const manifestName = "asset-manifest.json";
const releaseLength = 16;
const publicSiteUrl = "https://buicongnguyen.github.io/NPU/";
const quizDownloadJsonPaths = new Set([
  "data/analog-cim-architecture.json",
  "data/analog-cim-evidence.json",
  "data/analog-cim-mcq.json",
]);
const versionedHtmlAssetExtensions = new Set([".css", ".js", ".json"]);
const htmlReferencePattern =
  /(\b(?:href|src)\s*=\s*)(?:(["'])([^"']*)\2|([^\s"'=<>`]+))/gi;
const jsonReferencePattern =
  /(["'`])((?:\.\/)?data\/[A-Za-z0-9._/-]+\.json)(?:\?([^"'`#]*))?(#[^"'`]*)?\1/g;
const strictUtf8Decoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

// Keep the deploy surface explicit. Add a rule here when the site gains another
// required static-asset type or directory.
const deployableRules = [
  {
    kind: "root",
    extensions: [".css", ".html", ".js", ".svg"],
  },
  {
    kind: "tree",
    directory: "data",
    extensions: [".json"],
  },
  {
    kind: "tree",
    directory: "schemas",
    extensions: [".json"],
  },
];

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function assertDescendant(parentDirectory, candidateDirectory, label) {
  const relative = path.relative(parentDirectory, candidateDirectory);
  const escapesParent =
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);

  if (escapesParent) {
    throw new Error(`${label} must be a child of ${parentDirectory}`);
  }
}

async function collectTreeFiles(directory, allowedExtensions, relativePrefix) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => comparePaths(left.name, right.name));

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.join(relativePrefix, entry.name);

    if (entry.isSymbolicLink()) {
      throw new Error(`Deployable trees cannot contain symbolic links: ${relativePath}`);
    }

    if (entry.isDirectory()) {
      files.push(
        ...(await collectTreeFiles(absolutePath, allowedExtensions, relativePath)),
      );
      continue;
    }

    if (!entry.isFile()) {
      throw new Error(`Unsupported deployable entry type: ${relativePath}`);
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      throw new Error(
        `Unexpected file in deployable tree: ${relativePath}. ` +
          "Update deployableRules if this file belongs on the site.",
      );
    }

    files.push(toPosixPath(relativePath));
  }

  return files;
}

async function collectDeployablePaths() {
  const deployablePaths = [];

  for (const rule of deployableRules) {
    const allowedExtensions = new Set(rule.extensions);

    if (rule.kind === "root") {
      const entries = await readdir(repositoryRoot, { withFileTypes: true });
      entries.sort((left, right) => comparePaths(left.name, right.name));

      for (const entry of entries) {
        const extension = path.extname(entry.name).toLowerCase();
        if (!allowedExtensions.has(extension)) {
          continue;
        }
        if (entry.isSymbolicLink()) {
          throw new Error(`Root deployable files cannot be symbolic links: ${entry.name}`);
        }
        if (!entry.isFile()) {
          throw new Error(`Unsupported root deployable entry type: ${entry.name}`);
        }
        deployablePaths.push(entry.name);
      }
      continue;
    }

    if (rule.kind === "tree") {
      const treeRoot = path.join(repositoryRoot, rule.directory);
      const treeStats = await lstat(treeRoot);
      if (treeStats.isSymbolicLink() || !treeStats.isDirectory()) {
        throw new Error(`Deployable tree must be a real directory: ${rule.directory}`);
      }
      deployablePaths.push(
        ...(await collectTreeFiles(treeRoot, allowedExtensions, rule.directory)),
      );
      continue;
    }

    throw new Error(`Unknown deployable rule kind: ${rule.kind}`);
  }

  const sortedPaths = [...new Set(deployablePaths)].sort(comparePaths);
  if (sortedPaths.length !== deployablePaths.length) {
    throw new Error("Deployable rules selected the same file more than once");
  }
  return sortedPaths;
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function canonicalizeTextSource(contents, sourcePath) {
  let text;
  try {
    text = strictUtf8Decoder.decode(contents);
  } catch (error) {
    throw new Error(`Deployable source is not valid UTF-8: ${sourcePath}`, {
      cause: error,
    });
  }

  const roundTrip = Buffer.from(text, "utf8");
  if (!roundTrip.equals(contents)) {
    throw new Error(
      `Deployable source is not round-trippable UTF-8: ${sourcePath}`,
    );
  }

  return Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
}

async function readCanonicalSource(sourceRoot, relativePath) {
  const contents = await readFile(
    path.join(sourceRoot, ...relativePath.split("/")),
  );
  return canonicalizeTextSource(contents, relativePath);
}

function computeReleaseFromContents(sourceEntries) {
  const releaseHash = createHash("sha256");
  for (const { relativePath, contents } of sourceEntries) {
    releaseHash.update(relativePath, "utf8");
    releaseHash.update("\0", "utf8");
    releaseHash.update(sha256(contents), "utf8");
    releaseHash.update("\n", "utf8");
  }
  return releaseHash.digest("hex").slice(0, releaseLength);
}

async function computeRelease(sourceRoot, deployablePaths) {
  const sourceEntries = [];
  for (const relativePath of deployablePaths) {
    sourceEntries.push({
      relativePath,
      contents: await readCanonicalSource(sourceRoot, relativePath),
    });
  }
  return computeReleaseFromContents(sourceEntries);
}

function publishedPath(sourcePath, release) {
  const extension = path.posix.extname(sourcePath).toLowerCase();
  if (!versionedHtmlAssetExtensions.has(extension)) return sourcePath;

  const directory = path.posix.dirname(sourcePath);
  const basename = path.posix.basename(sourcePath, extension);
  return path.posix.join(directory, `${basename}.${release}${extension}`);
}

function createPublicationPlan(sourcePaths, release) {
  const plan = sourcePaths.flatMap((sourcePath) => {
    const runtimeEntry = {
      sourcePath,
      publishedPath: publishedPath(sourcePath, release),
      publicationKind: "runtime",
    };
    if (path.posix.extname(sourcePath).toLowerCase() !== ".json") {
      return [runtimeEntry];
    }
    return [
      {
        sourcePath,
        publishedPath: sourcePath,
        publicationKind: "stable-json",
      },
      runtimeEntry,
    ];
  });
  plan.sort((left, right) => comparePaths(left.publishedPath, right.publishedPath));
  const uniquePublishedPaths = new Set(plan.map((entry) => entry.publishedPath));
  if (uniquePublishedPaths.size !== plan.length) {
    throw new Error("Deployable sources map to duplicate published paths");
  }
  return plan;
}

function isExternalReference(reference) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(reference) ||
    reference.startsWith("//") ||
    reference.startsWith("#")
  );
}

function referencePath(reference) {
  const queryIndex = reference.indexOf("?");
  const fragmentIndex = reference.indexOf("#");
  const end = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((minimum, index) => Math.min(minimum, index), reference.length);
  return reference.slice(0, end);
}

function resolveLocalReference(ownerPath, reference) {
  if (isExternalReference(reference)) return null;

  const localPath = referencePath(reference);
  if (localPath === "") return null;
  if (localPath.startsWith("/") || localPath.includes("\\")) {
    throw new Error(
      `Root-relative or backslash asset reference in ${ownerPath}: ${reference}`,
    );
  }

  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(ownerPath), localPath),
  );
  if (resolved === ".." || resolved.startsWith("../")) {
    throw new Error(`Asset reference escapes the Pages artifact in ${ownerPath}: ${reference}`);
  }
  return resolved;
}

function withPublishedPath(ownerSourcePath, reference, release) {
  const resolvedSourcePath = resolveLocalReference(ownerSourcePath, reference);
  if (resolvedSourcePath === null) return reference;

  const ownerPublishedPath = publishedPath(ownerSourcePath, release);
  const targetPublishedPath = publishedPath(resolvedSourcePath, release);
  let relativePublishedPath = path.posix.relative(
    path.posix.dirname(ownerPublishedPath),
    targetPublishedPath,
  );
  if (
    referencePath(reference).startsWith("./") &&
    !relativePublishedPath.startsWith(".")
  ) {
    relativePublishedPath = `./${relativePublishedPath}`;
  }
  const fragmentIndex = reference.indexOf("#");
  const fragment = fragmentIndex >= 0 ? reference.slice(fragmentIndex) : "";
  return `${relativePublishedPath}${fragment}`;
}

function withStablePath(ownerSourcePath, reference) {
  const resolvedSourcePath = resolveLocalReference(ownerSourcePath, reference);
  if (resolvedSourcePath === null) return reference;

  let relativePath = path.posix.relative(
    path.posix.dirname(ownerSourcePath),
    resolvedSourcePath,
  );
  if (referencePath(reference).startsWith("./") && !relativePath.startsWith(".")) {
    relativePath = `./${relativePath}`;
  }
  const fragmentIndex = reference.indexOf("#");
  const fragment = fragmentIndex >= 0 ? reference.slice(fragmentIndex) : "";
  return `${relativePath}${fragment}`;
}

function htmlAttributeName(attribute) {
  return attribute.trimStart().match(/^(href|src)\b/i)?.[1].toLowerCase();
}

function stampHtmlReferences(contents, release, ownerSourcePath) {
  return contents.replace(
    htmlReferencePattern,
    (match, attribute, quote, quotedReference, unquotedReference) => {
      const reference = quotedReference ?? unquotedReference;
      if (isExternalReference(reference)) return match;
      const extension = path.posix.extname(referencePath(reference)).toLowerCase();
      if (!versionedHtmlAssetExtensions.has(extension)) return match;
      const stamped =
        extension === ".json" && htmlAttributeName(attribute) === "href"
          ? withStablePath(ownerSourcePath, reference)
          : withPublishedPath(ownerSourcePath, reference, release);
      return quote
        ? `${attribute}${quote}${stamped}${quote}`
        : `${attribute}"${stamped}"`;
    },
  );
}

function stampJsonReferences(contents, release, ownerSourcePath) {
  return contents.replace(
    jsonReferencePattern,
    (match, quote, jsonPath, query, fragment = "") =>
      `${quote}${withPublishedPath(
        ownerSourcePath,
        `${jsonPath}${fragment}`,
        release,
      )}${quote}`,
  );
}

function transformDeployableContents(sourcePath, contents, release) {
  const extension = path.posix.extname(sourcePath).toLowerCase();
  if (extension !== ".html" && extension !== ".js") return contents;

  const text = contents.toString("utf8");
  const transformed =
    extension === ".html"
      ? stampHtmlReferences(text, release, sourcePath)
      : stampJsonReferences(text, release, sourcePath);
  return transformed === text ? contents : Buffer.from(transformed, "utf8");
}

async function stagePublishedFiles(artifactRoot, publicationPlan, release) {
  for (const entry of publicationPlan) {
    const sourceContents = await readCanonicalSource(
      repositoryRoot,
      entry.sourcePath,
    );
    const publishedContents = transformDeployableContents(
      entry.sourcePath,
      sourceContents,
      release,
    );
    const destinationPath = path.join(
      artifactRoot,
      ...entry.publishedPath.split("/"),
    );
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, publishedContents);
  }
}

function assertPublishedReference(
  ownerPath,
  reference,
  release,
  publishedSet,
  stableJsonSet,
  referenceKind,
) {
  const resolved = resolveLocalReference(ownerPath, reference);
  if (resolved === null) return;
  if (!publishedSet.has(resolved)) {
    throw new Error(`Unknown local asset reference in ${ownerPath}: ${reference}`);
  }

  const extension = path.posix.extname(resolved).toLowerCase();
  if (extension === ".json" && referenceKind === "html-href") {
    if (reference.includes("?")) {
      throw new Error(
        `Stable JSON link in ${ownerPath} has a query: ${reference}`,
      );
    }
    if (!stableJsonSet.has(resolved)) {
      throw new Error(
        `HTML JSON link in ${ownerPath} must use a stable alias: ${reference}`,
      );
    }
    return;
  }
  if (extension === ".json" && stableJsonSet.has(resolved)) {
    throw new Error(
      `Stable JSON alias is only allowed from an HTML href in ${ownerPath}: ` +
        reference,
    );
  }
  if (!versionedHtmlAssetExtensions.has(extension)) return;
  if (reference.includes("?")) {
    throw new Error(`Published asset reference in ${ownerPath} has a query: ${reference}`);
  }
  if (!resolved.endsWith(`.${release}${extension}`)) {
    throw new Error(
      `Published asset reference in ${ownerPath} does not contain release ${release}: ` +
        reference,
    );
  }
}

async function validateStampedAssetReferences(
  artifactRoot,
  publishedPaths,
  stableJsonPaths,
  release,
) {
  const publishedSet = new Set(publishedPaths);
  const stableJsonSet = new Set(stableJsonPaths);
  let htmlAssetCount = 0;
  let jsonAssetCount = 0;

  for (const relativePath of publishedPaths) {
    const extension = path.posix.extname(relativePath).toLowerCase();
    if (extension !== ".html" && extension !== ".js") continue;

    const contents = await readFile(
      path.join(artifactRoot, ...relativePath.split("/")),
      "utf8",
    );
    if (extension === ".html") {
      for (const match of contents.matchAll(
        new RegExp(htmlReferencePattern.source, htmlReferencePattern.flags),
      )) {
        const reference = match[3] ?? match[4];
        if (isExternalReference(reference)) continue;
        const assetExtension = path.posix
          .extname(referencePath(reference))
          .toLowerCase();
        const referenceKind =
          htmlAttributeName(match[1]) === "href" ? "html-href" : "html-src";
        assertPublishedReference(
          relativePath,
          reference,
          release,
          publishedSet,
          stableJsonSet,
          referenceKind,
        );
        if (versionedHtmlAssetExtensions.has(assetExtension)) {
          htmlAssetCount += 1;
        }
      }
      continue;
    }

    for (const match of contents.matchAll(
      new RegExp(jsonReferencePattern.source, jsonReferencePattern.flags),
    )) {
      const reference = `${match[2]}${
        match[3] === undefined ? "" : `?${match[3]}`
      }${match[4] ?? ""}`;
      assertPublishedReference(
        relativePath,
        reference,
        release,
        publishedSet,
        stableJsonSet,
        "js-json",
      );
      jsonAssetCount += 1;
    }
  }

  if (htmlAssetCount === 0 || jsonAssetCount === 0) {
    throw new Error("Cache-version validation did not inspect HTML and JSON assets");
  }
}

async function createManifest(artifactRoot, publishedPaths, release) {
  const files = [];
  for (const relativePath of publishedPaths) {
    const contents = await readFile(
      path.join(artifactRoot, ...relativePath.split("/")),
    );
    files.push({
      path: relativePath,
      bytes: contents.byteLength,
      sha256: sha256(contents),
    });
  }

  return {
    schemaVersion: 2,
    release,
    files,
  };
}

async function createSourceDerivedManifest(publicationPlan, release) {
  const files = [];
  for (const entry of publicationPlan) {
    const sourceContents = await readCanonicalSource(
      repositoryRoot,
      entry.sourcePath,
    );
    const stagedContents = transformDeployableContents(
      entry.sourcePath,
      sourceContents,
      release,
    );
    files.push({
      path: entry.publishedPath,
      bytes: stagedContents.byteLength,
      sha256: sha256(stagedContents),
    });
  }

  return {
    schemaVersion: 2,
    release,
    files,
  };
}

function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function collectArtifactFiles(directory, relativePrefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => comparePaths(left.name, right.name));

  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = relativePrefix
      ? path.join(relativePrefix, entry.name)
      : entry.name;

    if (entry.isSymbolicLink()) {
      throw new Error(`Pages artifacts cannot contain symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      const nestedFiles = await collectArtifactFiles(absolutePath, relativePath);
      if (nestedFiles.length === 0) {
        throw new Error(`Pages artifacts cannot contain empty directories: ${relativePath}`);
      }
      files.push(...nestedFiles);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported artifact entry type: ${relativePath}`);
    }
    files.push(toPosixPath(relativePath));
  }

  return files;
}

function assertManifestShape(manifest) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.schemaVersion !== 2 ||
    typeof manifest.release !== "string" ||
    !new RegExp(`^[0-9a-f]{${releaseLength}}$`).test(manifest.release) ||
    !Array.isArray(manifest.files)
  ) {
    throw new Error("Artifact manifest has an unsupported shape or schema version");
  }

  const manifestKeys = Object.keys(manifest);
  if (
    manifestKeys.length !== 3 ||
    manifestKeys[0] !== "schemaVersion" ||
    manifestKeys[1] !== "release" ||
    manifestKeys[2] !== "files"
  ) {
    throw new Error("Artifact manifest keys are not canonical");
  }

  let previousPath = "";
  for (const file of manifest.files) {
    const fileKeys = file && typeof file === "object" ? Object.keys(file) : [];
    const canonicalKeys =
      fileKeys.length === 3 &&
      fileKeys[0] === "path" &&
      fileKeys[1] === "bytes" &&
      fileKeys[2] === "sha256";
    const canonicalPath =
      typeof file?.path === "string" &&
      file.path !== "" &&
      file.path === toPosixPath(file.path) &&
      !file.path.startsWith("/") &&
      !file.path.split("/").includes("..") &&
      file.path !== manifestName;

    if (
      !canonicalKeys ||
      !canonicalPath ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      typeof file.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(file.sha256)
    ) {
      throw new Error(`Artifact manifest contains an invalid file record`);
    }
    if (previousPath !== "" && comparePaths(previousPath, file.path) >= 0) {
      throw new Error("Artifact manifest file records must be sorted and unique");
    }
    previousPath = file.path;
  }
}

function assertSamePaths(actual, expected, label) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${label} mismatch.\nExpected: ${expected.join(", ")}\nActual: ${actual.join(", ")}`,
    );
  }
}

async function validateStableJsonAliases(
  artifactRoot,
  publicationPlan,
  manifest,
) {
  const recordsByPath = new Map(
    manifest.files.map((file) => [file.path, file]),
  );
  const stableEntries = publicationPlan.filter(
    (entry) => entry.publicationKind === "stable-json",
  );
  if (stableEntries.length === 0) {
    throw new Error("Pages artifact must publish at least one stable JSON alias");
  }

  for (const stableEntry of stableEntries) {
    const runtimePath = publishedPath(stableEntry.sourcePath, manifest.release);
    const stableRecord = recordsByPath.get(stableEntry.publishedPath);
    const runtimeRecord = recordsByPath.get(runtimePath);
    if (!stableRecord || !runtimeRecord) {
      throw new Error(
        `Stable JSON alias is missing its runtime pair: ${stableEntry.sourcePath}`,
      );
    }
    if (
      stableRecord.bytes !== runtimeRecord.bytes ||
      stableRecord.sha256 !== runtimeRecord.sha256
    ) {
      throw new Error(
        `Stable JSON alias does not match its runtime record: ${stableEntry.sourcePath}`,
      );
    }

    const [stableContents, runtimeContents] = await Promise.all([
      readFile(
        path.join(
          artifactRoot,
          ...stableEntry.publishedPath.split("/"),
        ),
      ),
      readFile(path.join(artifactRoot, ...runtimePath.split("/"))),
    ]);
    if (!stableContents.equals(runtimeContents)) {
      throw new Error(
        `Stable JSON alias does not match its runtime bytes: ${stableEntry.sourcePath}`,
      );
    }
  }
}

async function validatePublicSchemaIds(artifactRoot, publicationPlan) {
  const schemaEntries = publicationPlan.filter(
    (entry) =>
      entry.publicationKind === "stable-json" &&
      entry.sourcePath.startsWith("schemas/") &&
      entry.sourcePath.endsWith(".schema.json"),
  );
  if (schemaEntries.length === 0) {
    throw new Error("Pages artifact must publish its public JSON Schemas");
  }

  for (const entry of schemaEntries) {
    const schemaPath = path.join(
      artifactRoot,
      ...entry.publishedPath.split("/"),
    );
    let schema;
    try {
      schema = JSON.parse(await readFile(schemaPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Published JSON Schema is not valid JSON: ${entry.publishedPath}`,
        { cause: error },
      );
    }

    const expectedId = new URL(entry.sourcePath, publicSiteUrl).href;
    if (schema.$id !== expectedId) {
      throw new Error(
        `Published JSON Schema ${entry.publishedPath} must declare $id ${expectedId}`,
      );
    }
  }
}

async function validateArtifact(artifactRoot) {
  const sourcePaths = await collectDeployablePaths();
  const manifestPath = path.join(artifactRoot, manifestName);
  const manifestText = await readFile(manifestPath, "utf8");

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new Error(`Artifact manifest is not valid JSON: ${error.message}`);
  }

  assertManifestShape(manifest);
  if (manifestText !== serializeManifest(manifest)) {
    throw new Error("Artifact manifest is not serialized canonically");
  }
  const expectedRelease = await computeRelease(repositoryRoot, sourcePaths);
  if (manifest.release !== expectedRelease) {
    throw new Error(
      `Artifact release ${manifest.release} does not match source release ${expectedRelease}`,
    );
  }
  const publicationPlan = createPublicationPlan(sourcePaths, manifest.release);
  const publishedPaths = publicationPlan.map((entry) => entry.publishedPath);
  const stableJsonPaths = publicationPlan
    .filter((entry) => entry.publicationKind === "stable-json")
    .map((entry) => entry.publishedPath);

  assertSamePaths(
    manifest.files.map((file) => file.path),
    publishedPaths,
    "Manifest published path list",
  );

  const artifactFiles = await collectArtifactFiles(artifactRoot);
  const expectedArtifactFiles = [...publishedPaths, manifestName].sort(comparePaths);
  assertSamePaths(artifactFiles, expectedArtifactFiles, "Artifact file list");

  await validateStableJsonAliases(artifactRoot, publicationPlan, manifest);
  await validatePublicSchemaIds(artifactRoot, publicationPlan);

  await validateStampedAssetReferences(
    artifactRoot,
    publishedPaths,
    stableJsonPaths,
    manifest.release,
  );

  const sourceDerivedManifest = await createSourceDerivedManifest(
    publicationPlan,
    manifest.release,
  );
  if (serializeManifest(sourceDerivedManifest) !== manifestText) {
    throw new Error(
      "Artifact manifest does not match the deterministic source transformation",
    );
  }

  const actualManifest = await createManifest(
    artifactRoot,
    publishedPaths,
    manifest.release,
  );
  if (serializeManifest(actualManifest) !== manifestText) {
    throw new Error("Artifact contents do not match asset-manifest.json");
  }

  return {
    fileCount: sourcePaths.length,
    manifestText,
    release: manifest.release,
  };
}

async function prepareArtifact(artifactRoot, allowedParent) {
  assertDescendant(allowedParent, artifactRoot, "Artifact output");
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });

  const sourcePaths = await collectDeployablePaths();
  const release = await computeRelease(repositoryRoot, sourcePaths);
  const publicationPlan = createPublicationPlan(sourcePaths, release);
  await stagePublishedFiles(artifactRoot, publicationPlan, release);

  const manifest = await createSourceDerivedManifest(publicationPlan, release);
  await writeFile(
    path.join(artifactRoot, manifestName),
    serializeManifest(manifest),
    "utf8",
  );

  return validateArtifact(artifactRoot);
}

async function expectValidationFailure(
  operation,
  description,
  expectedMessagePattern,
) {
  try {
    await operation();
  } catch (error) {
    if (
      expectedMessagePattern &&
      !expectedMessagePattern.test(String(error?.message ?? error))
    ) {
      throw new Error(
        `Validator rejected ${description} for the wrong reason: ` +
          String(error?.message ?? error),
      );
    }
    return;
  }
  throw new Error(`Validator accepted ${description}`);
}

function testStampingVariants() {
  const release = "a".repeat(releaseLength);
  const cases = [
    {
      actual: stampHtmlReferences(
        '<link href = "styles.css">',
        release,
        "index.html",
      ),
      expected: `<link href = "styles.${release}.css">`,
      description: "a spaced quoted HTML attribute",
    },
    {
      actual: stampHtmlReferences(
        "<script src=book-shell.js></script>",
        release,
        "index.html",
      ),
      expected: `<script src="book-shell.${release}.js"></script>`,
      description: "an unquoted HTML attribute",
    },
    {
      actual: stampHtmlReferences(
        '<a href="data/analog-cim-mcq.json">Data</a>',
        release,
        "analog-cim-quiz.html",
      ),
      expected: '<a href="data/analog-cim-mcq.json">Data</a>',
      description: "a stable HTML JSON link",
    },
    {
      actual: stampHtmlReferences(
        '<script src="data/bootstrap.json"></script>',
        release,
        "index.html",
      ),
      expected: `<script src="data/bootstrap.${release}.json"></script>`,
      description: "a runtime HTML JSON source",
    },
    {
      actual: stampJsonReferences(
        "fetch('./data/analog-cim-evidence.json')",
        release,
        "analog-cim-evidence.js",
      ),
      expected: `fetch('./data/analog-cim-evidence.${release}.json')`,
      description: "a dot-relative JSON request",
    },
  ];

  for (const fixture of cases) {
    if (fixture.actual !== fixture.expected) {
      throw new Error(
        `Failed to stamp ${fixture.description}.\n` +
          `Expected: ${fixture.expected}\nActual: ${fixture.actual}`,
      );
    }
  }
}

function createLogicalFixtureManifest(lineEnding) {
  const rawEntries = [
    {
      relativePath: "data/config.json",
      contents: Buffer.from(`{"ready":true}${lineEnding}`, "utf8"),
    },
    {
      relativePath: "index.html",
      contents: Buffer.from(
        `<link href="styles.css">${lineEnding}` +
          `<script src="main.js"></script>${lineEnding}` +
          `<a href="data/config.json">Data</a>${lineEnding}`,
        "utf8",
      ),
    },
    {
      relativePath: "main.js",
      contents: Buffer.from(
        `fetch('./data/config.json')${lineEnding}`,
        "utf8",
      ),
    },
    {
      relativePath: "styles.css",
      contents: Buffer.from(`body { color: black; }${lineEnding}`, "utf8"),
    },
  ];
  const sourceEntries = rawEntries.map((entry) => ({
    relativePath: entry.relativePath,
    contents: canonicalizeTextSource(entry.contents, entry.relativePath),
  }));
  const contentsByPath = new Map(
    sourceEntries.map((entry) => [entry.relativePath, entry.contents]),
  );
  const release = computeReleaseFromContents(sourceEntries);
  const publicationPlan = createPublicationPlan(
    sourceEntries.map((entry) => entry.relativePath),
    release,
  );
  const files = publicationPlan.map((entry) => {
    const stagedContents = transformDeployableContents(
      entry.sourcePath,
      contentsByPath.get(entry.sourcePath),
      release,
    );
    return {
      path: entry.publishedPath,
      bytes: stagedContents.byteLength,
      sha256: sha256(stagedContents),
    };
  });
  return serializeManifest({
    schemaVersion: 2,
    release,
    files,
  });
}

function testCanonicalLineEndings() {
  const lfManifest = createLogicalFixtureManifest("\n");
  const crlfManifest = createLogicalFixtureManifest("\r\n");
  const crManifest = createLogicalFixtureManifest("\r");
  if (lfManifest !== crlfManifest || lfManifest !== crManifest) {
    throw new Error(
      "LF, CRLF, and CR logical source trees produced different artifacts",
    );
  }

  let invalidUtf8Rejected = false;
  try {
    canonicalizeTextSource(
      Buffer.from([0xc3, 0x28]),
      "invalid-utf8-fixture.html",
    );
  } catch {
    invalidUtf8Rejected = true;
  }
  if (!invalidUtf8Rejected) {
    throw new Error("Invalid UTF-8 deployable source was accepted");
  }
}

async function testArtifactPreparation() {
  testStampingVariants();
  testCanonicalLineEndings();
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "npu-pages-artifact-"));
  assertDescendant(tmpdir(), temporaryRoot, "Temporary artifact root");

  try {
    const firstRoot = path.join(temporaryRoot, "first");
    const secondRoot = path.join(temporaryRoot, "second");
    const thirdRoot = path.join(temporaryRoot, "third");
    const first = await prepareArtifact(firstRoot, temporaryRoot);
    const second = await prepareArtifact(secondRoot, temporaryRoot);
    const third = await prepareArtifact(thirdRoot, temporaryRoot);

    if (
      first.manifestText !== second.manifestText ||
      first.manifestText !== third.manifestText
    ) {
      throw new Error("Clean artifact builds produced different manifests");
    }

    const secondManifest = JSON.parse(second.manifestText);
    const secondRecordsByPath = new Map(
      secondManifest.files.map((file) => [file.path, file]),
    );
    const stableJsonRecords = secondManifest.files.filter(
      (file) =>
        file.path.endsWith(".json") &&
        !file.path.endsWith(`.${secondManifest.release}.json`),
    );
    if (stableJsonRecords.length === 0) {
      throw new Error("Artifact test requires stable JSON aliases");
    }
    for (const stableRecord of stableJsonRecords) {
      const runtimePath = publishedPath(
        stableRecord.path,
        secondManifest.release,
      );
      const runtimeRecord = secondRecordsByPath.get(runtimePath);
      if (
        !runtimeRecord ||
        runtimeRecord.bytes !== stableRecord.bytes ||
        runtimeRecord.sha256 !== stableRecord.sha256
      ) {
        throw new Error(
          `Stable JSON alias does not match its runtime copy: ${stableRecord.path}`,
        );
      }
    }

    const quizHtmlPath = path.join(secondRoot, "analog-cim-quiz.html");
    const quizHtml = await readFile(quizHtmlPath, "utf8");
    for (const downloadPath of quizDownloadJsonPaths) {
      if (!secondRecordsByPath.has(downloadPath)) {
        throw new Error(`Quiz download is not a stable JSON alias: ${downloadPath}`);
      }
      if (!quizHtml.includes(`href="${downloadPath}"`)) {
        throw new Error(
          `Human JSON link is not release-independent: ${downloadPath}`,
        );
      }
      const runtimePath = publishedPath(
        downloadPath,
        secondManifest.release,
      );
      if (quizHtml.includes(`href="${runtimePath}"`)) {
        throw new Error(`Human JSON link uses a runtime path: ${runtimePath}`);
      }
    }

    const stableAliasToTamper = stableJsonRecords[0];
    const stableAliasPath = path.join(
      secondRoot,
      ...stableAliasToTamper.path.split("/"),
    );
    await writeFile(
      stableAliasPath,
      Buffer.concat([
        await readFile(stableAliasPath),
        Buffer.from("\n", "utf8"),
      ]),
    );
    await expectValidationFailure(
      () => validateArtifact(secondRoot),
      "stable JSON bytes that differ from the runtime copy",
      /does not match its runtime bytes/,
    );
    await prepareArtifact(secondRoot, temporaryRoot);

    const evidenceScriptPath = publishedPath(
      "analog-cim-evidence.js",
      secondManifest.release,
    );
    const evidenceScript = await readFile(
      path.join(secondRoot, evidenceScriptPath),
      "utf8",
    );
    const stableEvidenceJson = "data/analog-cim-evidence.json";
    const runtimeEvidenceJson = publishedPath(
      stableEvidenceJson,
      secondManifest.release,
    );
    if (
      !evidenceScript.includes(`fetch('${runtimeEvidenceJson}')`) ||
      evidenceScript.includes(`fetch('${stableEvidenceJson}')`)
    ) {
      throw new Error("Runtime JSON request is not release-hashed");
    }

    const htmlPath = secondManifest.files.find((file) =>
      file.path.endsWith(".html"),
    )?.path;
    if (!htmlPath) {
      throw new Error("Artifact test requires at least one HTML file");
    }
    const htmlAbsolutePath = path.join(secondRoot, ...htmlPath.split("/"));
    const htmlContents = await readFile(htmlAbsolutePath, "utf8");
    const expectedVersion = `.${secondManifest.release}.`;
    if (!htmlContents.includes(expectedVersion)) {
      throw new Error("Artifact test requires a versioned HTML asset reference");
    }
    await writeFile(
      htmlAbsolutePath,
      htmlContents.replace(expectedVersion, `.${"0".repeat(releaseLength)}.`),
      "utf8",
    );
    await expectValidationFailure(
      () => validateArtifact(secondRoot),
      "a mixed-release asset reference",
      /Unknown local asset reference|does not contain release/,
    );
    await prepareArtifact(secondRoot, temporaryRoot);

    const stableQuizHtml = await readFile(quizHtmlPath, "utf8");
    const stableArchitectureJson = "data/analog-cim-architecture.json";
    const runtimeArchitectureJson = publishedPath(
      stableArchitectureJson,
      secondManifest.release,
    );
    await writeFile(
      quizHtmlPath,
      stableQuizHtml.replace(
        `href="${stableArchitectureJson}"`,
        `href="${runtimeArchitectureJson}"`,
      ),
      "utf8",
    );
    await expectValidationFailure(
      () => validateArtifact(secondRoot),
      "a release-dependent human JSON link",
      /must use a stable alias/,
    );
    await prepareArtifact(secondRoot, temporaryRoot);

    const quizWithStableJsonSource = await readFile(quizHtmlPath, "utf8");
    await writeFile(
      quizHtmlPath,
      `${quizWithStableJsonSource}\n` +
        `<script src="${stableArchitectureJson}"></script>\n`,
      "utf8",
    );
    await expectValidationFailure(
      () => validateArtifact(secondRoot),
      "a stable JSON script source",
      /only allowed from an HTML href/,
    );
    await prepareArtifact(secondRoot, temporaryRoot);

    const runtimeEvidenceScriptPath = path.join(
      secondRoot,
      evidenceScriptPath,
    );
    const runtimeEvidenceScript = await readFile(
      runtimeEvidenceScriptPath,
      "utf8",
    );
    await writeFile(
      runtimeEvidenceScriptPath,
      runtimeEvidenceScript.replace(
        `.${secondManifest.release}.json`,
        `.${"0".repeat(releaseLength)}.json`,
      ),
      "utf8",
    );
    await expectValidationFailure(
      () => validateArtifact(secondRoot),
      "a mixed-release runtime JSON reference",
      /Unknown local asset reference|does not contain release/,
    );
    await prepareArtifact(secondRoot, temporaryRoot);

    const hashedEvidenceScript = await readFile(
      runtimeEvidenceScriptPath,
      "utf8",
    );
    await writeFile(
      runtimeEvidenceScriptPath,
      hashedEvidenceScript.replace(runtimeEvidenceJson, stableEvidenceJson),
      "utf8",
    );
    await expectValidationFailure(
      () => validateArtifact(secondRoot),
      "a stable JSON runtime fetch",
      /only allowed from an HTML href/,
    );
    await prepareArtifact(secondRoot, temporaryRoot);

    const unexpectedPath = path.join(secondRoot, "unexpected.txt");
    await writeFile(unexpectedPath, "not deployable\n", "utf8");
    await expectValidationFailure(
      () => validateArtifact(secondRoot),
      "an undeclared artifact file",
    );
    await rm(unexpectedPath);

    await mkdir(path.join(secondRoot, "empty"));
    await expectValidationFailure(
      () => validateArtifact(secondRoot),
      "an empty artifact directory",
    );

    const firstPublishedFile = JSON.parse(first.manifestText).files[0]?.path;
    if (!firstPublishedFile) {
      throw new Error("Artifact test requires at least one deployable file");
    }
    await writeFile(
      path.join(firstRoot, ...firstPublishedFile.split("/")),
      "tampered\n",
      "utf8",
    );
    await expectValidationFailure(
      () => validateArtifact(firstRoot),
      "content that did not match the manifest",
    );

    const thirdManifest = JSON.parse(third.manifestText);
    const mutableRecord = thirdManifest.files.find((file) =>
      file.path.endsWith(".css"),
    );
    if (!mutableRecord) {
      throw new Error("Artifact test requires at least one published CSS file");
    }
    const mutablePath = path.join(thirdRoot, ...mutableRecord.path.split("/"));
    const arbitraryContents = Buffer.concat([
      await readFile(mutablePath),
      Buffer.from("\n/* staged-only mutation */\n", "utf8"),
    ]);
    await writeFile(mutablePath, arbitraryContents);
    mutableRecord.bytes = arbitraryContents.byteLength;
    mutableRecord.sha256 = sha256(arbitraryContents);
    await writeFile(
      path.join(thirdRoot, manifestName),
      serializeManifest(thirdManifest),
      "utf8",
    );
    await expectValidationFailure(
      () => validateArtifact(thirdRoot),
      "a self-consistent manifest for arbitrary staged bytes",
      /deterministic source transformation/,
    );

    return first.fileCount;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function resolveArtifactArgument(argument) {
  return path.resolve(repositoryRoot, argument ?? path.relative(repositoryRoot, defaultArtifactRoot));
}

async function main() {
  const command = process.argv[2] ?? "build";

  if (command === "build") {
    const artifactRoot = resolveArtifactArgument(process.argv[3]);
    const result = await prepareArtifact(artifactRoot, buildRoot);
    console.log(
      `Prepared ${result.fileCount} deployable files for release ${result.release} ` +
        `in ${path.relative(repositoryRoot, artifactRoot)}`,
    );
    return;
  }

  if (command === "validate") {
    const artifactRoot = resolveArtifactArgument(process.argv[3]);
    assertDescendant(buildRoot, artifactRoot, "Artifact output");
    const result = await validateArtifact(artifactRoot);
    console.log(
      `Validated ${result.fileCount} deployable files for release ${result.release} ` +
        `in ${path.relative(repositoryRoot, artifactRoot)}`,
    );
    return;
  }

  if (command === "test") {
    const fileCount = await testArtifactPreparation();
    console.log(
      `Artifact preparation is deterministic and rejects tampering (${fileCount} deployable files)`,
    );
    return;
  }

  throw new Error(`Unknown command "${command}". Use build, validate, or test.`);
}

await main();
