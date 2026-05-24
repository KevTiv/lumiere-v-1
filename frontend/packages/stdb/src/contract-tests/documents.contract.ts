/**
 * Compile-only — Documents BFF reducer keys stay aligned with `documentsBffCallUrl`.
 */
import {
  DOCUMENTS_BFF_REDUCERS,
  documentsBffCallUrl,
  documentsCommandContract,
} from "../commands/documents-http";

for (const k of DOCUMENTS_BFF_REDUCERS) {
  void documentsBffCallUrl(k);
  void documentsCommandContract(k);
}
