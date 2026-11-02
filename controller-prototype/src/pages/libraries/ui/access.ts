import type { Library } from "../../../entities/library";
import { can, type Member } from "../../../entities/member";

// Visible to the Owner, and to anyone with Use at an Agent the Library is given to (ADR 0037).
export const libraryVisible = (member: Member, library: Library) => member.owner || Object.keys(library.access).some((agent) => can(member, agent, "use"));
