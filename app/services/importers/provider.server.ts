import { createCsvImporter } from "./csv.server";
import { createJudgemeImporter } from "./judgeme.server";
import { createLooxImporter } from "./loox.server";
import { createStampedImporter } from "./stamped.server";
import { ImportSourceNotSupportedError, type Importer, type ImportSource } from "./types";

// The single place that maps a source id to its Importer — adding a new source later is a new
// createXImporter() plus one case here. Mirrors app/services/ai/provider.server.ts's
// getAiProvider(). Ryviu stays unimplemented (see types.ts's IMPORT_SOURCES comment) until its
// real export schema can be verified.
export function getImporter(source: ImportSource): Importer {
  switch (source) {
    case "csv":
      return createCsvImporter();
    case "judgeme":
      return createJudgemeImporter();
    case "loox":
      return createLooxImporter();
    case "stamped":
      return createStampedImporter();
    default:
      throw new ImportSourceNotSupportedError(source);
  }
}
