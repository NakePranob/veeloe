import { can, type Member } from "../../../entities/member";
import { getProject, hasRight, type Project } from "../../../entities/project";
import { getTask, pendingApproval, type Task } from "../../../entities/task";

// Who may do what with a Task, as the Runtime would check it. Project Tasks follow Project
// rights instead (ADR 0046); entities/project answers those where Projects are drawn.

const rootOf = (task: Task): Task => (task.parent ? rootOf(getTask(task.parent) ?? { ...task, parent: undefined }) : task);

// A Project's Tasks follow the Project's rights; a room closed to Ask is hidden from View and Ask
// and open to Use and Manage (ADR 0046). Its sub-Tasks follow the room.
function inProject(project: Project | undefined, member: Member, task: Task, level: "view" | "ask" | "use") {
  if (!project) return false;
  if (level === "view" && project.closedToAsk.includes(rootOf(task).id)) return hasRight(project, member, "use");
  return hasRight(project, member, level);
}

// Open in the app: their own, or one opened to everyone with Use (ADR 0060).
export function canRead(member: Member, task: Task) {
  if (task.project) return inProject(getProject(task.project), member, task, "view");
  if (task.starter === member.id) return true;
  if (task.source !== "app") return can(member, task.agent, "use");
  return task.shared && can(member, task.agent, "use");
}

// Someone with Approve sees the card of a Task they cannot otherwise open, and may open the
// conversation from it, which the Task records (ADR 0060).
export function waitingOn(member: Member, task: Task, now = Date.now()) {
  return !!pendingApproval(task.events, now) && can(member, task.agent, "approve");
}

// Stop is a brake for anyone with Use, except in a Task they cannot see (ADR 0017).
export function canStop(member: Member, task: Task) {
  if (task.project) return inProject(getProject(task.project), member, task, "use");
  if (task.readOnly && task.source === "channel") return can(member, task.agent, "use");
  if (task.source === "app" && !task.shared) return task.starter === member.id || can(member, task.agent, "manage");
  return can(member, task.agent, "use");
}

// A room takes messages from those with Use. A sub-Task is the employee's card: read, open and stop, never typed into (ADR 0045).
export function canSend(member: Member, task: Task) {
  if (task.project) return !task.readOnly && !task.parent && inProject(getProject(task.project), member, task, "use");
  return !task.readOnly && canRead(member, task) && can(member, task.agent, "use");
}

// Ask needs only the Ask right in a Project room. Outside one it is for those with Use; whether the Agent is busy is the runtime's to say.
export function canAsk(member: Member, task: Task) {
  if (task.project) return !task.parent && !task.readOnly && inProject(getProject(task.project), member, task, "ask");
  return !task.readOnly && canRead(member, task) && can(member, task.agent, "use");
}

// The Inbox shows Tasks a Member started or that wait on them, in a Project or not (ADR 0031).
// A silent one, such as an employee's sub-Task, comes up only when it needs them.
export function inInbox(member: Member, task: Task, now = Date.now()) {
  if (waitingOn(member, task, now)) return true;
  return !task.silent && task.starter === member.id;
}
