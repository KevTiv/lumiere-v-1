/**
 * Compile-only — Projects BFF reducer keys stay aligned with command metadata.
 */
import {
  PROJECTS_BFF_REDUCERS,
  projectsCommandContract,
} from "../commands/projects-http";

for (const k of PROJECTS_BFF_REDUCERS) {
  void projectsCommandContract(k);
}
