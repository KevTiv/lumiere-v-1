/**
 * Stable type re-exports from generated bindings. Import from this module
 * outside `@lumiere/stdb` internals so generated file layout can change safely.
 */
export type * from "../generated/types";
import type { OperationInputMap } from "@lumiere/contracts/generated/operation-inputs";

export type CreateProposalParams = OperationInputMap["create_proposal"];
export type CreateUserInviteParams = OperationInputMap["create_user_invite"];
export type PostMessageParams = OperationInputMap["post_message"];
export type UpdateContactParams = OperationInputMap["update_contact"];
