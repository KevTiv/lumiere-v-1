/**
 * Compile-only — Projects BFF reducer keys stay aligned with `projectsBffCallUrl`.
 */
import {
  PROJECTS_BFF_REDUCERS,
  projectsBffCallUrl,
  projectsCommandContract,
} from "../commands/projects-http";

for (const k of PROJECTS_BFF_REDUCERS) {
  void projectsBffCallUrl(k);
  void projectsCommandContract(k);
}
