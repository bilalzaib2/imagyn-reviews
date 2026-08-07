import { createCsvImporter } from "./csv.server";
import { createJudgemeImporter } from "./judgeme.server";
import { ImportSourceNotSupportedError, type Importer, type ImportSource } from "./types";

// The single place that maps a source id to its Importer — adding Loox/Stamped/Ryviu later is
// a new createXImporter() plus one case here. Mirrors app/services/ai/provider.server.ts's
// getAiProvider().
export function getImporter(source: ImportSource): Importer {
  switch (source) {
    case "csv":
      return createCsvImporter();
    case "judgeme":
      return createJudgemeImporter();
    default:
      throw new ImportSourceNotSupportedError(source);
  }
}
