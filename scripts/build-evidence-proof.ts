import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildEvidenceProofBundles,
  filterByModuleKey,
  parseEvidenceSummaryEnvelope,
} from "../src/skill/evidence/build-proof-bundle.ts";
import type { EvidenceModuleKey, EvidenceProofType, RawEvidenceSummaryEnvelope } from "../src/skill/evidence/types.ts";

interface CliOptions {
  input?: string;
  module?: EvidenceModuleKey;
  out?: string;
  pretty: boolean;
  proofType?: EvidenceProofType;
}

interface InputFileShape {
  proofType?: EvidenceProofType;
  envelopes: RawEvidenceSummaryEnvelope[];
}

function isMainModule() {
  if (!import.meta.url.startsWith("file:")) return false;
  const modulePath = realpathSync(fileURLToPath(import.meta.url));
  const argvPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
  return modulePath === argvPath;
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { pretty: false };

  for (const arg of argv) {
    if (arg.startsWith("--input=")) {
      options.input = arg.slice("--input=".length);
      continue;
    }
    if (arg.startsWith("--module=")) {
      const moduleValue = arg.slice("--module=".length) as EvidenceModuleKey;
      if (moduleValue !== "uniswap" && moduleValue !== "activity" && moduleValue !== "aave") {
        throw new Error(`Unsupported --module value: ${moduleValue}`);
      }
      options.module = moduleValue;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.out = arg.slice("--out=".length);
      continue;
    }
    if (arg.startsWith("--proof-type=")) {
      const proofType = arg.slice("--proof-type=".length) as EvidenceProofType;
      if (proofType !== "summary-only" && proofType !== "merkle" && proofType !== "receipt-proof") {
        throw new Error(`Unsupported --proof-type value: ${proofType}`);
      }
      options.proofType = proofType;
      continue;
    }
    if (arg === "--pretty") {
      options.pretty = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.input) {
    throw new Error("Missing required argument: --input=<path>");
  }

  return options;
}

function parseInputFile(path: string): InputFileShape {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;

  if (Array.isArray(raw)) {
    return { envelopes: raw as RawEvidenceSummaryEnvelope[] };
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Input file must be an array or an object with { envelopes }");
  }

  const maybeObject = raw as Partial<InputFileShape>;
  if (!Array.isArray(maybeObject.envelopes)) {
    throw new Error("Input file object must include an envelopes array");
  }

  return {
    proofType: maybeObject.proofType,
    envelopes: maybeObject.envelopes as RawEvidenceSummaryEnvelope[],
  };
}

function toSerializableJson(value: unknown, pretty: boolean): string {
  return JSON.stringify(value, (_key, current) => (typeof current === "bigint" ? current.toString() : current), pretty ? 2 : 0);
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const input = parseInputFile(options.input!);
  const filtered = filterByModuleKey(input.envelopes, options.module);

  if (filtered.length === 0) {
    throw new Error("No envelopes left after applying filters");
  }

  const envelopes = filtered.map((entry) => parseEvidenceSummaryEnvelope(entry));
  const proofType = options.proofType ?? input.proofType ?? "merkle";
  const result = buildEvidenceProofBundles(envelopes, { proofType });
  const output = toSerializableJson(result, options.pretty);

  if (options.out) {
    writeFileSync(options.out, `${output}\n`, "utf8");
  } else {
    // eslint-disable-next-line no-console
    console.log(output);
  }
}

if (isMainModule()) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to build evidence proof bundle:", err);
    process.exit(1);
  });
}
