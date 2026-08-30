/**
 * Compile-only — Documents BFF reducer keys stay aligned with command metadata.
 */
import {
  DOCUMENTS_BFF_REDUCERS,
  documentsCommandContract,
} from "../commands/documents-http";

for (const k of DOCUMENTS_BFF_REDUCERS) {
  void documentsCommandContract(k);
}
